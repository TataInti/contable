import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { tenantContextFromRequest, withTenantContext } from "../auth/tenant.js";
import { assertCapability } from "../auth/guard.js";
import { DocumentService } from "../documents/document-service.js";
import { ObjectStorage, BUCKETS } from "../storage/object-storage.js";
import { MAX_FILE_SIZE } from "../storage/file-validator.js";
import { outboxPublisher } from "../jobs/outbox-publisher.js";
import { hashPassword } from "../auth/password.js";
import { exportReport, REPORT_CONTENT_TYPES, type ExportReportResult } from "../reporting/report-export.js";

const portalInvitationSchema = z.object({
  email: z.string().email().transform((value) => value.toLowerCase()),
  role: z.enum(["OWNER", "COLLABORATOR", "READONLY"]).default("OWNER"),
}).strict();

const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(300),
  email: z.string().email().transform((value) => value.toLowerCase()),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(12).max(200),
}).strict();

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const completeUploadSchema = z.object({
  originalName: z.string().min(1).max(200),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(MAX_FILE_SIZE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  objectKey: z.string().min(1).max(500),
}).strict();

export function portalRoutes(app: FastifyInstance) {
  const storage = new ObjectStorage();
  const documents = new DocumentService(storage);

  app.post("/api/v1/portal/invitations/accept", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const body = acceptInvitationSchema.parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const rows = await prisma.$queryRaw<{ userId: string; firmId: string; clientId: string }[]>`
      SELECT * FROM app_accept_portal_invitation(
        ${tokenHash(body.token)}, ${body.email}, ${body.name}, ${passwordHash}
      )
    `;
    const accepted = rows[0];
    if (!accepted) {
      return reply.status(400).send({
        error: { code: "INVITATION_INVALID", message: "La invitación es inválida, expiró o no coincide con el correo" },
      });
    }
    return reply.send({ data: { status: "ACCEPTED", firmId: accepted.firmId, clientId: accepted.clientId } });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/portal-invitations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.portalInvitation.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! },
      select: { id: true, emailNormalized: true, role: true, expiresAt: true, acceptedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }));
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/portal-memberships", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.portalMembership.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! },
      select: { id: true, userId: true, role: true, status: true, acceptedAt: true, revokedAt: true, user: { select: { name: true, emailNormalized: true } } },
      orderBy: { createdAt: "desc" }, take: 100,
    }));
    return reply.send({ data });
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/portal-invitations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = portalInvitationSchema.parse(req.body);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
    const invitation = await withTenantContext(ctx, async (tx) => {
      const created = await tx.portalInvitation.create({ data: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        emailNormalized: body.email,
        role: body.role,
        tokenHash: tokenHash(token),
        expiresAt,
        invitedByUserId: ctx.userId,
      } });
      // G0-06: creación de eventos vía SECURITY DEFINER (el runtime no
      // tiene INSERT directo en outbox_events).
      await tx.$executeRaw`SELECT app_create_outbox(
        ${ctx.firmId}::text,
        ${ctx.clientId!}::text,
        'notifications'::text,
        'PORTAL_INVITATION_CREATED'::text,
        ${created.id}::text,
        ${JSON.stringify({ invitationId: created.id, email: body.email, token, expiresAt: expiresAt.toISOString() })}::jsonb
      )`;
      await tx.auditEvent.create({ data: {
        firmId: ctx.firmId, clientId: ctx.clientId!, userId: ctx.userId, actorKind: "USER",
        action: "portal.invitation.created", entityType: "PortalInvitation", entityId: created.id,
        after: { role: body.role, expiresAt: expiresAt.toISOString() },
      } });
      return created;
    });
    void outboxPublisher.dispatchPending().catch((error) => req.log.error({ error }, "No se pudo despachar la invitación"));
    return reply.status(201).send({
      data: {
        id: invitation.id,
        email: invitation.emailNormalized,
        role: invitation.role,
        expiresAt,
        // Se devuelve una única vez para desarrollo/onboarding manual; no se persiste en claro.
        invitationToken: token,
      },
    });
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/portal-invitations/:invitationId/revoke", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { invitationId } = req.params as { invitationId: string };
    const invitation = await withTenantContext(ctx, async (tx) => {
      const current = await tx.portalInvitation.findFirst({ where: { id: invitationId, firmId: ctx.firmId, clientId: ctx.clientId! } });
      if (!current) throw Object.assign(new Error("Invitación no encontrada"), { statusCode: 404, code: "INVITATION_NOT_FOUND" });
      const updated = await tx.portalInvitation.update({ where: { id: invitationId }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: {
        firmId: ctx.firmId, clientId: ctx.clientId!, userId: ctx.userId, actorKind: "USER",
        action: "portal.invitation.revoked", entityType: "PortalInvitation", entityId: invitationId,
        before: { revokedAt: current.revokedAt }, after: { revokedAt: updated.revokedAt },
      } });
      return updated;
    });
    return reply.send({ data: { id: invitation.id, status: "REVOKED" } });
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/portal-memberships/:membershipId/revoke", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { membershipId } = req.params as { membershipId: string };
    const membership = await withTenantContext(ctx, async (tx) => {
      const current = await tx.portalMembership.findFirst({ where: { id: membershipId, firmId: ctx.firmId, clientId: ctx.clientId! } });
      if (!current) throw Object.assign(new Error("Acceso no encontrado"), { statusCode: 404, code: "MEMBERSHIP_NOT_FOUND" });
      return tx.portalMembership.update({ where: { id: membershipId }, data: { status: "SUSPENDED", revokedAt: new Date() } });
    });
    return reply.send({ data: { id: membership.id, status: membership.status } });
  });

  app.get("/api/v1/portal/contexts", async (req, reply) => {
    if (!req.userId) return reply.status(401).send({ error: { code: "UNAUTHENTICATED", message: "Sin sesión" } });
    const rows = await prisma.$queryRaw<{
      firmId: string; firmName: string; clientId: string; clientName: string; role: string;
    }[]>`SELECT * FROM app_portal_contexts(${req.userId})`;
    const data = [];
    for (const row of rows) {
      const periods = await withTenantContext(
        { userId: req.userId, firmId: row.firmId, clientId: row.clientId, actorKind: "PORTAL" },
        (tx) => tx.accountingPeriod.findMany({
          where: { firmId: row.firmId, clientId: row.clientId },
          select: { id: true, startDate: true, endDate: true, status: true },
          orderBy: { startDate: "desc" },
          take: 24,
        }),
      );
      data.push({ ...row, periods: periods.map((period) => ({
        periodId: period.id,
        label: new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" }).format(period.startDate),
        status: period.status,
      })) });
    }
    return reply.send({ data });
  });

  app.get("/api/v1/portal/clients/:clientId/summary", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, async (tx) => {
      const [pendingRequests, upcomingObligations, publications, documentsCount] = await Promise.all([
        // §5.2: el resumen tampoco cuenta DRAFT/CANCELLED como pendientes.
        tx.documentRequest.count({ where: { firmId: ctx.firmId, clientId: ctx.clientId!, status: { notIn: ["COMPLETED", "DRAFT", "CANCELLED"] } } }),
        tx.obligationInstance.count({ where: { firmId: ctx.firmId, clientId: ctx.clientId!, status: { notIn: ["PAID", "FILED"] } } }),
        tx.reportPublication.count({ where: { firmId: ctx.firmId, clientId: ctx.clientId!, status: "PUBLISHED" } }),
        tx.document.count({ where: { firmId: ctx.firmId, clientId: ctx.clientId! } }),
      ]);
      return { pendingRequests, upcomingObligations, publications, documentsCount };
    });
    return reply.send({ data });
  });

  app.get("/api/v1/portal/clients/:clientId/obligations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.obligationInstance.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! },
      include: { obligation: true }, orderBy: { dueDate: "asc" }, take: 200,
    }));
    return reply.send({ data });
  });

  app.get("/api/v1/portal/clients/:clientId/document-requests", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.documentRequest.findMany({
      // §5.2: el portal excluye pedidos DRAFT y CANCELLED.
      where: { firmId: ctx.firmId, clientId: ctx.clientId!, status: { notIn: ["DRAFT", "CANCELLED"] } },
      include: { items: true, threads: { include: { messages: { where: { visibility: "SHARED" }, orderBy: { createdAt: "asc" } } } } },
      orderBy: { createdAt: "desc" }, take: 200,
    }));
    return reply.send({ data });
  });

  app.get("/api/v1/portal/clients/:clientId/report-publications", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.reportPublication.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId!, status: "PUBLISHED" },
      include: { run: { include: { template: true } } }, orderBy: { publishedAt: "desc" }, take: 100,
    }));
    return reply.send({ data });
  });

  // G3-11: liquidaciones publicadas (sólo FINALIZED) para el portal.
  app.get("/api/v1/portal/clients/:clientId/tax-settlements", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.taxSettlement.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId!, status: "FINALIZED" },
      include: {
        period: true,
        regime: { include: { taxType: true, jurisdiction: true } },
        filings: { orderBy: { createdAt: "desc" }, take: 1 },
        payments: { orderBy: { createdAt: "desc" }, take: 10 },
        // Sólo exponemos metadatos descargables: la clave del objeto y el
        // checksum siguen del lado del servidor y la descarga reautoriza.
        artifacts: {
          where: { objectKey: { not: null } },
          select: { id: true, kind: true, format: true, generatedAt: true },
          orderBy: { generatedAt: "desc" },
          take: 20,
        },
      },
      orderBy: { version: "desc" },
      take: 100,
    }));
    return reply.send({ data });
  });

  // G3-11: descarga del papel de trabajo publicado (artifact).
  app.get("/api/v1/portal/clients/:clientId/tax-settlements/:settlementId/artifacts/:artifactId/download", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const { settlementId, artifactId } = req.params as { settlementId: string; artifactId: string };
    const artifact = await withTenantContext(ctx, (tx) => tx.taxExportArtifact.findFirst({
      where: {
        id: artifactId,
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        settlementId,
        settlement: { status: "FINALIZED" },
      },
    }));
    if (!artifact || !artifact.objectKey) {
      return reply.status(404).send({ error: { code: "ARTIFACT_NOT_FOUND", message: "Papel de trabajo no encontrado" } });
    }
    const buffer = await storage.get(BUCKETS.exports, artifact.objectKey);
    const contentType = artifact.format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8";
    const filename = `papel-de-trabajo-${settlementId.slice(0, 8)}.${artifact.format}`;
    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .header("Cache-Control", "private, no-store")
      .send(buffer);
  });

  // G5-07: rentabilidad publicada (sólo snapshots PUBLISHED; el portal nunca
  // ve borradores ni versiones SUPERSEDED).
  app.get("/api/v1/portal/clients/:clientId/profitability", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const q = z.object({ periodId: z.string().uuid().optional() }).parse(req.query);
    const data = await withTenantContext(ctx, (tx) => tx.profitabilitySnapshot.findMany({
      where: {
        firmId: ctx.firmId,
        clientId: ctx.clientId!,
        status: "PUBLISHED",
        ...(q.periodId ? { periodId: q.periodId } : {}),
      },
      include: { period: { select: { label: true, startDate: true, endDate: true } } },
      orderBy: [{ periodId: "desc" }, { basis: "asc" }, { version: "desc" }],
      take: 100,
    }));
    return reply.send({ data });
  });

  // G5-10: recibo persistente de una publicación (snapshot PUBLISHED con
  // hashes y fecha de publicación; el portal puede descargarlo/consultarlo).
  app.get("/api/v1/portal/clients/:clientId/profitability/:snapshotId/receipt", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const { snapshotId } = req.params as { snapshotId: string };
    const snapshot = await withTenantContext(ctx, (tx) => tx.profitabilitySnapshot.findFirst({
      where: { id: snapshotId, firmId: ctx.firmId, clientId: ctx.clientId!, status: "PUBLISHED" },
      include: { period: { select: { label: true, startDate: true, endDate: true } } },
    }));
    if (!snapshot) {
      return reply.status(404).send({ error: { code: "SNAPSHOT_NOT_FOUND", message: "Publicación no encontrada" } });
    }
    return reply.send({
      data: {
        id: snapshot.id,
        basis: snapshot.basis,
        version: snapshot.version,
        status: snapshot.status,
        publishedAt: snapshot.publishedAt,
        outputHash: snapshot.outputHash,
        inputHash: snapshot.inputHash,
        period: snapshot.period,
        totals: snapshot.totals,
      },
    });
  });

  // G5-08: timeline de comunicación por obligación (sólo mensajes SHARED).
  app.get("/api/v1/portal/clients/:clientId/obligations/:obligationId/timeline", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const { obligationId } = req.params as { obligationId: string };
    const data = await withTenantContext(ctx, async (tx) => {
      const obligation = await tx.taxObligation.findFirst({
        where: { id: obligationId, firmId: ctx.firmId, clientId: ctx.clientId! },
        include: { period: { select: { label: true, startDate: true, endDate: true } }, filings: { orderBy: { createdAt: "asc" } }, payments: { orderBy: { createdAt: "asc" } } },
      });
      if (!obligation) {
        throw Object.assign(new Error("Obligación no encontrada"), { statusCode: 404, code: "OBLIGATION_NOT_FOUND" });
      }
      // Mensajes compartidos del thread vinculado al pedido/obligación.
      const messages = await tx.requestMessage.findMany({
        where: {
          firmId: ctx.firmId,
          clientId: ctx.clientId!,
          visibility: "SHARED",
          thread: { request: { clientId: ctx.clientId! } },
        },
        include: { thread: { select: { requestId: true } } },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return { obligation, filings: obligation.filings, payments: obligation.payments, messages };
    });
    return reply.send({ data });
  });

  app.get("/api/v1/portal/clients/:clientId/report-publications/:publicationId/export", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const { publicationId } = req.params as { publicationId: string };
    const { format } = z.object({ format: z.enum(["csv", "xlsx", "pdf"]).default("pdf") }).parse(req.query);
    const publication = await withTenantContext(ctx, (tx) => tx.reportPublication.findFirst({
      where: { id: publicationId, firmId: ctx.firmId, clientId: ctx.clientId!, status: "PUBLISHED" },
      include: { run: { include: { template: true } } },
    }));
    if (!publication) {
      return reply.status(404).send({ error: { code: "PUBLICATION_NOT_FOUND", message: "Reporte no encontrado" } });
    }
    const buffer = await exportReport((publication.run.result ?? {}) as ExportReportResult, format);
    const filename = `reporte-${publication.run.template.code}-${publication.run.cutoff.toISOString().slice(0, 10)}.${format}`;
    return reply
      .header("Content-Type", REPORT_CONTENT_TYPES[format])
      .header("Content-Disposition", `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "-")}"`)
      .header("Cache-Control", "private, no-store")
      .send(buffer);
  });

  app.get("/api/v1/portal/clients/:clientId/documents", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    return reply.send({ data: await documents.listDocuments(ctx.firmId, ctx.clientId!, ctx) });
  });

  // G2-07.5: preview/descarga de un documento que el cliente subió. Reautoriza
  // por RLS y sólo firma versiones ya validadas (fuera de cuarentena). READONLY
  // también puede ver sus propias cargas (portal.results.read).
  app.get("/api/v1/portal/clients/:clientId/documents/:documentId/preview", async (req, reply) => {
    assertCapability(req, "portal.results.read");
    const ctx = tenantContextFromRequest(req);
    const { documentId } = req.params as { documentId: string };
    const preview = await documents.getPreviewUrl(ctx, documentId);
    if (!preview) {
      return reply.status(404).send({ error: { code: "DOCUMENT_NOT_FOUND", message: "Documento no encontrado" } });
    }
    return reply.send({ data: preview });
  });

  app.post("/api/v1/portal/clients/:clientId/document-upload-sessions", async (req, reply) => {
    assertCapability(req, "portal.documents.upload");
    const ctx = tenantContextFromRequest(req);
    const body = z.object({
      expectedMime: z.string().optional(),
      // Un upload libre sigue siendo válido; cuando nace desde un pedido, se
      // persiste el vínculo para completar el ítem automáticamente.
      requestItemId: z.string().uuid().optional(),
      // §10: el cliente puede declarar la categoría del documento (p.ej. el
      // acuse de una presentación fiscal). Allowlist para evitar categorías
      // reservadas del estudio.
      category: z.enum(["ACUSE", "OTRO"]).optional(),
    }).strict().parse(req.body ?? {});
    if (body.requestItemId) {
      const item = await documents.getRequestItem(ctx, body.requestItemId);
      if (!item) {
        return reply.status(404).send({
          error: { code: "REQUEST_ITEM_NOT_FOUND", message: "Ítem de pedido no encontrado" },
        });
      }
      if (item.status !== "PENDING") {
        return reply.status(409).send({
          error: { code: "REQUEST_ITEM_NOT_PENDING", message: "Este ítem ya tiene una respuesta en curso" },
        });
      }
    }
    const session = await documents.createUploadSession(
      ctx.firmId,
      ctx.clientId!,
      ctx.userId,
      {
        ...(body.expectedMime ? { expectedMime: body.expectedMime } : {}),
        ...(body.requestItemId ? { requestItemId: body.requestItemId } : {}),
        ...(body.category ? { category: body.category } : {}),
      },
      ctx,
    );
    const objectKey = `${session.id}/${randomUUID()}.bin`;
    return reply.status(201).send({ data: {
      sessionId: session.id,
      presignedUrl: await storage.getPresignedPutUrl(BUCKETS.quarantine, objectKey, MAX_FILE_SIZE),
      objectKey,
      maxSizeBytes: MAX_FILE_SIZE,
      expiresAt: session.expiresAt,
    } });
  });

  app.post("/api/v1/portal/clients/:clientId/document-upload-sessions/:sessionId/complete", async (req, reply) => {
    assertCapability(req, "portal.documents.upload");
    const ctx = tenantContextFromRequest(req);
    const { sessionId } = req.params as { sessionId: string };
    const body = completeUploadSchema.parse(req.body);
    try {
      const { document } = await documents.completeUpload(sessionId, { ...body, bucket: BUCKETS.quarantine }, ctx);
      void outboxPublisher.dispatchPending().catch((error) => req.log.error({ error }, "No se pudo despachar el outbox"));
      return reply.status(201).send({ data: { documentId: document.id, status: document.status } });
    } catch (error) {
      if (error instanceof Error && error.message === "REQUEST_ITEM_NOT_PENDING") {
        return reply.status(409).send({
          error: { code: "REQUEST_ITEM_NOT_PENDING", message: "El ítem ya fue respondido" },
        });
      }
      throw error;
    }
  });

  app.post("/api/v1/portal/clients/:clientId/threads/:threadId/messages", async (req, reply) => {
    assertCapability(req, "message.shared");
    const ctx = tenantContextFromRequest(req);
    const { threadId } = req.params as { threadId: string };
    const body = z.object({ body: z.string().trim().min(1).max(5000) }).strict().parse(req.body);
    const message = await withTenantContext(ctx, async (tx) => {
      const thread = await tx.requestThread.findFirst({ where: { id: threadId, firmId: ctx.firmId, clientId: ctx.clientId! } });
      if (!thread) throw Object.assign(new Error("Conversación no encontrada"), { statusCode: 404, code: "THREAD_NOT_FOUND" });
      return tx.requestMessage.create({ data: {
        firmId: ctx.firmId, clientId: ctx.clientId!, threadId, authorUserId: ctx.userId,
        body: body.body, visibility: "SHARED",
      } });
    });
    return reply.status(201).send({ data: message });
  });

  app.get("/api/v1/portal/clients/:clientId/profile", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const user = await withTenantContext(ctx, (tx) => tx.user.findUnique({
      where: { id: ctx.userId }, select: { id: true, name: true, emailNormalized: true },
    }));
    return reply.send({ data: user });
  });

  app.patch("/api/v1/portal/clients/:clientId/profile", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z.object({ name: z.string().trim().min(2).max(120) }).strict().parse(req.body);
    const user = await withTenantContext(ctx, (tx) => tx.user.update({
      where: { id: ctx.userId }, data: { name: body.name }, select: { id: true, name: true, emailNormalized: true },
    }));
    return reply.send({ data: user });
  });
}
