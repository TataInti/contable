import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { IngestionService, ImportError } from "./ingestion-service.js";
import { ManagementExpenseService, ExpenseError } from "./management-expense-service.js";

/**
 * Rutas de ingestión y subledger fiscal (Puerta 2).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 *
 * G2-01: import batches.
 * G2-02/03: validación con adaptadores ARCA.
 * G2-04: vouchers.
 * G2-08: gastos gerenciales.
 * G2-09: revisión independiente.
 * G2-10: commit atómico e idempotente.
 */

export function ingestionRoutes(app: FastifyInstance) {
  const ingestion = new IngestionService();
  const expenses = new ManagementExpenseService();

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof ImportError || err instanceof ExpenseError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 409;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // ------------------------------------------------------------------
  // G2-01: Lotes de importación
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/import-batches", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        origin: z.string().min(1).max(80),
        taxTypeId: z.string().uuid(),
        periodId: z.string().uuid(),
        adapterVersion: z.string().min(1).max(80),
        fileName: z.string().max(240).optional(),
        fileHash: z.string().max(128).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.createBatch(ctx, {
        clientId: ctx.clientId!,
        origin: body.origin,
        taxTypeId: body.taxTypeId,
        periodId: body.periodId,
        adapterVersion: body.adapterVersion,
        ...(body.fileName ? { fileName: body.fileName } : {}),
        ...(body.fileHash ? { fileHash: body.fileHash } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/validate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    const body = z
      .object({
        rows: z.array(z.record(z.string(), z.unknown())).min(1).max(20_000),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.validateBatch(ctx, batchId, body.rows);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/commit", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    const body = z.object({ clientCuit: z.string().regex(/^\d{11}$/) }).strict().parse(req.body ?? {});
    try {
      const data = await ingestion.commitBatch(ctx, batchId, body.clientCuit);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/rows", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    try {
      const data = await ingestion.listBatchRows(ctx, batchId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // G2-05: reconciliación del lote contra los vouchers comiteados.
  app.get("/api/v1/firms/:firmId/clients/:clientId/import-batches/:batchId/reconcile", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { batchId } = req.params as { batchId: string };
    try {
      const data = await ingestion.reconcileBatch(ctx, batchId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G2-04: Vouchers fiscales
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/vouchers", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z.object({ direction: z.enum(["PURCHASE", "SALE"]).optional() }).parse(req.query);
    try {
      const data = await ingestion.listVouchers(ctx, ctx.clientId!, q.direction);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        direction: z.enum(["PURCHASE", "SALE"]),
        type: z.string().min(1).max(10),
        letter: z.string().max(1).optional(),
        pointOfSale: z.number().int().nonnegative(),
        number: z.number().int().nonnegative(),
        issuerCuit: z.string().regex(/^\d{11}$/),
        receiverCuit: z.string().regex(/^\d{11}$/),
        issuedOn: z.string().date(),
        currency: z.string().length(3).optional(),
        exchangeRate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        total: z.string().regex(/^\d+(\.\d+)?$/),
        documentId: z.string().uuid().optional(),
        periodId: z.string().uuid().optional(),
        components: z
          .array(z.object({
            concept: z.string().min(1).max(80),
            base: z.string().regex(/^\d+(\.\d+)?$/),
            rate: z.string().regex(/^\d+(\.\d+)?$/).optional(),
            amount: z.string().regex(/^\d+(\.\d+)?$/),
          }).strict())
          .min(1)
          .max(50),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.createVoucher(ctx, {
        clientId: ctx.clientId!,
        direction: body.direction,
        type: body.type,
        pointOfSale: body.pointOfSale,
        number: body.number,
        issuerCuit: body.issuerCuit,
        receiverCuit: body.receiverCuit,
        issuedOn: body.issuedOn,
        total: body.total,
        components: body.components.map((c) => ({
          concept: c.concept,
          base: c.base,
          amount: c.amount,
          ...(c.rate ? { rate: c.rate } : {}),
        })),
        ...(body.letter ? { letter: body.letter } : {}),
        ...(body.currency ? { currency: body.currency } : {}),
        ...(body.exchangeRate ? { exchangeRate: body.exchangeRate } : {}),
        ...(body.documentId ? { documentId: body.documentId } : {}),
        ...(body.periodId ? { periodId: body.periodId } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // G2-09: revisión independiente de voucher
  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    const body = z
      .object({
        approve: z.boolean(),
        comment: z.string().max(500).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.reviewVoucher(ctx, voucherId, body.approve, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // C-2: transiciones separadas para vouchers (submit-review / approve / reject)
  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    try {
      const data = await ingestion.submitVoucherForReview(ctx, voucherId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/approve", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    try {
      const data = await ingestion.approveVoucher(ctx, voucherId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vouchers/:voucherId/reject", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { voucherId } = req.params as { voucherId: string };
    const body = z
      .object({ comment: z.string().max(500).optional() })
      .strict()
      .parse(req.body);
    try {
      const data = await ingestion.rejectVoucher(ctx, voucherId, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G2-03: Retenciones y percepciones
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/withholdings", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await ingestion.listWithholdings(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/perceptions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await ingestion.listPerceptions(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G2-08: Gastos gerenciales
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/management-expenses", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await expenses.list(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        description: z.string().min(1).max(300),
        amount: z.string().regex(/^\d+(\.\d+)?$/),
        currency: z.string().length(3).optional(),
        incurredOn: z.string().date(),
        paidOn: z.string().date().optional(),
        category: z.string().max(120).optional(),
        hasFiscalSupport: z.boolean(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await expenses.create(ctx, {
        clientId: ctx.clientId!,
        description: body.description,
        amount: body.amount,
        incurredOn: body.incurredOn,
        hasFiscalSupport: body.hasFiscalSupport,
        ...(body.currency ? { currency: body.currency } : {}),
        ...(body.paidOn ? { paidOn: body.paidOn } : {}),
        ...(body.category ? { category: body.category } : {}),
      });
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses/:expenseId/approve-treatment", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { expenseId } = req.params as { expenseId: string };
    const body = z
      .object({
        treatment: z.enum(["MANAGEMENT_ONLY", "FISCAL_COMPUTABLE", "FISCAL_NON_COMPUTABLE", "PENDING_PROFESSIONAL_DECISION"]),
        reason: z.string().min(10).max(1000),
        ruleVersionId: z.string().uuid().optional(),
        evidenceDocumentId: z.string().uuid().optional(),
        reviewedByUserId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await expenses.approveTreatment(ctx, {
        expenseId,
        treatment: body.treatment,
        reason: body.reason,
        reviewedByUserId: body.reviewedByUserId,
        ...(body.ruleVersionId ? { ruleVersionId: body.ruleVersionId } : {}),
        ...(body.evidenceDocumentId ? { evidenceDocumentId: body.evidenceDocumentId } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // C-3: transiciones separadas para gastos gerenciales (submit-review / reject)
  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses/:expenseId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { expenseId } = req.params as { expenseId: string };
    try {
      const data = await expenses.submitForReview(ctx, expenseId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/management-expenses/:expenseId/reject", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { expenseId } = req.params as { expenseId: string };
    const body = z
      .object({ comment: z.string().min(1).max(500) })
      .strict()
      .parse(req.body);
    try {
      const data = await expenses.reject(ctx, expenseId, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
