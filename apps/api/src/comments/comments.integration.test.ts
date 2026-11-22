import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PREPARER = "33333333-3333-4333-8333-333333333333";
const OWNER_BETA = "22222222-2222-4222-8222-222222222222";
const FOREIGN_USER = randomUUID();
const FIRM_BETA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FIRM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT = "11111111-2222-4333-8444-555555555555";
const CSRF = "csrf-comments-test-0123456789abcdef";
let app: FastifyInstance | null = null;
let ownerToken = "";
let preparerToken = "";
const madeIds: string[] = [];

async function request(method: "GET" | "POST" | "PATCH", token: string, url: string, payload?: Record<string, unknown>) {
  return app!.inject({ method, url, cookies: { refresh_token: token, csrf_token: CSRF }, headers: { "x-csrf-token": CSRF }, ...(payload ? { payload } : {}) });
}

beforeAll(async () => {
  app = await buildServer({ postgres: async () => true, valkey: async () => true, minio: async () => true, ai: async () => true });
  await app.ready();
  await prisma.user.create({ data: { id: FOREIGN_USER, emailNormalized: `foreign-${FOREIGN_USER}@example.com`, name: "Owner Beta sintético", passwordHash: "hash", status: "ACTIVE" } });
  await prisma.firmMembership.create({ data: { id: randomUUID(), firmId: FIRM_BETA, userId: FOREIGN_USER, role: "OWNER", status: "ACTIVE", acceptedAt: new Date() } });
  ownerToken = randomBytes(32).toString("base64url");
  preparerToken = randomBytes(32).toString("base64url");
  await prisma.deviceSession.createMany({ data: [[OWNER, ownerToken], [PREPARER, preparerToken]].map(([userId, token]) => ({
    id: randomUUID(), userId: userId!, refreshTokenHash: sha256(token!), familyId: randomUUID(), rotationCounter: 0, expiresAt: new Date(Date.now() + 3600000),
  })) });
});

afterAll(async () => {
  if (madeIds.length) await prisma.studyComment.deleteMany({ where: { id: { in: madeIds } } });
  await prisma.firmMembership.deleteMany({ where: { firmId: FIRM_BETA, userId: FOREIGN_USER } });
  await prisma.user.delete({ where: { id: FOREIGN_USER } });
  await prisma.deviceSession.deleteMany({ where: { refreshTokenHash: { in: [ownerToken, preparerToken].filter(Boolean).map(sha256) } } });
  await app?.close(); app = null;
});

describe("comentarios internos por API", () => {
  it("menciona a un miembro del estudio, registra resolución e historial y oculta notas personales", async () => {
    const path = `/api/v1/firms/${FIRM}/clients/${CLIENT}/comments`;
    const members = await request("GET", ownerToken, `${path}/members?search=Preparer`);
    expect(members.statusCode).toBe(200);
    expect(members.json().data).toContainEqual({ id: PREPARER, name: "Preparer A" });
    const otherStudy = await request("POST", ownerToken, path, { body: "Mención ajena", mentionedUserId: FOREIGN_USER });
    expect(otherStudy.statusCode).toBe(422);
    expect(otherStudy.json().error.details.path).toEqual(["mentionedUserId"]);

    const posted = await request("POST", ownerToken, path, { body: "Revisar saldo del mes", mentionedUserId: PREPARER, periodLabel: "Octubre 2026" });
    expect(posted.statusCode).toBe(201);
    const mentionId = posted.json().data.id as string; madeIds.push(mentionId);
    const inbox = await request("GET", preparerToken, `/api/v1/firms/${FIRM}/comments/inbox`);
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().data).toEqual(expect.arrayContaining([expect.objectContaining({ id: mentionId, clientName: "Cliente Alfa Uno", periodLabel: "Octubre 2026" })]));

    const edited = await request("PATCH", ownerToken, `/api/v1/firms/${FIRM}/comments/${mentionId}`, { body: "Revisar el saldo del mes" });
    expect(edited.statusCode).toBe(200);
    expect(await prisma.studyCommentEdit.count({ where: { commentId: mentionId } })).toBe(1);
    const resolved = await request("POST", preparerToken, `/api/v1/firms/${FIRM}/comments/${mentionId}/resolve`, {});
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.resolvedByUserId).toBe(PREPARER);

    const note = await request("POST", preparerToken, path, { body: "Nota de trabajo privada", isPersonal: true });
    expect(note.statusCode).toBe(201);
    const noteId = note.json().data.id as string; madeIds.push(noteId);
    const ownerRead = await request("GET", ownerToken, path);
    expect(ownerRead.json().data).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: noteId })]));
    const privateRead = await request("GET", preparerToken, path);
    expect(privateRead.json().data).toEqual(expect.arrayContaining([expect.objectContaining({ id: noteId, isPersonal: true })]));

    const runtimeVisible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE contable_runtime`;
      await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER}, true), set_config('app.firm_id', ${FIRM}, true), set_config('app.actor_kind', 'USER', true), set_config('app.client_id', '', true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "study_comments" WHERE id IN (${mentionId}, ${noteId}) ORDER BY id`;
    });
    expect(runtimeVisible.map((row) => row.id)).toEqual([mentionId]);
    const runtimeDelete = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE contable_runtime`;
      return tx.$queryRaw<{ allowed: boolean }[]>`SELECT has_table_privilege(current_user, 'study_comments', 'DELETE') AS allowed`;
    });
    expect(runtimeDelete[0]?.allowed).toBe(false);
    const portalVisible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE contable_runtime`;
      await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER}, true), set_config('app.firm_id', ${FIRM}, true), set_config('app.actor_kind', 'PORTAL', true), set_config('app.client_id', ${CLIENT}, true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "study_comments" WHERE id = ${mentionId}`;
    });
    expect(portalVisible).toEqual([]);
    const foreignVisible = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE contable_runtime`;
      await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER_BETA}, true), set_config('app.firm_id', ${FIRM_BETA}, true), set_config('app.actor_kind', 'USER', true), set_config('app.client_id', '', true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM "study_comments" WHERE id = ${mentionId}`;
    });
    expect(foreignVisible).toEqual([]);

    const archived = await request("POST", ownerToken, `/api/v1/firms/${FIRM}/comments/${mentionId}/archive`, {});
    expect(archived.statusCode).toBe(200);
    const thread = await request("GET", ownerToken, path);
    expect(thread.json().data).toEqual(expect.arrayContaining([expect.objectContaining({ id: mentionId, archivedAt: expect.any(String) })]));
  });

  it("rechaza comentarios de más de 4000 caracteres con error de validación", async () => {
    const response = await request("POST", ownerToken, `/api/v1/firms/${FIRM}/clients/${CLIENT}/comments`, { body: "x".repeat(4001) });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });
});
