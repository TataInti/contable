import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { professionalCredentialListResponseSchema } from "@contable/contracts";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import type { TenantContext } from "../auth/tenant.js";
import { TaxpayerProfileService } from "./fiscal-foundation-service.js";

/**
 * Ficha del profesional (A4-2a): matrículas de un miembro por la ruta real
 * GET /api/v1/firms/:firmId/users/:userId/credentials y por el servicio con el rol
 * runtime (sin BYPASSRLS). Datos sintéticos rotulados «Demo», con identificadores
 * aleatorios por corrida. La base de pruebas es desechable: no se borran filas.
 *
 * En NODE_ENV=test la ruta usa DATABASE_URL (superusuario, sin RLS). El aislamiento
 * entre estudios lo dan el filtro por estudio y la membresía de la consulta. La política
 * firm_scope_select de professional_credentials no compara el firmId de cada fila (hallazgo
 * reportado en el PR), así que la prueba de aislamiento corre con el rol runtime sobre el
 * servicio: no lista matrículas de otro estudio.
 */

type Login = "ownerA" | "adminA" | "preparerA" | "reviewerA" | "ownerB";
type Member = "targetA" | "emptyA" | "suspendedA" | "sharedUser" | "outsiderB" | Login;

const FIRM_A = randomUUID();
const FIRM_B = randomUUID();
const LOGINS: readonly Login[] = ["ownerA", "adminA", "preparerA", "reviewerA", "ownerB"];
const ID: Record<Member, string> = {
  ownerA: randomUUID(),
  adminA: randomUUID(),
  preparerA: randomUUID(),
  reviewerA: randomUUID(),
  ownerB: randomUUID(),
  targetA: randomUUID(),
  emptyA: randomUUID(),
  suspendedA: randomUUID(),
  sharedUser: randomUUID(),
  outsiderB: randomUUID(),
};
const MEMBERSHIPS = [
  { firmId: FIRM_A, userId: ID.ownerA, role: "OWNER", status: "ACTIVE" },
  { firmId: FIRM_A, userId: ID.adminA, role: "ADMIN", status: "ACTIVE" },
  { firmId: FIRM_A, userId: ID.preparerA, role: "PREPARER", status: "ACTIVE" },
  { firmId: FIRM_A, userId: ID.reviewerA, role: "REVIEWER", status: "ACTIVE" },
  { firmId: FIRM_A, userId: ID.targetA, role: "PREPARER", status: "ACTIVE" },
  { firmId: FIRM_A, userId: ID.emptyA, role: "PREPARER", status: "ACTIVE" },
  { firmId: FIRM_A, userId: ID.suspendedA, role: "PREPARER", status: "SUSPENDED" },
  { firmId: FIRM_A, userId: ID.sharedUser, role: "PREPARER", status: "ACTIVE" },
  { firmId: FIRM_B, userId: ID.ownerB, role: "OWNER", status: "ACTIVE" },
  { firmId: FIRM_B, userId: ID.sharedUser, role: "REVIEWER", status: "ACTIVE" },
  { firmId: FIRM_B, userId: ID.outsiderB, role: "PREPARER", status: "ACTIVE" },
] as const;

type ListBody = { data: Array<{ registrationNumber: string; status: string }> };
const registrationsOf = (body: ListBody) => body.data.map((row) => row.registrationNumber);

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
const tokens = {} as Record<Login, string>;

/** Transacción con el rol runtime y el contexto RLS de la sesión, como withTenantContext. */
const asRuntime =
  (userId: string, firmId: string) =>
  <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    runtimePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${firmId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      return fn(tx);
    });

const listAs = (login: Login | null, firmId: string, userId: string) =>
  app.inject({
    method: "GET",
    url: `/api/v1/firms/${firmId}/users/${userId}/credentials`,
    ...(login ? { cookies: { refresh_token: tokens[login] } } : {}),
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

  const jurisdictions = await prisma.jurisdiction.findMany({ orderBy: { name: "asc" }, take: 2 });
  const [jFirst, jSecond] = jurisdictions;
  if (!jFirst || !jSecond || jFirst.name === jSecond.name) {
    throw new Error(
      "seed-maestros-fiscales no cargado: hacen falta dos jurisdicciones con nombres distintos",
    );
  }
  const authority = await prisma.taxAuthority.findFirstOrThrow({ orderBy: { code: "asc" } });

  await prisma.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now()), ($3,$4,$4,now())`,
    FIRM_A,
    "Demo estudio A (matrículas)",
    FIRM_B,
    "Demo estudio B (matrículas)",
  );
  for (const userId of Object.values(ID)) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
      userId,
      `${userId}@matriculas.demo.test.local`,
      `Demo ${userId.slice(0, 8)}`,
    );
  }
  for (const m of MEMBERSHIPS) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'${m.role}','${m.status}',now())`,
      m.firmId,
      m.userId,
    );
  }

  const sessions = LOGINS.map((login) => {
    const token = randomBytes(32).toString("base64url");
    tokens[login] = token;
    return {
      id: randomUUID(),
      userId: ID[login],
      refreshTokenHash: sha256(token),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
  });
  await prisma.deviceSession.createMany({ data: sessions });

  const credential = (
    firmId: string,
    userId: string,
    jurisdictionId: string,
    registrationNumber: string,
    status: "ACTIVE" | "SUSPENDED" | "EXPIRED",
    validFrom: string,
    validTo: string | null,
  ) =>
    prisma.professionalCredential.create({
      data: {
        firmId,
        userId,
        jurisdictionId,
        authorityId: authority.id,
        registrationNumber,
        status,
        validFrom: new Date(validFrom),
        validTo: validTo ? new Date(validTo) : null,
      },
    });
  // Orden esperado del titular: jurisdicción por nombre, luego número. DEMO-100 está suspendida y debe listarse.
  await credential(FIRM_A, ID.targetA, jSecond.id, "DEMO-200", "ACTIVE", "2024-03-01", null);
  await credential(FIRM_A, ID.targetA, jFirst.id, "DEMO-300", "ACTIVE", "2025-01-01", "2027-12-31");
  await credential(FIRM_A, ID.targetA, jFirst.id, "DEMO-100", "SUSPENDED", "2023-06-01", null);
  await credential(FIRM_A, ID.suspendedA, jFirst.id, "DEMO-700", "ACTIVE", "2025-02-01", null);
  await credential(FIRM_A, ID.sharedUser, jFirst.id, "DEMO-A-500", "ACTIVE", "2025-01-01", null);
  await credential(FIRM_B, ID.sharedUser, jFirst.id, "DEMO-B-600", "ACTIVE", "2025-01-01", null);
  await credential(FIRM_B, ID.outsiderB, jFirst.id, "DEMO-O-800", "ACTIVE", "2025-01-01", null);
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtimePrisma?.$disconnect();
});

describe("ficha del profesional (A4-2a): lectura de matrículas de un miembro", () => {
  it("el Titular y el Administrador ven las matrículas de otro miembro, en orden y con todos los estados", async () => {
    for (const login of ["ownerA", "adminA"] as const) {
      const res = await listAs(login, FIRM_A, ID.targetA);
      expect(res.statusCode).toBe(200);
      expect(professionalCredentialListResponseSchema.safeParse(res.json()).success).toBe(true);
      expect(registrationsOf(res.json())).toEqual(["DEMO-100", "DEMO-300", "DEMO-200"]);
      expect(res.json().data[0]).toMatchObject({ status: "SUSPENDED", validTo: null });
    }
  });

  it("el Revisor y el Preparador reciben 403 con la capacidad que les falta", async () => {
    for (const login of ["reviewerA", "preparerA"] as const) {
      const res = await listAs(login, FIRM_A, ID.targetA);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        error: { code: "CAPABILITY_REQUIRED", message: "Falta la capacidad firm.users.manage" },
      });
    }
  });

  it("un miembro sin matrículas responde 200 con data vacía", async () => {
    const res = await listAs("ownerA", FIRM_A, ID.emptyA);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });

  it("un usuario ajeno al estudio responde 404 sin revelar si existe en otro estudio", async () => {
    const otroEstudio = await listAs("ownerA", FIRM_A, ID.outsiderB);
    const inexistente = await listAs("ownerA", FIRM_A, randomUUID());
    expect(otroEstudio.statusCode).toBe(404);
    expect(inexistente.statusCode).toBe(404);
    expect(otroEstudio.json()).toEqual(inexistente.json());
    expect(otroEstudio.json()).toMatchObject({ error: { code: "MEMBER_NOT_FOUND" } });
    const desdeB = await listAs("ownerB", FIRM_B, ID.targetA);
    expect(desdeB.statusCode).toBe(404);
  });

  it("un miembro suspendido conserva sus matrículas visibles para quien administra", async () => {
    const res = await listAs("ownerA", FIRM_A, ID.suspendedA);
    expect(res.statusCode).toBe(200);
    expect(registrationsOf(res.json())).toEqual(["DEMO-700"]);
  });

  it("un Titular de otro estudio no ve las matrículas del estudio de la ruta aunque conozca el userId", async () => {
    const deA = await listAs("ownerA", FIRM_A, ID.sharedUser);
    const deB = await listAs("ownerB", FIRM_B, ID.sharedUser);
    expect(deA.statusCode).toBe(200);
    expect(deB.statusCode).toBe(200);
    expect(registrationsOf(deA.json())).toEqual(["DEMO-A-500"]);
    expect(registrationsOf(deB.json())).toEqual(["DEMO-B-600"]);
  });

  it("sin sesión responde 401", async () => {
    const res = await listAs(null, FIRM_A, ID.targetA);
    expect(res.statusCode).toBe(401);
  });

  it("la tabla professional_credentials tiene RLS habilitada y forzada", async () => {
    const [tabla] = await prisma.$queryRaw<
      Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'professional_credentials'`;
    expect(tabla).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("el servicio con el rol runtime lista solo las del estudio de la ruta", async () => {
    const servicio = new TaxpayerProfileService();
    const ctxA: TenantContext = { userId: ID.ownerA, firmId: FIRM_A, actorKind: "USER" };
    const listadas = await servicio.listMemberCredentials(
      ctxA,
      ID.sharedUser,
      asRuntime(ID.ownerA, FIRM_A),
    );
    expect(listadas.map((r) => r.registrationNumber)).toEqual(["DEMO-A-500"]);
    const ctxB: TenantContext = { userId: ID.ownerB, firmId: FIRM_B, actorKind: "USER" };
    const listadasB = await servicio.listMemberCredentials(
      ctxB,
      ID.sharedUser,
      asRuntime(ID.ownerB, FIRM_B),
    );
    expect(listadasB.map((r) => r.registrationNumber)).toEqual(["DEMO-B-600"]);
    const suspendido = await servicio.listMemberCredentials(
      ctxA,
      ID.suspendedA,
      asRuntime(ID.ownerA, FIRM_A),
    );
    expect(suspendido.map((r) => r.registrationNumber)).toEqual(["DEMO-700"]);
    await expect(
      servicio.listMemberCredentials(ctxA, ID.outsiderB, asRuntime(ID.ownerA, FIRM_A)),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
  });
});
