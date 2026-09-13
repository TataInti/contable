import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { MonthlyWorkpaperService, WorkpaperError } from "./workpaper-service.js";
import { SettlementError } from "./settlement-service.js";

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
    if (err instanceof WorkpaperError || err instanceof SettlementError) {
      const status = err.code.includes("NOT_FOUND")
        ? 404
        : err.code.includes("BLOCKING") ||
            err.code.includes("INCOMPLETE") ||
            err.code.includes("SCOPE_INVALID")
          ? 422
          : 409;
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

  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/sources/:sourceLinkId/review",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId, sourceLinkId } = req.params as {
        workpaperId: string;
        sourceLinkId: string;
      };
      try {
        const data = await service.reviewSource(ctx, workpaperId, sourceLinkId);
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.get(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/classifications",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId } = req.params as { workpaperId: string };
      try {
        const data = await service.listClassifications(ctx, workpaperId);
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.patch(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/classifications/:classificationId",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId, classificationId } = req.params as {
        workpaperId: string;
        classificationId: string;
      };
      const body = z
        .object({
          categoryCode: z.enum(["SUPER", "TRANSPORTE"]).optional(),
          activityCode: z.string().trim().min(1).max(40).optional(),
          saveSupplierProfile: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      try {
        const data = await service.classifyVoucher(ctx, workpaperId, classificationId, {
          ...(body.categoryCode ? { categoryCode: body.categoryCode } : {}),
          ...(body.activityCode ? { activityCode: body.activityCode } : {}),
          ...(body.saveSupplierProfile !== undefined
            ? { saveSupplierProfile: body.saveSupplierProfile }
            : {}),
        });
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.get(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/allocations",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId } = req.params as { workpaperId: string };
      try {
        const data = await service.listAllocations(ctx, workpaperId);
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.patch(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/allocations/:allocationId",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId, allocationId } = req.params as {
        workpaperId: string;
        allocationId: string;
      };
      const body = z
        .object({ jurisdiction: z.string().trim().min(1).max(40) })
        .strict()
        .parse(req.body);
      try {
        const data = await service.reallocateInput(ctx, workpaperId, allocationId, body);
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.get(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/calculation",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId } = req.params as { workpaperId: string };
      try {
        const data = await service.calculationBreakdown(ctx, workpaperId);
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

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

  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/interest-snapshots",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { workpaperId } = req.params as { workpaperId: string };
      const body = z
        .object({ obligationId: z.string().uuid(), asOfDate: z.string().date() })
        .strict()
        .parse(req.body);
      try {
        const data = await service.calculateInterest(ctx, workpaperId, body);
        return reply.status(201).send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  app.post("/api/v1/firms/:firmId/clients/:clientId/monthly-tax-workpapers/:workpaperId/calculate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { workpaperId } = req.params as { workpaperId: string };
    const body = z.object({ cutoff: z.string().date().optional() }).strict().parse(req.body ?? {});
    try {
      const data = await service.calculate(ctx, workpaperId, {
        ...(body.cutoff ? { cutoff: body.cutoff } : {}),
      });
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
        .object({
          resolution: z.string().trim().min(1),
          status: z.enum(["RESOLVED", "WAIVED"]),
          evidenceDocumentId: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.body);
      try {
        const data = await service.resolveControl(ctx, workpaperId, findingId, {
          resolution: body.resolution,
          status: body.status,
          ...(body.evidenceDocumentId
            ? { evidenceDocumentId: body.evidenceDocumentId }
            : {}),
        });
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
        evidenceDocumentId: z.string().uuid().optional(),
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
        ...(body.evidenceDocumentId ? { evidenceDocumentId: body.evidenceDocumentId } : {}),
        ...(body.reference ? { reference: body.reference } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // F1.7: edición de metadatos de un lote de crédito (referencia / respaldo / monto).
  // El importe original puede editarse; cada cambio queda auditado en el historial.
  app.patch("/api/v1/firms/:firmId/clients/:clientId/tax-credit-ledger/:lotId", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const { lotId } = z.object({ lotId: z.string().uuid() }).parse(req.params);
    const body = z
      .object({
        reference: z.string().max(240).nullable().optional(),
        evidenceDocumentId: z.string().uuid().nullable().optional(),
        originalAmount: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await service.updateCreditLot(ctx, ctx.clientId!, lotId, {
        ...(body.reference !== undefined ? { reference: body.reference } : {}),
        ...(body.evidenceDocumentId !== undefined
          ? { evidenceDocumentId: body.evidenceDocumentId }
          : {}),
        ...(body.originalAmount !== undefined ? { originalAmount: body.originalAmount } : {}),
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // B1 (§3.1): verificación de un saldo anterior (maker-checker + evidencia).
  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/tax-credit-ledger/:lotId/verify",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { lotId } = z.object({ lotId: z.string().uuid() }).parse(req.params);
      const body = z
        .object({
          evidenceDocumentId: z.string().uuid().optional(),
          officialReference: z.string().max(240).optional(),
        })
        .strict()
        .parse(req.body);
      try {
        const data = await service.verifyCreditLot(ctx, ctx.clientId!, lotId, {
          ...(body.evidenceDocumentId ? { evidenceDocumentId: body.evidenceDocumentId } : {}),
          ...(body.officialReference ? { officialReference: body.officialReference } : {}),
        });
        return reply.send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // B2 (§3.2): registrar uso/compensación de un saldo (movimiento inmutable).
  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/tax-credit-ledger/:lotId/movements",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { lotId } = z.object({ lotId: z.string().uuid() }).parse(req.params);
      const body = z
        .object({
          amount: z.string().regex(/^\d+(\.\d+)?$/),
          reference: z.string().trim().min(1).max(240),
          kind: z.enum(["APPLICATION", "EXTERNAL_USE", "COMPENSATION"]).optional(),
          workpaperId: z.string().uuid().optional(),
          settlementId: z.string().uuid().optional(),
        })
        .strict()
        .parse(req.body);
      try {
        const data = await service.registerCreditUse(ctx, ctx.clientId!, {
          lotId,
          amount: body.amount,
          reference: body.reference,
          ...(body.kind ? { kind: body.kind } : {}),
          ...(body.workpaperId ? { workpaperId: body.workpaperId } : {}),
          ...(body.settlementId ? { settlementId: body.settlementId } : {}),
        });
        return reply.status(201).send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

  // B2 (§3.2): corrección de monto vía movimiento compensatorio.
  app.post(
    "/api/v1/firms/:firmId/clients/:clientId/tax-credit-ledger/:lotId/corrections",
    async (req, reply) => {
      const ctx = tenantContextFromRequest(req);
      const { lotId } = z.object({ lotId: z.string().uuid() }).parse(req.params);
      const body = z
        .object({
          newAmount: z.string().regex(/^\d+(\.\d+)?$/),
          reason: z.string().trim().min(1).max(240),
        })
        .strict()
        .parse(req.body);
      try {
        const data = await service.correctCreditLotAmount(ctx, ctx.clientId!, lotId, {
          newAmount: body.newAmount,
          reason: body.reason,
        });
        return reply.status(201).send({ data });
      } catch (err) {
        return handleError(reply, err);
      }
    },
  );

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
