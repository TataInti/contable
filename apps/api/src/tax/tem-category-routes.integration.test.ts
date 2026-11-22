import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Categoría anual del TEM por HTTP (corte 1E): permisos, errores con campo y aislamiento por estudio.
 * Usa los estudios y titulares del seed-fase2 y un cliente propio con CUIT inventado.
 */

const OWNER_ALFA = "11111111-1111-4111-8111-111111111111";
const OWNER_BETA = "22222222-2222-4222-8222-222222222222";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CSRF = "csrf-tem-category-test-0123456789abcdef";

let app: FastifyInstance | null = null;
let alfaToken = "";
let betaToken = "";
let clientId = "";

const base = () => `/api/v1/firms/${FIRM_ALFA}/clients/${clientId}/tem-categories`;

function get(token: string, url: string) {
  return app!.inject({ method: "GET", url, cookies: { refresh_token: token } });
}

function put(token: string, url: string, payload: Record<string, unknown>) {
  return app!.inject({
    method: "PUT",
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload,
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
  alfaToken = randomBytes(32).toString("base64url");
  betaToken = randomBytes(32).toString("base64url");
  await prisma.deviceSession.createMany({
    data: [
      [OWNER_ALFA, alfaToken],
      [OWNER_BETA, betaToken],
    ].map(([userId, token]) => ({
      id: randomUUID(),
      userId: userId!,
      refreshTokenHash: sha256(token!),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })),
  });
  const client = await prisma.client.create({
    data: {
      firmId: FIRM_ALFA,
      legalName: `Cliente categoría TEM ${randomUUID()}`,
      cuit: "30999999991",
      status: "ACTIVE",
    },
  });
  clientId = client.id;
});

afterAll(async () => {
  await prisma.clientTemCategory.deleteMany({ where: { clientId } });
  await prisma.client.deleteMany({ where: { id: clientId } });
  await prisma.deviceSession.deleteMany({
    where: { refreshTokenHash: { in: [alfaToken, betaToken].filter(Boolean).map(sha256) } },
  });
  await app?.close();
  app = null;
});

describe("categoría anual del TEM — API", () => {
  it("sin categoría informa que falta y ofrece el catálogo del año", async () => {
    const response = await get(alfaToken, `${base()}?year=2026`);
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.category).toBeNull();
    expect(data.options).toHaveLength(6);
    expect(data.options[1]).toMatchObject({ category: "B", minimum: "10028.00" });
  });

  it("elige la categoría del año y la devuelve con su mínimo", async () => {
    const saved = await put(alfaToken, `${base()}/2026`, { category: "B" });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ year: 2026, category: "B", minimum: "10028.00" });
    const read = await get(alfaToken, `${base()}?year=2026`);
    expect(read.json().data).toMatchObject({ category: "B", label: "B", minimum: "10028.00" });
  });

  it("una categoría inválida devuelve el campo y el motivo", async () => {
    const response = await put(alfaToken, `${base()}/2026`, { category: "Z" });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({
      code: "TEM_CATEGORY_UNKNOWN",
      details: { path: ["category"] },
    });
    const vacia = await put(alfaToken, `${base()}/2026`, { category: "" });
    expect(vacia.statusCode).toBe(400);
    expect(vacia.json().error.details[0].path).toEqual(["category"]);
  });

  it("otro estudio no accede a la categoría de este cliente", async () => {
    const read = await get(betaToken, `${base()}?year=2026`);
    expect([403, 404]).toContain(read.statusCode);
    const write = await put(betaToken, `${base()}/2026`, { category: "E" });
    expect([403, 404]).toContain(write.statusCode);
    const stored = await prisma.clientTemCategory.findFirst({ where: { clientId, year: 2026 } });
    expect(stored?.category).toBe("B");
  });
});
