import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSIGNED_CLIENT = "11111111-2222-4333-8444-555555555555";
const CSRF = "csrf-client-mutations-test-0123456789abcdef";

let app: FastifyInstance | null = null;
let ownerToken = "";
let preparerToken = "";
let clientId = "";
let duplicateClientId = "";
let initialCuit = "";

function validTestCuit(): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const check = (11 - (sum % 11)) % 11;
    if (check < 10) return `${base}${check}`;
  }
}

async function patchClient(
  token: string,
  targetClientId: string,
  payload: Record<string, unknown>,
) {
  return app!.inject({
    method: "PATCH",
    url: `/api/v1/firms/${FIRM_ALFA}/clients/${targetClientId}`,
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

  const assigned = await prisma.client.findFirst({
    where: { id: ASSIGNED_CLIENT, firmId: FIRM_ALFA },
    select: { id: true },
  });
  if (!assigned) throw new Error("seed-fase2 no cargado: falta el cliente Alfa Uno");

  ownerToken = randomBytes(32).toString("base64url");
  preparerToken = randomBytes(32).toString("base64url");
  await prisma.deviceSession.createMany({
    data: [
      {
        id: randomUUID(),
        userId: OWNER_A,
        refreshTokenHash: sha256(ownerToken),
        familyId: randomUUID(),
        rotationCounter: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
      {
        id: randomUUID(),
        userId: PREPARER_A,
        refreshTokenHash: sha256(preparerToken),
        familyId: randomUUID(),
        rotationCounter: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    ],
  });

  const firstCuit = validTestCuit();
  const secondCuit = validTestCuit();
  const first = await prisma.client.create({
    data: {
      firmId: FIRM_ALFA,
      legalName: `Test identidad ${randomUUID()}`,
      tradeName: "Nombre anterior",
      cuit: firstCuit,
      status: "ONBOARDING",
    },
  });
  const duplicate = await prisma.client.create({
    data: {
      firmId: FIRM_ALFA,
      legalName: `Test CUIT duplicado ${randomUUID()}`,
      cuit: secondCuit,
      status: "ACTIVE",
    },
  });
  clientId = first.id;
  duplicateClientId = duplicate.id;
  initialCuit = firstCuit;
});

afterAll(async () => {
  const hashes = [ownerToken, preparerToken].filter(Boolean).map(sha256);
  if (hashes.length > 0) {
    await prisma.deviceSession.deleteMany({ where: { refreshTokenHash: { in: hashes } } });
  }
  await app?.close();
  app = null;
});

describe("PATCH identidad de cliente — integración API/PostgreSQL", () => {
  it("preserva el ID, registra before/after con usuario y rechaza CUIT duplicado", async () => {
    const legalName = `Identidad actualizada ${randomUUID()}`;
    const response = await patchClient(ownerToken, clientId, {
      legalName,
      tradeName: "Nombre comercial actualizado",
      cuit: validTestCuit(),
      status: "ACTIVE",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.id).toBe(clientId);
    expect(response.json().data.legalName).toBe(legalName);
    expect(response.json().data.status).toBe("ACTIVE");

    const stored = await prisma.client.findFirstOrThrow({ where: { id: clientId, firmId: FIRM_ALFA } });
    expect(stored.id).toBe(clientId);
    expect(stored.legalName).toBe(legalName);
    expect(stored.tradeName).toBe("Nombre comercial actualizado");
    expect(stored.cuit).not.toBe(initialCuit);

    const audit = await prisma.auditEvent.findFirst({
      where: {
        firmId: FIRM_ALFA,
        clientId,
        userId: OWNER_A,
        entityType: "Client",
        entityId: clientId,
        action: "client.updated",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(OWNER_A);
    expect(audit?.before).toMatchObject({ legalName: expect.any(String), status: "ONBOARDING" });
    expect(audit?.after).toMatchObject({ legalName, status: "ACTIVE" });
    expect(audit?.before).toMatchObject({ cuit: "[REDACTED]" });
    expect(audit?.after).toMatchObject({ cuit: "[REDACTED]" });

    const auditCountBeforeConflict = await prisma.auditEvent.count({
      where: { firmId: FIRM_ALFA, entityId: clientId, action: "client.updated" },
    });
    const duplicateCuit = await prisma.client.findUniqueOrThrow({ where: { id: duplicateClientId } });
    const conflict = await patchClient(ownerToken, clientId, { cuit: duplicateCuit.cuit });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("CLIENT_CUIT_CONFLICT");
    expect(conflict.json().error.message).toContain("ese CUIT en este estudio");
    expect(await prisma.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({
      legalName,
      status: "ACTIVE",
    });
    expect(
      await prisma.auditEvent.count({
        where: { firmId: FIRM_ALFA, entityId: clientId, action: "client.updated" },
      }),
    ).toBe(auditCountBeforeConflict);
  });

  it("devuelve 403 a un miembro asignado sin client.manage", async () => {
    const before = await prisma.client.findUniqueOrThrow({ where: { id: ASSIGNED_CLIENT } });
    const response = await patchClient(preparerToken, ASSIGNED_CLIENT, {
      legalName: `No autorizado ${randomUUID()}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CAPABILITY_REQUIRED");
    expect(await prisma.client.findUniqueOrThrow({ where: { id: ASSIGNED_CLIENT } })).toMatchObject({
      legalName: before.legalName,
      cuit: before.cuit,
    });
  });
});
