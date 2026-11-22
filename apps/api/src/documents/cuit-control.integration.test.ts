import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import type { TenantContext } from "../auth/tenant.js";
import { otrosClientesDelEstudio } from "./cuit-control-service.js";

/**
 * Control de CUIT en la Bandeja (brief 4A-2), por la ruta real y con el rol runtime (sin BYPASSRLS)
 * para la lectura de sugerencias. Datos sintéticos «Demo» con CUIT inventados y dígito verificador
 * válido. La base de pruebas es desechable: no se borran filas.
 */

const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const CSRF = randomBytes(32).toString("base64url");
const USERS = {
  owner: { id: randomUUID(), firmId: FIRM, role: "OWNER", name: "Titular Demo 4a2" },
  preparer: { id: randomUUID(), firmId: FIRM, role: "PREPARER", name: "Preparador Demo 4a2" },
  reviewer: { id: randomUUID(), firmId: FIRM, role: "REVIEWER", name: "Revisor Demo 4a2" },
} as const;
type UserKey = keyof typeof USERS;

const CUIT_A = "20111111112"; // cliente del documento
const CUIT_B = "30222222229"; // otro cliente del mismo estudio
const CUIT_EXTERNO = "27333333334"; // tercero sin cliente en el estudio
const CUIT_OTRO_ESTUDIO = "23333333334"; // cliente de otro estudio
const SOCIO = "20444444446"; // persona de un socio, no cliente

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
const tokens = {} as Record<UserKey, string>;
const clientIds = { a: "", b: "", otroEstudio: "" };

function request(user: UserKey, method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { refresh_token: tokens[user], csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    ...(payload ? { payload } : {}),
  });
}

const base = (clientId = clientIds.a) => `/api/v1/firms/${FIRM}/clients/${clientId}`;

/** Documento leído por la IA (EXTRACTED) con su extracción en revisión. */
async function crearDocumento(
  clientId: string,
  voucher: Record<string, unknown> | null,
  options: { status?: "EXTRACTED" | "REVIEWED"; extractionStatus?: "GENERATED" | "NEEDS_REVIEW" } = {},
): Promise<{ documentId: string; extractionId: string }> {
  const document = await prisma.document.create({
    data: {
      firmId: FIRM,
      clientId,
      uploadedByUserId: USERS.owner.id,
      uploadOrigin: "FIRM",
      status: options.status ?? "EXTRACTED",
    },
  });
  const version = await prisma.documentFileVersion.create({
    data: {
      firmId: FIRM,
      clientId,
      documentId: document.id,
      originalName: `cuit-${document.id}.pdf`,
      mimeType: "application/pdf",
      extension: "pdf",
      sizeBytes: 1,
      sha256: "d".repeat(64),
      bucket: "originals",
      objectKey: `test/cuit-${document.id}.pdf`,
      antivirusStatus: "CLEAN",
    },
  });
  const extraction = await prisma.documentExtraction.create({
    data: {
      firmId: FIRM,
      clientId,
      documentId: document.id,
      fileVersionId: version.id,
      schemaVersion: "voucher-ar-v2.1",
      status: options.extractionStatus ?? "NEEDS_REVIEW",
      ...(voucher ? { voucherData: voucher as Prisma.InputJsonValue } : {}),
    },
  });
  await prisma.document.update({
    where: { id: document.id },
    data: { currentExtractionId: extraction.id },
  });
  return { documentId: document.id, extractionId: extraction.id };
}

const voucher = (emisor: string | null, receptor: string | null) => ({
  tipo_documento: "factura",
  cuit_emisor: emisor,
  cuit_receptor: receptor,
});

const runAsRuntime = <T>(ctx: TenantContext, fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  runtimePrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${ctx.firmId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', ${ctx.clientId ?? ""}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', ${ctx.actorKind}, true)`;
    return fn(tx);
  });

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
      `Estudio Demo 4a2 ${firmId.slice(0, 8)}`,
    );
  }
  for (const user of Object.values(USERS)) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
      user.id,
      `${user.id}@cuit-4a2.test.local`,
      user.name,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'${user.role}','ACTIVE',now())`,
      user.firmId,
      user.id,
    );
  }

  const clientA = await prisma.client.create({
    data: { firmId: FIRM, legalName: "Cliente Demo 4a2 A", tradeName: "Demo A", cuit: CUIT_A, status: "ACTIVE" },
  });
  const clientB = await prisma.client.create({
    data: { firmId: FIRM, legalName: "Cliente Demo 4a2 B", tradeName: "Demo B", cuit: CUIT_B, status: "ACTIVE" },
  });
  const clientOtro = await prisma.client.create({
    data: {
      firmId: OTHER_FIRM,
      legalName: "Cliente Demo 4a2 otro estudio",
      tradeName: "Demo otro",
      cuit: CUIT_OTRO_ESTUDIO,
      status: "ACTIVE",
    },
  });
  clientIds.a = clientA.id;
  clientIds.b = clientB.id;
  clientIds.otroEstudio = clientOtro.id;
  // El preparador solo tiene asignado el cliente A: no debe ver ni recibir al B como destino.
  await prisma.clientAssignment.create({ data: { firmId: FIRM, clientId: clientA.id, userId: USERS.preparer.id } });
  await prisma.clientAssignment.create({ data: { firmId: FIRM, clientId: clientA.id, userId: USERS.reviewer.id } });

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

describe("control de CUIT en la Bandeja (4A-2)", () => {
  it("un comprobante donde el cliente es el emisor figura como correcto y se aprueba", async () => {
    const { documentId, extractionId } = await crearDocumento(clientIds.a, voucher(CUIT_A, CUIT_EXTERNO));

    const detalle = await request("owner", "GET", `${base()}/documents/${documentId}`);
    expect(detalle.statusCode).toBe(200);
    expect(detalle.json().data.cuitControl).toMatchObject({ estado: "CORRECTO", pendiente: false, mensaje: null });

    const aprobado = await request("owner", "POST", `${base()}/extractions/${extractionId}/approve`);
    expect(aprobado.statusCode).toBe(200);
    expect(aprobado.json()).toEqual({ data: { status: "REVIEWED" } });
  });

  it("un comprobante de otro cliente del estudio queda pendiente con sugerencia y no se aprueba", async () => {
    const { documentId, extractionId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO));

    const lista = await request("owner", "GET", `${base()}/documents`);
    const fila = lista.json().data.find((d: { id: string }) => d.id === documentId);
    expect(fila.cuitControl).toMatchObject({
      estado: "OTRO_CLIENTE",
      pendiente: true,
      aceptado: false,
      sugerido: { clientId: clientIds.b, legalName: "Cliente Demo 4a2 B" },
    });
    expect(fila.cuitControl.mensaje).toBe(
      "Este comprobante es del CUIT 30-22222222-9, que corresponde a Cliente Demo 4a2 B (no a Cliente Demo 4a2 A).",
    );
    // Los campos internos de aceptación no salen en la respuesta.
    expect(fila).not.toHaveProperty("cuitAcceptedReason");
    expect(fila).not.toHaveProperty("cuitAcceptedByUserId");

    const aprobar = await request("owner", "POST", `${base()}/extractions/${extractionId}/approve`);
    expect(aprobar.statusCode).toBe(409);
    expect(aprobar.json().error.code).toBe("CUIT_PENDIENTE");
    expect(aprobar.json().error.message).toContain("Falta revisar el CUIT");
    const enBase = await prisma.document.findUniqueOrThrow({ where: { id: documentId }, select: { status: true } });
    expect(enBase.status).toBe("EXTRACTED");
  });

  it("la sugerencia nunca nombra clientes de otro estudio", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_OTRO_ESTUDIO, CUIT_EXTERNO));
    const detalle = await request("owner", "GET", `${base()}/documents/${documentId}`);
    expect(detalle.json().data.cuitControl.sugerido).toBeNull();
    expect(detalle.json().data.cuitControl.mensaje).not.toContain("otro estudio");
  });

  it("el revisor asignado solo al cliente A no recibe a B como sugerencia ni como destino", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO));
    const detalle = await request("reviewer", "GET", `${base()}/documents/${documentId}`);
    expect(detalle.statusCode).toBe(200);
    expect(detalle.json().data.cuitControl.estado).toBe("OTRO_CLIENTE");
    expect(detalle.json().data.cuitControl.sugerido).toBeNull();

    const mover = await request("reviewer", "POST", `${base()}/documents/${documentId}/cuit/move`, {
      clientId: clientIds.b,
    });
    expect(mover.statusCode).toBe(404);
    expect(mover.json().error.code).toBe("CLIENT_NOT_FOUND");
    const documento = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(documento.clientId).toBe(clientIds.a);
  });

  it("el preparador, sin permiso de revisión, no puede mover ni aceptar un CUIT", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO));
    const mover = await request("preparer", "POST", `${base()}/documents/${documentId}/cuit/move`, {
      clientId: clientIds.b,
    });
    expect(mover.statusCode).toBe(403);
    const aceptar = await request("preparer", "POST", `${base()}/documents/${documentId}/cuit/accept`, {
      reason: "Intento sin permiso",
    });
    expect(aceptar.statusCode).toBe(403);
  });


  it("la lectura de sugerencias en contexto runtime solo trae clientes del estudio con acceso", async () => {
    const ctxOwner: TenantContext = { userId: USERS.owner.id, firmId: FIRM, actorKind: "USER" };
    const ctxPreparer: TenantContext = { userId: USERS.preparer.id, firmId: FIRM, actorKind: "USER" };
    const deOwner = await runAsRuntime(ctxOwner, (tx) => otrosClientesDelEstudio(tx, FIRM, clientIds.a));
    const dePreparer = await runAsRuntime(ctxPreparer, (tx) => otrosClientesDelEstudio(tx, FIRM, clientIds.a));
    expect(deOwner.map((c) => c.id)).toContain(clientIds.b);
    expect(deOwner.map((c) => c.id)).not.toContain(clientIds.otroEstudio);
    expect(dePreparer.map((c) => c.id)).not.toContain(clientIds.b);
  });

  it("aceptar con motivo deja el documento aprobable y registra quién, cuándo y por qué", async () => {
    const { documentId, extractionId } = await crearDocumento(clientIds.a, voucher(SOCIO, CUIT_EXTERNO));

    const aceptado = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/accept`, {
      reason: "Comprobante a nombre de un socio",
    });
    expect(aceptado.statusCode).toBe(200);
    expect(aceptado.json()).toEqual({ data: { aceptado: true } });

    const detalle = await request("owner", "GET", `${base()}/documents/${documentId}`);
    expect(detalle.json().data.cuitControl).toMatchObject({
      estado: "OTRO_CLIENTE",
      pendiente: false,
      aceptado: true,
      motivo: "Comprobante a nombre de un socio",
    });

    const aprobado = await request("owner", "POST", `${base()}/extractions/${extractionId}/approve`);
    expect(aprobado.statusCode).toBe(200);

    const auditoria = await prisma.auditEvent.findMany({
      where: { action: "document.cuit.accepted", entityId: documentId },
    });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      userId: USERS.owner.id,
      before: { estado: "OTRO_CLIENTE" },
      after: { extractionId, reason: "Comprobante a nombre de un socio" },
    });
  });

  it("aceptar exige un motivo de al menos tres caracteres", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(SOCIO, CUIT_EXTERNO));
    const res = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/accept`, { reason: "ok" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("MOTIVO_REQUERIDO");
  });

  it("aceptar dos veces el mismo CUIT se rechaza sin volver a registrar", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(SOCIO, CUIT_EXTERNO));
    const primera = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/accept`, { reason: "Socio" });
    expect(primera.statusCode).toBe(200);
    const segunda = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/accept`, { reason: "Socio" });
    expect(segunda.statusCode).toBe(409);
    expect(segunda.json().error.code).toBe("CUIT_YA_ACEPTADO");
  });

  it("no hace falta aceptar el CUIT de un comprobante que ya coincide con el cliente", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_A, CUIT_EXTERNO));
    const res = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/accept`, { reason: "No aplica" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("CUIT_EN_ORDEN");
  });

  it("un CUIT no leído bloquea la aprobación hasta confirmarlo con motivo", async () => {
    const { documentId, extractionId } = await crearDocumento(clientIds.a, voucher(null, null));

    const detalle = await request("owner", "GET", `${base()}/documents/${documentId}`);
    expect(detalle.json().data.cuitControl).toMatchObject({ estado: "NO_LEIDO", pendiente: true });

    const bloqueado = await request("owner", "POST", `${base()}/extractions/${extractionId}/approve`);
    expect(bloqueado.statusCode).toBe(409);
    expect(bloqueado.json().error.code).toBe("CUIT_PENDIENTE");

    const confirmado = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/accept`, {
      reason: "Revisado a mano: ticket del cliente",
    });
    expect(confirmado.statusCode).toBe(200);
    const aprobado = await request("owner", "POST", `${base()}/extractions/${extractionId}/approve`);
    expect(aprobado.statusCode).toBe(200);
  });

  it("«Mover a» lleva el documento y sus filas al cliente del estudio que corresponde", async () => {
    const { documentId, extractionId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO));

    const movido = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/move`, {
      clientId: clientIds.b,
    });
    expect(movido.statusCode).toBe(200);
    expect(movido.json()).toEqual({ data: { clientId: clientIds.b } });

    const documento = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(documento.clientId).toBe(clientIds.b);
    const extraccion = await prisma.documentExtraction.findUniqueOrThrow({ where: { id: extractionId } });
    expect(extraccion.clientId).toBe(clientIds.b);
    const version = await prisma.documentFileVersion.findFirstOrThrow({ where: { documentId } });
    expect(version.clientId).toBe(clientIds.b);

    const enB = await request("owner", "GET", `${base(clientIds.b)}/documents/${documentId}`);
    expect(enB.statusCode).toBe(200);
    expect(enB.json().data.cuitControl).toMatchObject({ estado: "CORRECTO", pendiente: false });

    const auditoria = await prisma.auditEvent.findMany({ where: { action: "document.cuit.moved", entityId: documentId } });
    expect(auditoria[0]).toMatchObject({ before: { clientId: clientIds.a }, after: { clientId: clientIds.b } });
  });

  it("mover al mismo cliente se rechaza con un mensaje claro", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO));
    const res = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/move`, { clientId: clientIds.a });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("MISMO_CLIENTE");
  });

  it("no se mueve a un cliente de otro estudio", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO));
    const res = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/move`, {
      clientId: clientIds.otroEstudio,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("CLIENT_NOT_FOUND");
    const documento = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(documento.clientId).toBe(clientIds.a);
  });

  it("no se mueve un documento vinculado a un comprobante o gasto", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO));
    await prisma.evidenceLink.create({
      data: { firmId: FIRM, clientId: clientIds.a, targetType: "FISCAL_VOUCHER", targetId: randomUUID(), documentId },
    });
    const res = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/move`, { clientId: clientIds.b });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DOCUMENT_LINKED");
    const documento = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(documento.clientId).toBe(clientIds.a);
  });

  it("un documento ya aprobado no se mueve", async () => {
    const { documentId } = await crearDocumento(clientIds.a, voucher(CUIT_B, CUIT_EXTERNO), { status: "REVIEWED" });
    const res = await request("owner", "POST", `${base()}/documents/${documentId}/cuit/move`, { clientId: clientIds.b });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DOCUMENT_NOT_MOVABLE");
  });
});
