import type { FastifyInstance } from "fastify";
import { BankService, BankError } from "./bank-service.js";
import { AdjustmentService, AdjustmentError } from "./adjustment-service.js";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { withTenantContext } from "../auth/tenant.js";
import { z } from "zod";

const money = z.string().regex(/^-?\d+(?:\.\d{1,4})?$/);
const date = z.string().date();

/**
 * Rutas de bancos, moneda extranjera e inflación (Fase 7).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function bankingRoutes(app: FastifyInstance) {
  const bank = new BankService();
  const adjustments = new AdjustmentService();

  const handleError = (reply: { status: (code: number) => { send: (body: object) => void } }, err: unknown) => {
    if (err instanceof BankError || err instanceof AdjustmentError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 400;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // Crear cuenta bancaria
  app.get("/api/v1/firms/:firmId/clients/:clientId/bank-accounts", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.bankAccount.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! },
      include: { statements: { include: { movements: true }, orderBy: { periodStart: "desc" } }, reconciliations: true },
      orderBy: { bankName: "asc" }, take: 100,
    }));
    return reply.send({ data });
  });
  app.post("/api/v1/firms/:firmId/clients/:clientId/bank-accounts", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ accountId: z.string().uuid(), bankName: z.string().trim().min(1).max(120), accountNumber: z.string().trim().min(1).max(80), cbu: z.string().max(40).optional(), alias: z.string().max(80).optional(), currencyCode: z.string().length(3).optional() }).strict().parse(req.body);
    try {
      const account = await bank.createBankAccount(tenantContextFromRequest(req), { accountId: body.accountId, bankName: body.bankName, accountNumber: body.accountNumber, clientId, ...(body.cbu ? { cbu: body.cbu } : {}), ...(body.alias ? { alias: body.alias } : {}), ...(body.currencyCode ? { currencyCode: body.currencyCode } : {}) });
      return reply.status(201).send({ data: account });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Importar movimientos
  app.post("/api/v1/firms/:firmId/clients/:clientId/bank-accounts/:bankAccountId/import", async (req, reply) => {
    const { bankAccountId } = req.params as { bankAccountId: string };
    const body = z.object({ periodStart: date, periodEnd: date, openingBalance: money, closingBalance: money, currencyCode: z.string().length(3).optional(), sourceType: z.string().max(40).optional(), rows: z.array(z.object({ externalId: z.string().max(160).optional(), valueDate: date, description: z.string().min(1).max(500), amount: money, currencyCode: z.string().length(3).optional(), reference: z.string().max(200).optional() }).strict()).min(1).max(10000) }).strict().parse(req.body);
    try {
      const result = await bank.importMovements(tenantContextFromRequest(req), {
        bankAccountId, periodStart: body.periodStart, periodEnd: body.periodEnd,
        openingBalance: body.openingBalance, closingBalance: body.closingBalance,
        rows: body.rows as never,
        ...(body.currencyCode ? { currencyCode: body.currencyCode } : {}),
        ...(body.sourceType ? { sourceType: body.sourceType } : {}),
      });
      return reply.status(201).send({ data: result });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Confirmar match
  app.post("/api/v1/firms/:firmId/clients/:clientId/bank-movements/:movementId/match", async (req, reply) => {
    const { movementId } = req.params as { movementId: string };
    const body = z.object({ entryId: z.string().uuid(), appliedAmount: money }).strict().parse(req.body);
    try {
      const match = await bank.confirmMatch(tenantContextFromRequest(req), { movementId, ...body });
      return reply.status(201).send({ data: match });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Finalizar conciliación
  app.post("/api/v1/firms/:firmId/clients/:clientId/bank-accounts/:bankAccountId/reconcile", async (req, reply) => {
    const { bankAccountId } = req.params as { bankAccountId: string };
    const body = z.object({ periodStart: date, periodEnd: date, openingBalance: money, closingBalance: money }).strict().parse(req.body);
    try {
      const rec = await bank.finalizeReconciliation(tenantContextFromRequest(req), { ...body, bankAccountId });
      return reply.status(201).send({ data: rec });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Reabrir conciliación
  app.post("/api/v1/firms/:firmId/clients/:clientId/bank-reconciliations/:reconciliationId/reopen", async (req, reply) => {
    const { reconciliationId } = req.params as { reconciliationId: string };
    const body = z.object({ reason: z.string().trim().min(1).max(500).optional() }).strict().parse(req.body ?? {});
    try {
      const rec = await bank.reopenReconciliation(tenantContextFromRequest(req), reconciliationId, body.reason ?? "Reapertura");
      return reply.send({ data: rec });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Run de diferencia de cambio
  app.post("/api/v1/firms/:firmId/clients/:clientId/adjustments/exchange-difference", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ fiscalYearId: z.string().uuid(), periodId: z.string().uuid(), asOfDate: date, rateSourceId: z.string().uuid() }).strict().parse(req.body);
    try {
      const run = await adjustments.runExchangeDifference(tenantContextFromRequest(req), { ...body, clientId });
      return reply.status(201).send({ data: run });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Run de inflación
  app.post("/api/v1/firms/:firmId/clients/:clientId/adjustments/inflation", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ fiscalYearId: z.string().uuid(), periodId: z.string().uuid(), asOfDate: date, indexId: z.string().uuid(), indexVersion: z.string().min(1).max(80), policyVersion: z.string().min(1).max(80), ledgerCutoff: z.string().datetime() }).strict().parse(req.body);
    try {
      const run = await adjustments.runInflation(tenantContextFromRequest(req), { ...body, clientId });
      return reply.status(201).send({ data: run });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
