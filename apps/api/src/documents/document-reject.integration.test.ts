import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient, type DocumentStatus, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import type { TenantContext } from "../auth/tenant.js";
import { DocumentRejectService } from "./document-reject-service.js";

/**
 * Rechazo de un documento que falló al procesarse (D23-1 a, etapa 1), por la ruta real y por el
 * servicio con el rol runtime (sin BYPASSRLS). Datos sintéticos «Demo»: un estudio nuevo por corrida,
 * con identificadores aleatorios. No se borran filas: la base de pruebas es desechable.
 */

const PROCESANDO = "Todavía se está procesando: esperá a que termine";
const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const CSRF = randomBytes(32).toString("base64url");
const USERS = {
  owner: { id: randomUUID(), firmId: FIRM, role: "OWNER", name: "Titular Demo 7b3c" },
  preparer: { id: randomUUID(), firmId: FIRM, role: "PREPARER", name: "Preparador Demo 7b3c" },
  otherOwner: {
    id: randomUUID(),
    firmId: OTHER_FIRM,
    role: "OWNER",
    name: "Titular otro estudio Demo 7b3c",
  },
} as const;
type UserKey = keyof typeof USERS;

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
const tokens = {} as Record<UserKey, string>;
const clientIds = { a: "", b: "", other: "" };

const rejectUrl = (documentId: string, clientId = clientIds.a, firmId = FIRM) =>
  `/api/v1/firms/${firmId}/clients/${clientId}/documents/${documentId}/reject`;

function reject(
  user: UserKey,
  documentId: string,
  payload: object = { reason: "Ilegible" },
  clientId = clientIds.a,
  firmId = FIRM,
) {
  return app.inject({
    method: "POST",
    url: rejectUrl(documentId, clientId, firmId),
    cookies: { refresh_token: tokens[user], csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload,
  });
}

async function createDocument(
  status: DocumentStatus,
  options: { firmId?: string; clientId?: string; uploaderId?: string } = {},
): Promise<string> {
  const firmId = options.firmId ?? FIRM;
  const clientId = options.clientId ?? clientIds.a;
  const document = await prisma.document.create({
    data: {
      firmId,
      clientId,
      uploadedByUserId: options.uploaderId ?? USERS.owner.id,
      uploadOrigin: "FIRM",
      status,
    },
  });
  await prisma.documentFileVersion.create({
    data: {
      firmId,
      clientId,
      documentId: document.id,
      originalName: `rechazo-${document.id}.pdf`,
      mimeType: "application/pdf",
      extension: "pdf",
      sizeBytes: 1,
      sha256: "c".repeat(64),
      bucket: "quarantine",
      objectKey: `test/rechazo-${document.id}.pdf`,
      antivirusStatus: "PENDING",
    },
  });
  return document.id;
}

async function createJob(documentId: string, status: "QUEUED" | "RUNNING") {
  const version = await prisma.documentFileVersion.findFirstOrThrow({
    where: { documentId },
    select: { id: true, firmId: true, clientId: true },
  });
  await prisma.documentProcessingJob.create({
    data: {
      firmId: version.firmId,
      clientId: version.clientId,
      documentId,
      fileVersionId: version.id,
      type: "VALIDATE",
      status,
      deduplicationKey: `validate:${randomUUID()}`,
    },
  });
}

async function statusOf(documentId: string) {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    select: { status: true },
  });
  return document.status;
}

function rejectionAudits(documentId: string) {
  return prisma.auditEvent.findMany({
    where: { action: "document.extraction.rejected", entityId: documentId },
  });
}

/** Transacción con el rol runtime y el contexto RLS de la sesión, como withTenantContext. */
const runAsRuntime = <T>(ctx: TenantContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  runtimePrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${ctx.firmId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', ${ctx.clientId ?? ""}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', ${ctx.actorKind}, true)`;
    return fn(tx);
  });

const runtimeService = new DocumentRejectService(runAsRuntime);

beforeAll(async () => {
  runtimePrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.RUNTIME_DATABASE_URL ?? "" }),
  });
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  for (const firmId of [FIRM, OTHER_FIRM]) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now())`,
      firmId,
      `Estudio Demo 7b3c ${firmId.slice(0, 8)}`,
    );
  }
  for (const user of Object.values(USERS)) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
      user.id,
      `${user.id}@rechazo-7b3c.test.local`,
      user.name,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'${user.role}','ACTIVE',now())`,
      user.firmId,
      user.id,
    );
  }

  const clientA = await prisma.client.create({
    data: {
      firmId: FIRM,
      legalName: "Cliente Demo 7b3c A",
      tradeName: "Demo A",
      cuit: "20111111112",
      status: "ACTIVE",
    },
  });
  const clientB = await prisma.client.create({
    data: {
      firmId: FIRM,
      legalName: "Cliente Demo 7b3c B",
      tradeName: "Demo B",
      cuit: "20222222223",
      status: "ACTIVE",
    },
  });
  const clientOther = await prisma.client.create({
    data: {
      firmId: OTHER_FIRM,
      legalName: "Cliente Demo 7b3c otro estudio",
      tradeName: "Demo otro",
      cuit: "20333333334",
      status: "ACTIVE",
    },
  });
  clientIds.a = clientA.id;
  clientIds.b = clientB.id;
  clientIds.other = clientOther.id;
  // El preparador necesita asignación al cliente A: sin ella el guard responde 404 y no llega a la capacidad.
  await prisma.clientAssignment.createMany({
    data: [{ firmId: FIRM, clientId: clientA.id, userId: USERS.preparer.id }],
  });

  const sessions = (Object.keys(USERS) as UserKey[]).map((key) => {
    const token = randomBytes(32).toString("base64url");
    tokens[key] = token;
    return {
      id: randomUUID(),
      userId: USERS[key].id,
      refreshTokenHash: sha256(token),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  });
  await prisma.deviceSession.createMany({ data: sessions });
});

afterAll(async () => {
  await app?.close();
  await runtimePrisma?.$disconnect();
});

describe("rechazo de un documento que falló al procesarse (D23-1 a, etapa 1)", () => {
  it("un documento FAILED pasa a EXTRACTION_FAILED y audita el rechazo sobre el documento", async () => {
    const documentId = await createDocument("FAILED");
    const res = await reject("owner", documentId, { reason: "Ilegible" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: { status: "EXTRACTION_FAILED" } });
    expect(await statusOf(documentId)).toBe("EXTRACTION_FAILED");
    const audits = await rejectionAudits(documentId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "Document",
      userId: USERS.owner.id,
      before: { status: "FAILED" },
      after: { status: "EXTRACTION_FAILED", reason: "Ilegible" },
    });
  });

  it.each([
    ["EXTRACTED", "DOCUMENT_HAS_EXTRACTION", "Rechazá la extracción desde la revisión"],
    ["UPLOADED", "DOCUMENT_STILL_PROCESSING", PROCESANDO],
    ["VALIDATING", "DOCUMENT_STILL_PROCESSING", PROCESANDO],
    ["EXTRACTION_FAILED", "DOCUMENT_ALREADY_REJECTED", "Ya está rechazado"],
    ["READY", "DOCUMENT_NOT_REJECTABLE", "Solo se rechaza un documento que falló al procesarse"],
  ] as const)("responde 409 a un documento en %s y no lo cambia", async (status, code, message) => {
    const documentId = await createDocument(status);
    const res = await reject("owner", documentId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code, message });
    expect(await statusOf(documentId)).toBe(status);
    expect(await rejectionAudits(documentId)).toHaveLength(0);
  });

  it.each(["QUEUED", "RUNNING"] as const)(
    "responde 409 a un FAILED con una tarea %s activa y no lo cambia",
    async (job) => {
      const documentId = await createDocument("FAILED");
      await createJob(documentId, job);
      const res = await reject("owner", documentId);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: "DOCUMENT_STILL_PROCESSING",
        message: PROCESANDO,
      });
      expect(await statusOf(documentId)).toBe("FAILED");
      expect(await rejectionAudits(documentId)).toHaveLength(0);
    },
  );

  it("rechazar dos veces: la segunda responde 409 «Ya está rechazado» y no audita de nuevo", async () => {
    const documentId = await createDocument("FAILED");
    expect((await reject("owner", documentId)).statusCode).toBe(200);
    const second = await reject("owner", documentId, { reason: "Duplicado" });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({
      code: "DOCUMENT_ALREADY_REJECTED",
      message: "Ya está rechazado",
    });
    expect(await rejectionAudits(documentId)).toHaveLength(1);
  });

  it("dos rechazos simultáneos sobre el mismo documento: uno gana y el otro recibe 409", async () => {
    const documentId = await createDocument("FAILED");
    const [first, second] = await Promise.all([
      reject("owner", documentId),
      reject("owner", documentId),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
    const loser = first.statusCode === 409 ? first : second;
    expect(loser.json().error).toMatchObject({ code: "DOCUMENT_ALREADY_REJECTED" });
    expect(await rejectionAudits(documentId)).toHaveLength(1);
  });

  it.each([
    ["sin motivo", {}],
    ["con el motivo vacío", { reason: "   " }],
    ["con más de 500 caracteres", { reason: "x".repeat(501) }],
  ])("responde 400 %s y no cambia el documento", async (_label, payload) => {
    const documentId = await createDocument("FAILED");
    const res = await reject("owner", documentId, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: "REJECTION_REASON_REQUIRED" });
    expect(await statusOf(documentId)).toBe("FAILED");
  });

  it("un documento de otro cliente del mismo estudio responde 404 y no cambia", async () => {
    const documentId = await createDocument("FAILED", { clientId: clientIds.b });
    const res = await reject("owner", documentId, { reason: "Ilegible" }, clientIds.a);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(await statusOf(documentId)).toBe("FAILED");
  });

  it("un documento inexistente responde 404", async () => {
    const res = await reject("owner", randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("un titular de otro estudio no alcanza el documento: responde 404 y no cambia nada", async () => {
    const documentId = await createDocument("FAILED");
    const res = await reject("otherOwner", documentId, { reason: "Ilegible" }, clientIds.a, FIRM);
    expect(res.statusCode).toBe(404);
    expect(await statusOf(documentId)).toBe("FAILED");
  });

  it("sin sesión responde 401", async () => {
    const documentId = await createDocument("FAILED");
    const res = await app.inject({
      method: "POST",
      url: rejectUrl(documentId),
      cookies: { csrf_token: CSRF },
      headers: { "x-csrf-token": CSRF },
      payload: { reason: "Ilegible" },
    });
    expect(res.statusCode).toBe(401);
    expect(await statusOf(documentId)).toBe("FAILED");
  });

  it("sin la capacidad document.review responde 403, aunque el preparador esté asignado al cliente", async () => {
    const documentId = await createDocument("FAILED");
    const res = await reject("preparer", documentId);
    expect(res.statusCode).toBe(403);
    expect(await statusOf(documentId)).toBe("FAILED");
  });

  it("con el rol runtime (sin BYPASSRLS), un titular del estudio A no actúa sobre un documento del estudio B", async () => {
    const documentB = await createDocument("FAILED", {
      firmId: OTHER_FIRM,
      clientId: clientIds.other,
      uploaderId: USERS.otherOwner.id,
    });
    const ctxA: TenantContext = {
      userId: USERS.owner.id,
      firmId: FIRM,
      clientId: clientIds.a,
      actorKind: "USER",
    };
    await expect(runtimeService.reject(ctxA, documentB, "Ilegible")).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
      statusCode: 404,
    });
    expect(await statusOf(documentB)).toBe("FAILED");
    // Control: el mismo servicio con el rol runtime sí rechaza un FAILED del estudio A.
    const documentA = await createDocument("FAILED");
    await expect(runtimeService.reject(ctxA, documentA, "Ilegible")).resolves.toEqual({
      status: "EXTRACTION_FAILED",
    });
    expect(await statusOf(documentA)).toBe("EXTRACTION_FAILED");
  });
});
