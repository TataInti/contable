import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { MonthlyWorkpaperService, WorkpaperError } from "./workpaper-service.js";

/**
 * Rutas del expediente mensual de liquidación (Fase 1, PLAN §5.6.6).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}/monthly-tax-workpapers
 *
 * El guard global valida membresía/rol/capability contra la firma de la ruta.
 */

export function workpaperRoutes(app: FastifyInstance) {
  const service = new MonthlyWorkpaperService();

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof WorkpaperError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : err.code.includes("BLOCKING") ? 422 : 409;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  app.get("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({ from: z.string().optional(), to: z.string().optional(), accountingPeriodId: z.string().uuid().optional() })
      .parse(req.query);
    try {
      const data = q.accountingPeriodId
        ? await service.listForAccountingPeriod(ctx, ctx.clientId!, q.accountingPeriodId)
        : await service.list(ctx, ctx.clientId!, q.from, q.to);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        periodStart: z.string().optional(),
        periodEnd: z.string().optional(),
        accountingPeriodId: z.string().uuid().optional(),
      })
      .refine((value) => Boolean(value.accountingPeriodId || (value.periodStart && value.periodEnd)), {
        message: "Indicá un período contable o las fechas del expediente",
      })
      .parse(req.body);
    try {
      const data = await service.create(ctx, {
        clientId: ctx.clientId!,
        ...(body.periodStart ? { periodStart: body.periodStart } : {}),
        ...(body.periodEnd ? { periodEnd: body.periodEnd } : {}),
        ...(body.accountingPeriodId ? { accountingPeriodId: body.accountingPeriodId } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    try {
      const data = await service.get(ctx, workpaperId);
      if (!data) return reply.status(404).send({ error: { code: "WORKPAPER_NOT_FOUND", message: "Expediente no encontrado" } });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/coverage", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    try {
      const data = await service.coverage(ctx, workpaperId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/controls", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    try {
      const data = await service.listControls(ctx, workpaperId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/calculate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    try {
      const data = await service.calculate(ctx, workpaperId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/submit-review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    try {
      const data = await service.submitReview(ctx, workpaperId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/review", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    const body = z
      .object({ approved: z.boolean(), comment: z.string().optional() })
      .parse(req.body);
    try {
      const data = await service.review(ctx, workpaperId, {
        approved: body.approved,
        ...(body.comment ? { comment: body.comment } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/finalize", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    try {
      const data = await service.finalize(ctx, workpaperId);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/rectify", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    try {
      const data = await service.rectify(ctx, workpaperId);
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/controls/:findingId/resolve",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId, findingId } = req.params as { workpaperId: string; findingId: string };
      const body = z
        .object({ resolution: z.string().min(1), status: z.enum(["RESOLVED", "WAIVED"]) })
        .parse(req.body);
      try {
        const data = await service.resolveControl(ctx, workpaperId, findingId, body);
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // F1.7: libro de créditos de solo lectura (TaxCreditLot/Movement).
  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-credit-ledger", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z
      .object({
        taxTypeId: z.string().optional(),
        jurisdictionId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(req.query);
    try {
      const data = await service.creditLedger(ctx, ctx.clientId!, {
        ...(q.taxTypeId ? { taxTypeId: q.taxTypeId } : {}),
        ...(q.jurisdictionId ? { jurisdictionId: q.jurisdictionId } : {}),
        ...(q.from ? { from: q.from } : {}),
        ...(q.to ? { to: q.to } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/tax-credit-ledger/opening", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        taxTypeId: z.string().uuid(),
        regimeId: z.string().uuid().optional(),
        jurisdictionId: z.string().uuid().optional(),
        periodId: z.string().uuid(),
        kind: z.enum(["IVA_TECNICO", "IVA_LIBRE", "SALDO_A_FAVOR"]),
        amount: z.string().regex(/^\d+(\.\d+)?$/),
        evidenceDocumentId: z.string().uuid(),
        reference: z.string().max(240).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await service.createOpeningCredit(ctx, {
        clientId: ctx.clientId!,
        taxTypeId: body.taxTypeId,
        ...(body.regimeId ? { regimeId: body.regimeId } : {}),
        ...(body.jurisdictionId ? { jurisdictionId: body.jurisdictionId } : {}),
        periodId: body.periodId,
        kind: body.kind,
        amount: body.amount,
        evidenceDocumentId: body.evidenceDocumentId,
        ...(body.reference ? { reference: body.reference } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/tax-position", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const query = z
      .object({ periodId: z.string().uuid().optional(), accountingPeriodId: z.string().uuid().optional() })
      .strict()
      .refine((value) => Boolean(value.periodId || value.accountingPeriodId), "Indicá un período fiscal o contable")
      .parse(req.query);
    try {
      const data = query.accountingPeriodId
        ? await service.positionForAccountingPeriod(ctx, ctx.clientId!, query.accountingPeriodId)
        : await service.position(ctx, ctx.clientId!, query.periodId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
