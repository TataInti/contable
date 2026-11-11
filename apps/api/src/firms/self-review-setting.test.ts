import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

const OWNER = randomUUID();
const ADMIN = randomUUID();
const FIRM = randomUUID();
const CSRF = "csrf-self-review-test-token-0123456789";

let app: FastifyInstance | null = null;
let ownerToken = "";
let adminToken = "";

async function request(
  method: "GET" | "PATCH",
  token: string,
  payload?: { allowSelfReview: boolean },
) {
  return app!.inject({
    method,
    url: `/api/v1/firms/${FIRM}/settings/self-review`,
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

  await prisma.firm.upsert({
    where: { id: FIRM },
    update: { allowSelfReview: false },
    create: { id: FIRM, legalName: "Estudio autorrevisión", displayName: "Estudio autorrevisión" },
  });
  for (const [userId, email, name, role, setToken] of [
    [OWNER, `owner.self-review.${OWNER}@test.invalid`, "Titular autorrevisión", "OWNER", (token: string) => (ownerToken = token)],
    [ADMIN, `admin.self-review.${ADMIN}@test.invalid`, "Admin autorrevisión", "ADMIN", (token: string) => (adminToken = token)],
  ] as const) {
    await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, emailNormalized: email, name, passwordHash: "-" },
    });
    await prisma.firmMembership.upsert({
      where: { firmId_userId: { firmId: FIRM, userId } },
      update: { role, status: "ACTIVE" },
      create: { firmId: FIRM, userId, role, status: "ACTIVE", acceptedAt: new Date() },
    });
    const token = randomBytes(32).toString("base64url");
    await prisma.deviceSession.create({
      data: {
        id: randomUUID(),
        userId,
        refreshTokenHash: sha256(token),
        familyId: randomUUID(),
        rotationCounter: 0,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    setToken(token);
  }
});

afterAll(async () => {
  await prisma.deviceSession.deleteMany({ where: { userId: { in: [OWNER, ADMIN] } } });
  await prisma.firmMembership.deleteMany({ where: { firmId: FIRM } });
  await prisma.firm.deleteMany({ where: { id: FIRM } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, ADMIN] } } });
  await app?.close();
  app = null;
});

describe("configuración de autorrevisión por estudio", () => {
  it("deja la opción apagada, permite al OWNER cambiarla y audita el cambio", async () => {
    const initial = await request("GET", ownerToken);
    expect(initial.statusCode).toBe(200);
    expect(initial.json().data.allowSelfReview).toBe(false);

    const updated = await request("PATCH", ownerToken, { allowSelfReview: true });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.allowSelfReview).toBe(true);

    const persisted = await prisma.firm.findUniqueOrThrow({ where: { id: FIRM } });
    expect(persisted.allowSelfReview).toBe(true);
    const audit = await prisma.auditEvent.findMany({
      where: {
        firmId: FIRM,
        userId: OWNER,
        action: "firm.self_review_setting.updated",
        entityType: "Firm",
        entityId: FIRM,
      },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({ allowSelfReview: true });
    expect(audit[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("reserva el cambio al OWNER y devuelve 403 al ADMIN", async () => {
    const response = await request("PATCH", adminToken, { allowSelfReview: false });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CAPABILITY_REQUIRED");
  });
});