import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRM_BETA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSIGNED_CLIENT = "11111111-2222-4333-8444-555555555555";
const CLIENT_BETA = "22222222-3333-4444-8555-777777777777";
const CSRF = "csrf-client-mutations-test-0123456789abcdef";

let app: FastifyInstance | null = null;
let ownerToken = "";
let preparerToken = "";
let clientId = "";
let duplicateClientId = "";
let initialCuit = "";
let runtimePrisma: PrismaClient | null = null;

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

async function listContacts(token: string, targetClientId: string) {
  return app!.inject({
    method: "GET",
    url: `/api/v1/firms/${FIRM_ALFA}/clients/${targetClientId}/contacts`,
    cookies: { refresh_token: token },
  });
}

async function createContact(
  token: string,
  targetClientId: string,
  payload: Record<string, unknown>,
) {
  return app!.inject({
    method: "POST",
    url: `/api/v1/firms/${FIRM_ALFA}/clients/${targetClientId}/contacts`,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload,
  });
}

async function patchContact(
  token: string,
  targetClientId: string,
  contactId: string,
  payload: Record<string, unknown>,
) {
  return app!.inject({
    method: "PATCH",
    url: `/api/v1/firms/${FIRM_ALFA}/clients/${targetClientId}/contacts/${contactId}`,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload,
  });
}

async function runAsRuntime<T>(
  userId: string,
  firmId: string,
  scopedClientId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!runtimePrisma) throw new Error("RUNTIME_DATABASE_URL debe apuntar a una base de pruebas desechable");
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${firmId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', ${scopedClientId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
    return fn(tx);
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
  const betaClient = await prisma.client.findFirst({
    where: { id: CLIENT_BETA, firmId: FIRM_BETA },
    select: { id: true },
  });
  if (!betaClient) throw new Error("seed-fase2 no cargado: falta el cliente Beta Uno");
  const runtimeConnection = process.env.RUNTIME_DATABASE_URL;
  if (!runtimeConnection) {
    throw new Error("RUNTIME_DATABASE_URL debe apuntar a una base de pruebas desechable");
  }
  runtimePrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeConnection }) });

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
  await runtimePrisma?.$disconnect();
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

describe("Contactos de cliente — integración API/PostgreSQL/RLS", () => {
  it("crea, edita, mantiene un único principal, oculta/muestra y aísla por estudio", async () => {
    const firstCreated = await createContact(ownerToken, clientId, {
      name: "Ana Contacto",
      function: "Administración",
      email: "ana@example.com",
      phone: "+54 11 1234-5678",
      isPrimary: true,
    });
    expect(firstCreated.statusCode, JSON.stringify(firstCreated.json())).toBe(201);
    const firstContact = firstCreated.json().data as { id: string; isPrimary: boolean };
    expect(firstContact.isPrimary).toBe(true);

    const secondCreated = await createContact(ownerToken, clientId, {
      name: "Bruno Contacto",
      isPrimary: true,
    });
    expect(secondCreated.statusCode).toBe(201);
    const secondContact = secondCreated.json().data as { id: string; isPrimary: boolean };
    expect(secondContact.isPrimary).toBe(true);

    let listed = await listContacts(ownerToken, clientId);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(2);
    expect(listed.json().data.filter((contact: { isPrimary: boolean }) => contact.isPrimary)).toHaveLength(1);
    expect(listed.json().data.find((contact: { id: string }) => contact.id === firstContact.id).isPrimary).toBe(false);

    const edited = await patchContact(ownerToken, clientId, secondContact.id, {
      name: "Bruno Actualizado",
      function: "Gerencia",
      email: "bruno@example.com",
      phone: "+54 11 9876-5432",
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data).toMatchObject({
      name: "Bruno Actualizado",
      function: "Gerencia",
      isPrimary: true,
    });

    const contactAudit = await prisma.auditEvent.findFirst({
      where: {
        firmId: FIRM_ALFA,
        clientId,
        userId: OWNER_A,
        entityType: "ClientContact",
        entityId: secondContact.id,
        action: "client.contact.updated",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(contactAudit?.after).toMatchObject({
      name: "Bruno Actualizado",
      email: "[REDACTED]",
      phone: "[REDACTED]",
    });

    const hidden = await patchContact(ownerToken, clientId, secondContact.id, { isActive: false });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().data.isActive).toBe(false);
    const shown = await patchContact(ownerToken, clientId, secondContact.id, { isActive: true });
    expect(shown.statusCode).toBe(200);
    expect(shown.json().data.isActive).toBe(true);

    listed = await listContacts(ownerToken, clientId);
    expect(listed.json().data.filter((contact: { isPrimary: boolean }) => contact.isPrimary)).toHaveLength(1);
    const visibleToAlpha = await runAsRuntime(OWNER_A, FIRM_ALFA, clientId, (tx) =>
      tx.clientContact.findMany({ where: { firmId: FIRM_ALFA, clientId } }),
    );
    expect(visibleToAlpha.map((contact) => contact.id)).toEqual(
      expect.arrayContaining([firstContact.id, secondContact.id]),
    );
    const hiddenFromBeta = await runAsRuntime(OWNER_B, FIRM_BETA, CLIENT_BETA, (tx) =>
      tx.clientContact.findMany({ where: { firmId: FIRM_ALFA, clientId } }),
    );
    expect(hiddenFromBeta).toHaveLength(0);

    const deletePrivilege = await prisma.$queryRaw<{ allowed: boolean }[]>`
      SELECT has_table_privilege('contable_runtime', 'client_contacts', 'DELETE') AS allowed
    `;
    expect(deletePrivilege[0]?.allowed).toBe(false);
  });

  it("devuelve 403 al listar contactos a un miembro sin client.manage", async () => {
    const response = await listContacts(preparerToken, ASSIGNED_CLIENT);
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CAPABILITY_REQUIRED");
  });
});
