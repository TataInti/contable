import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { SettlementService, SettlementError } from "./settlement-service.js";
import { FeatureFlagService } from "../flags/feature-flag-service.js";
import { requireTaxRegimeEnabled, TaxRegimeDisabledError } from "./tax-regime-guard.js";
import { prisma } from "../lib/prisma.js";

/** Con `exactOptionalPropertyTypes`, los opcionales se pasan sólo si están definidos. */
function pickDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * Rutas de liquidaciones fiscales (Puerta 3).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 *
 * G3-03: cobertura y cálculo.
 * G3-04: workflow maker-checker (submit-review, request-changes, review, finalize).
 * G3-07: presentación manual y acuse.
 * G3-08: pago, reversión y asignación de crédito.
 * G3-09: rectificación.
 * G3-10: worklist, líneas, diferencias y timeline.
 */

export function settlementRoutes(app: FastifyInstance) {
  const service = new SettlementService();
  const flags = new FeatureFlagService();

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof SettlementError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : err.code.includes("BLOCKING") ? 422 : 409;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof TaxRegimeDisabledError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  /** G6-10: resuelve el código de régimen y verifica su flag de activación. */
  async function assertRegimeEnabled(ctx: ReturnType<typeof tenantContextFromRequest>, regimeId: string) {
    const regime = await prisma.taxRegime.findUnique({ where: { id: regimeId } });
    if (!regime) throw new SettlementError("RULE_VERSION_NOT_FOUND", "Régimen fiscal no encontrado");
    await requireTaxRegimeEnabled(flags, ctx, regime.code);
  }

  // ------------------------------------------------------------------
  // Listas y worklist
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-settlements", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const query = z
      .object({
        periodId: z.string().uuid().optional(),
        accountingPeriodId: z.string().uuid().optional(),
        cutoffFrom: z.string().date().optional(),
        cutoffTo: z.string().date().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .strict()
      .parse(req.query);
    try {
      const result = await service.list(ctx, ctx.clientId!, {
        ...(query.periodId ? { periodId: query.periodId } : {}),
        ...(query.accountingPeriodId ? { accountingPeriodId: query.accountingPeriodId } : {}),
        ...(query.cutoffFrom ? { cutoffFrom: query.cutoffFrom } : {}),
        ...(query.cutoffTo ? { cutoffTo: query.cutoffTo } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.offset !== undefined ? { offset: query.offset } : {}),
      });
      return reply.send({ data: result.data, meta: result.meta });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // F0.1: worklist fiscal con firma explícita en la ruta. El guard global ya
  // valida membresía/rol/capability contra la firma de la ruta (no contexto
  // implícito).
  app.get("/api/v1/firms/:firmId/portfolio/tax-worklist", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const data = await service.worklist(ctx);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/differences", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    try {
      const data = await service.listDifferences(ctx, settlementId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/timeline", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    try {
      const data = await service.timeline(ctx, settlementId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G3-03: Cobertura y cálculo
  // ------------------------------------------------------------------

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/coverage", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({
        periodId: z.string().uuid(),
        regimeId: z.string().uuid().optional(),
      })
      .parse(req.query);
    try {
      const data = await service.coverage(ctx, pickDefined({
        clientId: ctx.clientId!,
        periodId: q.periodId,
        regimeId: q.regimeId,
      }) as { clientId: string; periodId: string; regimeId?: string });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/calculate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        taxTypeId: z.string().uuid(),
        regimeId: z.string().uuid(),
        jurisdictionId: z.string().uuid(),
        periodId: z.string().uuid(),
        cutoff: z.string().date(),
      })
      .strict()
      .parse(req.body);
    try {
      // G6-10: el cálculo de un régimen exige su flag de activación.
      await assertRegimeEnabled(ctx, body.regimeId);
      const data = await service.calculate(ctx, {
        clientId: ctx.clientId!,
        taxTypeId: body.taxTypeId,
        regimeId: body.regimeId,
        jurisdictionId: body.jurisdictionId,
        periodId: body.periodId,
        cutoff: body.cutoff,
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G3-06: Papel de trabajo y export
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/artifacts", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    const body = z.object({ format: z.enum(["csv", "pdf"]) }).strict().parse(req.body);
    try {
      const data = await service.generateArtifact(ctx, { settlementId, format: body.format });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/artifacts", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    try {
      const data = await service.listArtifacts(ctx, settlementId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G3-04: Workflow maker-checker
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    try {
      const data = await service.submitReview(ctx, settlementId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/request-changes", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    const body = z.object({ comment: z.string().trim().min(1).max(1000) }).strict().parse(req.body);
    try {
      const data = await service.requestChanges(ctx, settlementId, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    const body = z.object({ comment: z.string().max(1000).optional() }).strict().parse(req.body ?? {});
    try {
      const data = await service.review(ctx, settlementId, body.comment);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/finalize", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    try {
      const data = await service.finalize(ctx, settlementId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G3-09: Rectificación
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/rectify", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    const body = z.object({ reason: z.string().trim().min(1).max(1000) }).strict().parse(req.body);
    try {
      const data = await service.rectify(ctx, settlementId, body.reason);
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // G3-09: rectificativa con delta por renglón.
  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-settlements/:settlementId/rectify-with-delta", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { settlementId } = req.params as { settlementId: string };
    const body = z.object({ reason: z.string().trim().min(1).max(1000) }).strict().parse(req.body);
    try {
      const data = await service.rectifyWithDelta(ctx, settlementId, body.reason);
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // ------------------------------------------------------------------
  // G3-07/08: Presentación, pago y créditos
  // ------------------------------------------------------------------

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-obligations/:obligationId/filings", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { obligationId } = req.params as { obligationId: string };
    const body = z
      .object({
        settlementId: z.string().uuid(),
        filedAt: z.string().date(),
        amountFiled: z.string().regex(/^-?\d+(\.\d+)?$/),
        externalId: z.string().max(120).optional(),
        evidenceDocumentId: z.string().uuid(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await service.recordFiling(ctx, {
        obligationId,
        settlementId: body.settlementId,
        filedAt: body.filedAt,
        amountFiled: body.amountFiled,
        ...(body.externalId ? { externalId: body.externalId } : {}),
        evidenceDocumentId: body.evidenceDocumentId,
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // D-3: registrar un intento de presentación NO presentado (PENDING).
  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-obligations/:obligationId/filings/pending", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { obligationId } = req.params as { obligationId: string };
    const body = z
      .object({
        settlementId: z.string().uuid(),
        filedAt: z.string().date(),
        amountFiled: z.string().regex(/^-?\d+(\.\d+)?$/),
        externalId: z.string().max(120).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await service.recordFilingPending(ctx, {
        obligationId,
        settlementId: body.settlementId,
        filedAt: body.filedAt,
        amountFiled: body.amountFiled,
        ...(body.externalId ? { externalId: body.externalId } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-obligations/:obligationId/payments", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { obligationId } = req.params as { obligationId: string };
    const body = z
      .object({
        settlementId: z.string().uuid().optional(),
        paidAt: z.string().date(),
        amount: z.string().regex(/^\d+(\.\d+)?$/),
        method: z.string().min(1).max(40),
        reference: z.string().max(120).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await service.recordPayment(ctx, pickDefined({
        obligationId,
        settlementId: body.settlementId,
        paidAt: body.paidAt,
        amount: body.amount,
        method: body.method,
        reference: body.reference,
      }) as { obligationId: string; settlementId?: string; paidAt: string; amount: string; method: string; reference?: string });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-payments/:paymentId/reverse", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { paymentId } = req.params as { paymentId: string };
    const body = z.object({ reason: z.string().trim().min(5).max(1000) }).strict().parse(req.body);
    try {
      const data = await service.reversePayment(ctx, paymentId, body.reason);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-credit-allocations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        creditEntryId: z.string().uuid(),
        settlementId: z.string().uuid(),
        amount: z.string().regex(/^\d+(\.\d+)?$/),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await service.allocateCredit(ctx, {
        creditEntryId: body.creditEntryId,
        settlementId: body.settlementId,
        amount: body.amount,
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
