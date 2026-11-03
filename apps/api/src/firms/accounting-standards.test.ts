import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Integración del catálogo de normas contables por estudio (decisión de
 * producto TataInti) contra PostgreSQL real con migraciones + seed-fase2:
 * CRUD desde Administración, aislamiento de estudio y validación del PATCH
 * de perfil contra el catálogo.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
// Usuario sin membresía en ninguna firma: la DB de pruebas es compartida y
// otras suites pueden agregar membresías de OWNER_B, así que el aislamiento
// se prueba con un usuario dedicado y sin membresías.
const OUTSIDER = "77aa11bb-0000-4000-8000-0000000000aa";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRM_BETA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CSRF = "csrf-test-token-0123456789abcdef0123456789abcdef";

let app: FastifyInstance | null = null;
let refreshTokenA = "";
let refreshTokenOutsider = "";
let clientId = "";

async function requestAlfa(
  method: "GET" | "POST" | "PATCH",
  path: string,
  payload?: Record<string, unknown>,
  token = refreshTokenA,
) {
  return app!.inject({
    method,
    url: `/api/v1/firms/${FIRM_ALFA}${path}`,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    ...(payload ? { payload } : {}),
  });
}

beforeAll(async () => {
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  const client = await prisma.client.findFirst({ where: { firmId: FIRM_ALFA } });
  if (!client) throw new Error("seed-fase2 no cargado: falta cliente de FIRM_ALFA");
  clientId = client.id;
  await prisma.clientProfile.upsert({
    where: { clientId },
    update: { accountingStandard: null },
    create: { firmId: FIRM_ALFA, clientId, functionalCurrency: "ARS" },
  });

  // Catálogo de FIRM_BETA: otra firma no debe verlo ni mutarlo.
  await prisma.accountingStandard.deleteMany({ where: { firmId: { in: [FIRM_ALFA, FIRM_BETA] } } });
  await prisma.accountingStandard.create({
    data: { firmId: FIRM_BETA, name: "Norma de Beta" },
  });

  // Usuario sin membresías (el usuario persiste; la sesión se limpia en afterAll).
  await prisma.user.upsert({
    where: { emailNormalized: "outsider-accounting-standards@test.invalid" },
    update: {},
    create: {
      id: OUTSIDER,
      emailNormalized: "outsider-accounting-standards@test.invalid",
      name: "Usuario externo",
      passwordHash: "-",
    },
  });

  for (const [userId, setter] of [
    [OWNER_A, (value: string) => (refreshTokenA = value)],
    [OUTSIDER, (value: string) => (refreshTokenOutsider = value)],
  ] as const) {
    const refreshToken = randomBytes(32).toString("base64url");
    await prisma.deviceSession.create({
      data: {
        id: randomUUID(),
        userId,
        refreshTokenHash: sha256(refreshToken),
        familyId: randomUUID(),
        rotationCounter: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    setter(refreshToken);
  }
});

afterAll(async () => {
  await prisma.accountingStandard.deleteMany({ where: { firmId: { in: [FIRM_ALFA, FIRM_BETA] } } });
  await prisma.clientProfile.updateMany({
    where: { clientId },
    data: { accountingStandard: null },
  });
  for (const token of [refreshTokenA, refreshTokenOutsider]) {
    if (token) await prisma.deviceSession.deleteMany({ where: { refreshTokenHash: sha256(token) } });
  }
  await app?.close();
  app = null;
});

describe("catálogo de normas contables por estudio", () => {
  it("alta desde Administración y listado acotado al estudio (aislamiento)", async () => {
    const created = await requestAlfa("POST", "/accounting-standards", { name: "RTIC" });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ name: "RTIC", isActive: true });

    const list = await requestAlfa("GET", "/accounting-standards");
    expect(list.statusCode).toBe(200);
    const names = list.json().data.map((row: { name: string }) => row.name);
    expect(names).toContain("RTIC");
    // Aislamiento de estudio: el catálogo de Beta no aparece.
    expect(names).not.toContain("Norma de Beta");
  });

  it("rechaza duplicados insensibles a mayúsculas y espacios de borde", async () => {
    const duplicate = await requestAlfa("POST", "/accounting-standards", { name: "  rtic " });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACCOUNTING_STANDARD_DUPLICATE");
  });

  it("edita el nombre y desactiva sin borrar el valor", async () => {
    const list = await requestAlfa("GET", "/accounting-standards");
    const row = list.json().data.find((item: { name: string }) => item.name === "RTIC");

    const renamed = await requestAlfa("PATCH", `/accounting-standards/${row.id}`, {
      name: "RTIC v2",
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.name).toBe("RTIC v2");

    const deactivated = await requestAlfa("PATCH", `/accounting-standards/${row.id}`, {
      isActive: false,
    });
    expect(deactivated.statusCode).toBe(200);
    expect(deactivated.json().data.isActive).toBe(false);
  });

  it("rechaza renombrar sobre un nombre existente y opera sólo dentro del estudio", async () => {
    await requestAlfa("POST", "/accounting-standards", { name: "VENCER" });
    const list = await requestAlfa("GET", "/accounting-standards");
    const rtic = list.json().data.find((item: { name: string }) => item.name === "RTIC v2");

    const duplicate = await requestAlfa("PATCH", `/accounting-standards/${rtic.id}`, {
      name: "vencer",
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACCOUNTING_STANDARD_DUPLICATE");

    // Usuario sin membresías: no ve ni muta el catálogo de Alfa (deny-by-default).
    const foreign = await requestAlfa("GET", "/accounting-standards", undefined, refreshTokenOutsider);
    expect([403, 404]).toContain(foreign.statusCode);
    const foreignWrite = await requestAlfa(
      "POST",
      "/accounting-standards",
      { name: "Intrusión" },
      refreshTokenOutsider,
    );
    expect([403, 404]).toContain(foreignWrite.statusCode);
  });

  it("PATCH de norma de otra firma responde 404 sin cruzar datos", async () => {
    const betaCatalog = await prisma.accountingStandard.findFirst({ where: { firmId: FIRM_BETA } });
    const foreign = await requestAlfa("PATCH", `/accounting-standards/${betaCatalog!.id}`, {
      isActive: false,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe("ACCOUNTING_STANDARD_NOT_FOUND");
    const stillActive = await prisma.accountingStandard.findUniqueOrThrow({
      where: { id: betaCatalog!.id },
    });
    expect(stillActive.isActive).toBe(true);
  });
});

describe("PATCH de perfil — norma contable contra el catálogo del estudio", () => {
  it("rechaza con 422 un valor fuera del catálogo y no modifica el perfil", async () => {
    await prisma.clientProfile.update({
      where: { clientId },
      data: { accountingStandard: "Texto libre legacy" },
    });
    const res = await requestAlfa("PATCH", `/clients/${clientId}/profile`, {
      accountingStandard: "NIIF inventada",
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("ACCOUNTING_STANDARD_UNKNOWN");
    expect(body.error.details.unknown).toEqual(["NIIF inventada"]);
    expect(body.error.details.available).toContain("RTIC v2");
    const profile = await prisma.clientProfile.findUniqueOrThrow({ where: { clientId } });
    expect(profile.accountingStandard).toBe("Texto libre legacy");
  });

  it("acepta la norma inactiva del catálogo: desactivar no invalida fichas", async () => {
    const res = await requestAlfa("PATCH", `/clients/${clientId}/profile`, {
      accountingStandard: "RTIC v2",
    });
    expect(res.statusCode).toBe(200);
    const profile = await prisma.clientProfile.findUniqueOrThrow({ where: { clientId } });
    expect(profile.accountingStandard).toBe("RTIC v2");
  });

  it("canonicaliza mayúsculas y espacios al nombre del catálogo", async () => {
    const res = await requestAlfa("PATCH", `/clients/${clientId}/profile`, {
      accountingStandard: "  vencer ",
    });
    expect(res.statusCode).toBe(200);
    const profile = await prisma.clientProfile.findUniqueOrThrow({ where: { clientId } });
    expect(profile.accountingStandard).toBe("VENCER");
  });

  it("limpia la norma con cadena vacía y no exige catálogo cuando va vacía", async () => {
    const res = await requestAlfa("PATCH", `/clients/${clientId}/profile`, {
      accountingStandard: "",
    });
    expect(res.statusCode).toBe(200);
    const profile = await prisma.clientProfile.findUniqueOrThrow({ where: { clientId } });
    expect(profile.accountingStandard).toBeNull();
  });
});
