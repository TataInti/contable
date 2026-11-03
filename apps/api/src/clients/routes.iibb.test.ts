import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Integración de la validación de jurisdicciones IIBB del PATCH de perfil
 * contra PostgreSQL real (auditoría de catálogos). Requiere DATABASE_URL
 * apuntando a una DB con migraciones + seed-fase2 aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CSRF = "csrf-test-token-0123456789abcdef0123456789abcdef";

let app: FastifyInstance | null = null;
let refreshToken = "";
let clientId = "";

async function patchProfile(body: Record<string, unknown>) {
  return app!.inject({
    method: "PATCH",
    url: `/api/v1/firms/${FIRM_ALFA}/clients/${clientId}/profile`,
    cookies: { refresh_token: refreshToken, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload: body,
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

  // seed-fase2 inserta clientes por SQL directo y no crea perfil; lo dejamos
  // en un estado conocido para las pruebas del PATCH.
  await prisma.clientProfile.upsert({
    where: { clientId },
    update: { iibbJurisdictions: [] },
    create: { firmId: FIRM_ALFA, clientId, functionalCurrency: "ARS" },
  });

  // Catálogo mínimo de jurisdicciones (equivalente al seed de maestros).
  const ar = await prisma.jurisdiction.upsert({
    where: { code: "AR" },
    update: {},
    create: { code: "AR", name: "Argentina (Nación)", kind: "NATIONAL" },
  });
  await prisma.jurisdiction.upsert({
    where: { code: "AR-T" },
    update: {},
    create: { code: "AR-T", name: "Provincia de Tucumán", kind: "PROVINCIAL", parentId: ar.id },
  });
  await prisma.jurisdiction.upsert({
    where: { code: "TUC" },
    update: {},
    create: { code: "TUC", name: "Tucumán — Convenio Multilateral", kind: "PROVINCIAL", parentId: ar.id },
  });

  // Sesión real: refresh opaco guardado hasheado (ADR-006).
  refreshToken = randomBytes(32).toString("base64url");
  await prisma.deviceSession.create({
    data: {
      id: randomUUID(),
      userId: OWNER_A,
      refreshTokenHash: sha256(refreshToken),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
});

afterAll(async () => {
  if (refreshToken) {
    await prisma.deviceSession.deleteMany({ where: { refreshTokenHash: sha256(refreshToken) } });
  }
  await app?.close();
  app = null;
});

describe("PATCH profile — jurisdicciones IIBB contra catálogo", () => {
  afterEach(async () => {
    await prisma.clientProfile.updateMany({
      where: { clientId },
      data: { iibbJurisdictions: [] },
    });
  });

  it("rechaza con 422 valores fuera del catálogo y no modifica el perfil", async () => {
    await prisma.clientProfile.updateMany({
      where: { clientId },
      data: { iibbJurisdictions: ["AR-T"] },
    });
    const res = await patchProfile({ iibbJurisdictions: ["AR-T", "Jurisdicción inventada"] });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("IIBB_JURISDICTION_UNKNOWN");
    expect(body.error.details.unknown).toEqual(["Jurisdicción inventada"]);
    expect(body.error.details.available).toContain("AR-T");
    const profile = await prisma.clientProfile.findUniqueOrThrow({ where: { clientId } });
    expect(profile.iibbJurisdictions).toEqual(["AR-T"]);
  });

  it("acepta códigos y nombres del catálogo y guarda canónicos deduplicados", async () => {
    const res = await patchProfile({
      iibbJurisdictions: ["Provincia de Tucumán", "tuc", "AR-T"],
    });
    expect(res.statusCode).toBe(200);
    const profile = await prisma.clientProfile.findUniqueOrThrow({ where: { clientId } });
    expect(profile.iibbJurisdictions).toEqual(["AR-T", "TUC"]);
  });

  it("acepta limpiar la lista con un array vacío", async () => {
    await prisma.clientProfile.updateMany({
      where: { clientId },
      data: { iibbJurisdictions: ["AR-T"] },
    });
    const res = await patchProfile({ iibbJurisdictions: [] });
    expect(res.statusCode).toBe(200);
    const profile = await prisma.clientProfile.findUniqueOrThrow({ where: { clientId } });
    expect(profile.iibbJurisdictions).toEqual([]);
  });

  it("rechaza moneda funcional fuera del catálogo respaldado (400 de validación)", async () => {
    const res = await patchProfile({ functionalCurrency: "EUR" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});
