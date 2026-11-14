import { describe, expect, it, beforeEach } from "vitest";
import Fastify from "fastify";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { portalRoutes } from "./routes.js";

/**
 * S1 (corte de seguridad): el token de invitación al portal no se guarda en claro.
 *
 * Contratos:
 * - POST portal-invitations responde 201 con invitationToken una única vez;
 * - portal_invitations guarda sólo el hash SHA-256 del token;
 * - la invitación no emite eventos de outbox con el token (ni en payload ni en
 *   lastError) y no emite PORTAL_INVITATION_CREATED;
 * - la aceptación con ese token funciona una vez y consume la invitación;
 * - ni la respuesta ni el cuerpo de la aceptación aparecen en la salida del logger.
 *
 * Usa firma, cliente y usuarios PROPIOS (prefijo 5100…) para suites paralelas.
 * Los valores de prueba son sintéticos. Las comparaciones devuelven booleanos
 * para que un fallo nunca imprima el token real.
 */

const OWNER_S1 = "51000000-0000-4000-8000-000000000001";
const FIRM_S1 = "51000000-0000-4000-8000-000000000002";
const CLIENT_S1 = "51000000-0000-4000-8000-000000000003";
const INVITEE_EMAIL = "invitado.s1@test.local";
const INVITEE_PASSWORD = "Clave-sintetica-S1-2026";
const SYNTHETIC_TOKEN = "TOKEN-SINTETICO-DE-PRUEBA";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** true si el token aparece en el payload o en lastError de algún evento de la firma. */
async function outboxContainsToken(token: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n
    FROM outbox_events
    WHERE "firmId" = ${FIRM_S1}
      AND (strpos(payload::text, ${token}) > 0 OR strpos(coalesce("lastError", ''), ${token}) > 0)`;
  return Number(rows[0]?.n ?? 0) > 0;
}

async function setupTenant() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_S1}', 'owner.s1@test.local', 'Owner S1', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_S1}', 'Estudio S1', 'Estudio S1', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_S1}', '${FIRM_S1}', 'Cliente S1', '20999999931', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_S1}', '${OWNER_S1}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

/** Limpia sólo lo que crean estas pruebas (idempotencia entre corridas). */
async function cleanupTenant() {
  await prisma.$executeRawUnsafe(`DELETE FROM portal_memberships WHERE "firmId" = '${FIRM_S1}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM portal_invitations WHERE "firmId" = '${FIRM_S1}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM outbox_events WHERE "firmId" = '${FIRM_S1}'`);
  await prisma.$executeRawUnsafe(`DELETE FROM users WHERE "emailNormalized" = '${INVITEE_EMAIL}'`);
}

/**
 * App mínima con las rutas reales del portal. Un hook simula el guard de estudio
 * (identidad y tenant ya resueltos). El logger escribe en memoria para inspeccionarlo.
 */
function buildApp(logs: string[]) {
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs.push(chunk.toString());
      callback();
    },
  });
  const app = Fastify({ logger: { level: "info", stream } });
  app.addHook("onRequest", async (req) => {
    req.userId = OWNER_S1;
    req.firmId = FIRM_S1;
    req.clientId = CLIENT_S1;
  });
  portalRoutes(app);
  return app;
}

const createUrl = `/api/v1/firms/${FIRM_S1}/clients/${CLIENT_S1}/portal-invitations`;

describe("S1 · el token de invitación al portal no se guarda en claro", () => {
  beforeEach(async () => {
    await setupTenant();
    await cleanupTenant();
  });

  it("guarda sólo el hash, no emite evento con token y la respuesta lo devuelve una vez", async () => {
    const logs: string[] = [];
    const app = buildApp(logs);
    try {
      const res = await app.inject({
        method: "POST",
        url: createUrl,
        payload: { email: INVITEE_EMAIL, role: "COLLABORATOR" },
      });
      expect(res.statusCode).toBe(201);
      const data = res.json().data as { id: string; invitationToken: string };
      const token = data.invitationToken;
      expect(token.length).toBeGreaterThanOrEqual(32);

      const stored = await prisma.portalInvitation.findUniqueOrThrow({ where: { id: data.id } });
      expect(stored.tokenHash).toBe(sha256(token));
      expect(JSON.stringify(stored).includes(token)).toBe(false);

      expect(await outboxContainsToken(token)).toBe(false);
      const emitted = await prisma.outboxEvent.count({
        where: { firmId: FIRM_S1, eventType: "PORTAL_INVITATION_CREATED" },
      });
      expect(emitted).toBe(0);

      expect(logs.join("").includes(token)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("la aceptación con ese token funciona una vez y no deja token ni contraseña en el logger", async () => {
    const logs: string[] = [];
    const app = buildApp(logs);
    try {
      const created = await app.inject({
        method: "POST",
        url: createUrl,
        payload: { email: INVITEE_EMAIL, role: "COLLABORATOR" },
      });
      expect(created.statusCode).toBe(201);
      const { id, invitationToken: token } = created.json().data as { id: string; invitationToken: string };

      const acceptPayload = { token, email: INVITEE_EMAIL, name: "Invitado S1", password: INVITEE_PASSWORD };
      const accept = await app.inject({ method: "POST", url: "/api/v1/portal/invitations/accept", payload: acceptPayload });
      expect(accept.statusCode).toBe(200);
      expect(accept.json().data.status).toBe("ACCEPTED");

      const consumed = await prisma.portalInvitation.findUniqueOrThrow({ where: { id } });
      expect(consumed.acceptedAt).not.toBeNull();
      const membership = await prisma.portalMembership.findFirst({ where: { firmId: FIRM_S1, clientId: CLIENT_S1 } });
      expect(membership?.status).toBe("ACTIVE");

      const replay = await app.inject({ method: "POST", url: "/api/v1/portal/invitations/accept", payload: acceptPayload });
      expect(replay.statusCode).toBe(400);
      expect(replay.json().error.code).toBe("INVITATION_INVALID");

      const output = logs.join("");
      expect(output.includes(token)).toBe(false);
      expect(output.includes(INVITEE_PASSWORD)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("control: el chequeo de fugas sí detecta un token sintético en el outbox", async () => {
    const row = await prisma.outboxEvent.create({
      data: {
        firmId: FIRM_S1,
        clientId: CLIENT_S1,
        topic: "notifications",
        eventType: "CONTROL_S1",
        aggregateId: "control-s1",
        payload: { token: SYNTHETIC_TOKEN },
      },
    });
    try {
      expect(await outboxContainsToken(SYNTHETIC_TOKEN)).toBe(true);
    } finally {
      await prisma.outboxEvent.delete({ where: { id: row.id } });
    }
    expect(await outboxContainsToken(SYNTHETIC_TOKEN)).toBe(false);
  });
});
