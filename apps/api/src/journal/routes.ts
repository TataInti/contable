import type { FastifyInstance } from "fastify";
import { journalEntryDraftSchema, postJournalEntrySchema } from "@contable/contracts";
import { JournalService, JournalError } from "./journal-service.js";
import { LedgerService } from "./ledger-service.js";
import { tenantContextFromRequest } from "../auth/tenant.js";

/**
 * Rutas de asientos y libros (Fase 6 — Núcleo contable).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function journalRoutes(app: FastifyInstance) {
  const journal = new JournalService();
  const ledger = new LedgerService();

  const handleError = (reply: { status: (code: number) => { send: (body: object) => void } }, err: unknown) => {
    if (err instanceof JournalError) {
      const status =
        err.code === "ENTRY_NOT_FOUND" ? 404 : err.code === "ROW_VERSION_CONFLICT" ? 409 : 400;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  app.get("/api/v1/firms/:firmId/clients/:clientId/journal-entries", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { withTenantContext } = await import("../auth/tenant.js");
    const data = await withTenantContext(ctx, (tx) => tx.journalEntry.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! }, include: { lines: { include: { account: true }, orderBy: { position: "asc" } } },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }], take: 200,
    }));
    return reply.send({ data });
  });

  // Crear borrador (maker)
  app.post("/api/v1/firms/:firmId/clients/:clientId/journal-entries", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = journalEntryDraftSchema.parse({ ...(req.body as object), clientId });
    try {
      const entry = await journal.createDraft(tenantContextFromRequest(req), body);
      return reply.status(201).send({ data: entry });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Enviar a revisión
  app.post("/api/v1/firms/:firmId/clients/:clientId/journal-entries/:entryId/submit", async (req, reply) => {
    const { entryId } = req.params as { entryId: string };
    try {
      const entry = await journal.submit(tenantContextFromRequest(req), entryId);
      return reply.send({ data: entry });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Aprobar (checker)
  app.post("/api/v1/firms/:firmId/clients/:clientId/journal-entries/:entryId/review", async (req, reply) => {
    const { entryId } = req.params as { entryId: string };
    try {
      const entry = await journal.review(tenantContextFromRequest(req), entryId);
      return reply.send({ data: entry });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Rechazar
  app.post("/api/v1/firms/:firmId/clients/:clientId/journal-entries/:entryId/reject", async (req, reply) => {
    const { entryId } = req.params as { entryId: string };
    try {
      const entry = await journal.reject(tenantContextFromRequest(req), entryId);
      return reply.send({ data: entry });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Postear
  app.post("/api/v1/firms/:firmId/clients/:clientId/journal-entries/:entryId/post", async (req, reply) => {
    const { entryId } = req.params as { entryId: string };
    const body = postJournalEntrySchema.parse(req.body);
    try {
      const idempotencyKey = req.headers["idempotency-key"];
      if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
        return reply.status(400).send({ error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Idempotency-Key válido requerido" } });
      }
      const entry = await journal.post(tenantContextFromRequest(req), entryId, body.expectedRowVersion, idempotencyKey);
      return reply.send({ data: entry });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Revertir
  app.post("/api/v1/firms/:firmId/clients/:clientId/journal-entries/:entryId/reverse", async (req, reply) => {
    const { entryId } = req.params as { entryId: string };
    const body = (req.body ?? {}) as { description?: string };
    try {
      const reversal = await journal.reverse(tenantContextFromRequest(req), entryId, body.description);
      return reply.send({ data: reversal });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Diario
  app.get("/api/v1/firms/:firmId/clients/:clientId/ledger/journal", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const q = req.query as { periodId?: string };
    const data = await ledger.journal(firmId, clientId, q.periodId);
    return reply.send({ data });
  });

  // Mayor
  app.get("/api/v1/firms/:firmId/clients/:clientId/ledger/ledger", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const q = req.query as { accountId?: string };
    const data = await ledger.ledger(firmId, clientId, q.accountId);
    return reply.send({ data });
  });

  // Balance de sumas y saldos
  app.get("/api/v1/firms/:firmId/clients/:clientId/ledger/trial-balance", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const q = req.query as { periodId?: string };
    const data = await ledger.trialBalance(firmId, clientId, q.periodId);
    return reply.send({ data });
  });
}
