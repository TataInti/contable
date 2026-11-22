import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { assertFirmAccess, requireAuth } from "../auth/guard.js";
import { withTenantContext } from "../auth/tenant.js";

const bodySchema = z.object({
  body: z.string().trim().min(1, "Escribí un comentario.").max(4000, "El comentario puede tener hasta 4000 caracteres."),
  isPersonal: z.boolean().default(false),
  mentionedUserId: z.string().optional().nullable(),
  periodLabel: z.string().trim().max(80).optional().nullable(),
}).refine((value) => !(value.isPersonal && value.mentionedUserId), {
  message: "Una nota personal no puede mencionar a otra persona.", path: ["mentionedUserId"],
});
const editSchema = z.object({ body: z.string().trim().min(1, "Escribí un comentario.").max(4000, "El comentario puede tener hasta 4000 caracteres.") });
const paramsSchema = z.object({ firmId: z.string().min(1), clientId: z.string().min(1) });
const editParamsSchema = z.object({ firmId: z.string().min(1), commentId: z.string().min(1) });

function assertInternal(ctx: Awaited<ReturnType<typeof requireAuth>>, firmId: string) {
  assertFirmAccess(ctx, firmId);
  if (ctx.isPortal || !ctx.firmId) throw Object.assign(new Error("El portal no tiene acceso a los comentarios del estudio"), { statusCode: 404, code: "RESOURCE_NOT_FOUND" });
}

export function commentsRoutes(app: FastifyInstance) {
  app.get("/api/v1/firms/:firmId/clients/:clientId/comments", async (req) => {
    const { firmId, clientId } = paramsSchema.parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const rows = await withTenantContext({ userId: ctx.userId, firmId, clientId, actorKind: "USER" }, (tx) => tx.$queryRaw<Record<string, unknown>[]>`
      SELECT c."id", c."clientId", c."authorUserId", u."name" AS "authorName", c."body", c."isPersonal", c."periodLabel", c."mentionedUserId", mu."name" AS "mentionedName", c."resolvedAt", c."resolvedByUserId", ru."name" AS "resolvedByName", c."archivedAt", c."createdAt", c."updatedAt",
        EXISTS (SELECT 1 FROM "study_comment_edits" e WHERE e."commentId" = c."id") AS "isEdited"
      FROM "study_comments" c JOIN "users" u ON u."id" = c."authorUserId" LEFT JOIN "users" mu ON mu."id" = c."mentionedUserId" LEFT JOIN "users" ru ON ru."id" = c."resolvedByUserId"
      WHERE c."firmId" = ${firmId} AND c."clientId" = ${clientId}
        AND (NOT c."isPersonal" OR c."authorUserId" = ${ctx.userId})
      ORDER BY c."createdAt" ASC
    `);
    return { data: rows };
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/comments/members", async (req) => {
    const { firmId } = paramsSchema.parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const query = z.object({ search: z.string().trim().max(100).default("") }).parse(req.query);
    const rows = await withTenantContext({ userId: ctx.userId, firmId, actorKind: "USER" }, (tx) => tx.$queryRaw<{ id: string; name: string }[]>`
      SELECT u.id, u.name FROM "firm_memberships" fm JOIN "users" u ON u.id = fm."userId"
      WHERE fm."firmId" = ${firmId} AND fm.status = 'ACTIVE'
        AND (${query.search} = '' OR u.name ILIKE ${`%${query.search}%`} OR u."emailNormalized" ILIKE ${`%${query.search}%`})
      ORDER BY u.name LIMIT 20
    `);
    return { data: rows };
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/comments", async (req, reply) => {
    const { firmId, clientId } = paramsSchema.parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const input = bodySchema.parse(req.body);
    if (input.mentionedUserId) {
      const member = await withTenantContext({ userId: ctx.userId, firmId, actorKind: "USER" }, (tx) => tx.firmMembership.findFirst({
        where: { firmId, userId: input.mentionedUserId!, status: "ACTIVE" }, select: { id: true },
      }));
      if (!member) return reply.status(422).send({ error: { code: "COMMENT_MEMBER_REQUIRED", message: "Elegí a una persona activa de este estudio.", details: { path: ["mentionedUserId"] } } });
    }
    const rows = await withTenantContext({ userId: ctx.userId, firmId, clientId, actorKind: "USER" }, (tx) => tx.$queryRaw<Record<string, unknown>[]>`
      INSERT INTO "study_comments" (id, "firmId", "clientId", "authorUserId", body, "isPersonal", "periodLabel", "mentionedUserId")
      VALUES (${randomUUID()}, ${firmId}, ${clientId}, ${ctx.userId}, ${input.body}, ${input.isPersonal}, ${input.periodLabel ?? null}, ${input.isPersonal ? null : input.mentionedUserId ?? null})
      RETURNING id, "clientId", "authorUserId", body, "isPersonal", "periodLabel", "mentionedUserId", "createdAt", "updatedAt"
    `);
    return reply.status(201).send({ data: rows[0] });
  });

  app.patch("/api/v1/firms/:firmId/comments/:commentId", async (req, reply) => {
    const { firmId, commentId } = editParamsSchema.parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const { body } = editSchema.parse(req.body);
    const result = await withTenantContext({ userId: ctx.userId, firmId, actorKind: "USER" }, async (tx) => {
      const existing = await tx.$queryRaw<{ id: string; body: string; clientId: string }[]>`
        SELECT id, body, "clientId" FROM "study_comments" WHERE id = ${commentId} AND "firmId" = ${firmId} AND "authorUserId" = ${ctx.userId} AND "archivedAt" IS NULL FOR UPDATE
      `;
      const comment = existing[0]; if (!comment) return false;
      await tx.$executeRaw`INSERT INTO "study_comment_edits" (id, "firmId", "commentId", "editorUserId", "previousBody") VALUES (${randomUUID()}, ${firmId}, ${commentId}, ${ctx.userId}, ${comment.body})`;
      await tx.$executeRaw`UPDATE "study_comments" SET body = ${body}, "updatedAt" = now() WHERE id = ${commentId} AND "firmId" = ${firmId}`;
      return true;
    });
    if (!result) return reply.status(404).send({ error: { code: "RESOURCE_NOT_FOUND", message: "No se encontró el comentario que podés editar." } });
    return { data: { id: commentId, body, isEdited: true } };
  });

  app.post("/api/v1/firms/:firmId/comments/:commentId/archive", async (req, reply) => {
    const { firmId, commentId } = editParamsSchema.parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const count = await withTenantContext({ userId: ctx.userId, firmId, actorKind: "USER" }, (tx) => tx.$executeRaw`
      UPDATE "study_comments" SET "archivedAt" = now(), "updatedAt" = now() WHERE id = ${commentId} AND "firmId" = ${firmId} AND "authorUserId" = ${ctx.userId} AND "archivedAt" IS NULL
    `);
    if (!count) return reply.status(404).send({ error: { code: "RESOURCE_NOT_FOUND", message: "No se encontró el comentario que podés archivar." } });
    return { data: { id: commentId, archived: true } };
  });

  app.get("/api/v1/firms/:firmId/comments/inbox", async (req) => {
    const { firmId } = z.object({ firmId: z.string().min(1) }).parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const rows = await withTenantContext({ userId: ctx.userId, firmId, actorKind: "USER" }, (tx) => tx.$queryRaw<Record<string, unknown>[]>`
      SELECT c.id, c."clientId", cl."legalName" AS "clientName", c."periodLabel", c.body, c."authorUserId", u.name AS "authorName", c."createdAt"
      FROM "study_comments" c JOIN "clients" cl ON cl.id = c."clientId" AND cl."firmId" = c."firmId" JOIN "users" u ON u.id = c."authorUserId"
      WHERE c."firmId" = ${firmId} AND c."mentionedUserId" = ${ctx.userId} AND c."resolvedAt" IS NULL AND c."archivedAt" IS NULL ORDER BY c."createdAt" DESC
    `);
    return { data: rows };
  });

  app.get("/api/v1/firms/:firmId/comments/notes", async (req) => {
    const { firmId } = z.object({ firmId: z.string().min(1) }).parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const rows = await withTenantContext({ userId: ctx.userId, firmId, actorKind: "USER" }, (tx) => tx.$queryRaw<Record<string, unknown>[]>`
      SELECT c.id, c."clientId", cl."legalName" AS "clientName", c."periodLabel", c.body, c."createdAt", c."archivedAt"
      FROM "study_comments" c JOIN "clients" cl ON cl.id = c."clientId" AND cl."firmId" = c."firmId"
      WHERE c."firmId" = ${firmId} AND c."authorUserId" = ${ctx.userId} AND c."isPersonal" = true ORDER BY c."createdAt" DESC
    `);
    return { data: rows };
  });

  app.post("/api/v1/firms/:firmId/comments/:commentId/resolve", async (req, reply) => {
    const { firmId, commentId } = editParamsSchema.parse(req.params);
    const ctx = await requireAuth(req); assertInternal(ctx, firmId);
    const count = await withTenantContext({ userId: ctx.userId, firmId, actorKind: "USER" }, (tx) => tx.$executeRaw`
      UPDATE "study_comments" SET "resolvedAt" = now(), "resolvedByUserId" = ${ctx.userId}, "updatedAt" = now()
      WHERE id = ${commentId} AND "firmId" = ${firmId} AND "mentionedUserId" = ${ctx.userId} AND "resolvedAt" IS NULL
    `);
    if (!count) return reply.status(404).send({ error: { code: "RESOURCE_NOT_FOUND", message: "No se encontró una mención pendiente para resolver." } });
    return { data: { id: commentId, resolved: true, resolvedByUserId: ctx.userId } };
  });
}
