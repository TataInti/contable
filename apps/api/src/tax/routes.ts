import type { FastifyInstance, FastifyRequest } from "fastify";
import { VatService, VatError } from "./vat-service.js";
import { ObligationService, ObligationError } from "./obligation-service.js";
import { CloseService, CloseError } from "./close-service.js";
import { WorkService, WorkError } from "./work-service.js";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { withTenantContext } from "../auth/tenant.js";
import { FeatureFlagService } from "../flags/feature-flag-service.js";
import { requireTaxEnabled, TaxLegacyDisabledError } from "./tax-flag-guard.js";
import { z } from "zod";

/**
 * Rutas de IVA, obligaciones, cierres y trabajo (Fase 8).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function taxRoutes(app: FastifyInstance) {
  const vat = new VatService();
  const obligations = new ObligationService();
  const close = new CloseService();
  const work = new WorkService();
  const flags = new FeatureFlagService();
  const tenantCtx = tenantContextFromRequest;

  const handleError = (reply: { status: (code: number) => { send: (body: object) => void } }, err: unknown) => {
    if (err instanceof TaxLegacyDisabledError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof VatError || err instanceof ObligationError || err instanceof CloseError || err instanceof WorkError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 400;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // --- IVA ---
  app.get("/api/v1/firms/:firmId/clients/:clientId/vat/liquidations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.vatLiquidation.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! }, orderBy: { createdAt: "desc" }, take: 100,
    }));
    return reply.send({ data });
  });
  app.post("/api/v1/firms/:firmId/clients/:clientId/vat/liquidations", async (req, reply) => {
    try {
      await requireTaxEnabled(flags, tenantCtx(req));
    } catch (err) {
      return handleError(reply, err);
    }
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ periodId: z.string().uuid(), cutoff: z.string().datetime(), rulesVersion: z.number().int().positive() }).strict().parse(req.body);
    try {
      const liq = await vat.calculate(tenantCtx(req), { ...body, clientId });
      return reply.status(201).send({ data: liq });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vat/liquidations/:liquidationId/finalize", async (req, reply) => {
    try {
      await requireTaxEnabled(flags, tenantCtx(req));
    } catch (err) {
      return handleError(reply, err);
    }
    const { liquidationId } = req.params as { liquidationId: string };
    try {
      const liq = await vat.finalize(tenantCtx(req), liquidationId);
      return reply.send({ data: liq });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/vat/liquidations/:liquidationId/rectify", async (req, reply) => {
    try {
      await requireTaxEnabled(flags, tenantCtx(req));
    } catch (err) {
      return handleError(reply, err);
    }
    const { liquidationId } = req.params as { liquidationId: string };
    try {
      const liq = await vat.rectify(tenantCtx(req), liquidationId);
      return reply.status(201).send({ data: liq });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // --- Obligaciones ---
  app.get("/api/v1/firms/:firmId/clients/:clientId/obligations", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.obligation.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! },
      include: { instances: { include: { reminders: true }, orderBy: { dueDate: "asc" } } },
      orderBy: { name: "asc" }, take: 200,
    }));
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/obligation-instances", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.obligationInstance.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! }, include: { obligation: true, reminders: true },
      orderBy: { dueDate: "asc" }, take: 300,
    }));
    return reply.send({ data });
  });
  app.post("/api/v1/firms/:firmId/clients/:clientId/obligations", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ code: z.string().min(1).max(80), name: z.string().min(1).max(160), jurisdiction: z.string().max(120).optional(), frequency: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL", "ONCE"]).optional(), dueDay: z.number().int().min(1).max(31).optional() }).strict().parse(req.body);
    try {
      const obligation = await obligations.createObligation(tenantCtx(req), { code: body.code, name: body.name, clientId, ...(body.jurisdiction ? { jurisdiction: body.jurisdiction } : {}), ...(body.frequency ? { frequency: body.frequency } : {}), ...(body.dueDay !== undefined ? { dueDay: body.dueDay } : {}) });
      return reply.status(201).send({ data: obligation });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/obligations/:obligationId/materialize", async (req, reply) => {
    const { obligationId } = req.params as { obligationId: string };
    const body = z.object({ periodLabel: z.string().min(1).max(80), dueDate: z.string().date() }).strict().parse(req.body);
    try {
      const instance = await obligations.materializeInstance(tenantCtx(req), { obligationId, ...body });
      return reply.status(201).send({ data: instance });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/obligations/:obligationId/reminders", async (req, reply) => {
    const { obligationId } = req.params as { obligationId: string };
    const body = z.object({ instanceId: z.string().uuid(), scheduledFor: z.string().datetime(), rule: z.string().max(80).optional(), offsetDays: z.number().int().min(-365).max(365).optional(), channel: z.enum(["EMAIL", "IN_APP"]).optional() }).strict().parse(req.body);
    try {
      const dispatch = await obligations.scheduleReminder(tenantCtx(req), { obligationId, instanceId: body.instanceId, scheduledFor: body.scheduledFor, ...(body.rule ? { rule: body.rule } : {}), ...(body.offsetDays !== undefined ? { offsetDays: body.offsetDays } : {}), ...(body.channel ? { channel: body.channel } : {}) });
      return reply.status(201).send({ data: dispatch });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // --- Cierres ---
  app.get("/api/v1/firms/:firmId/clients/:clientId/close-cycles", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.closeCycle.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! }, include: { workItems: true },
      orderBy: { createdAt: "desc" }, take: 100,
    }));
    return reply.send({ data });
  });
  app.post("/api/v1/firms/:firmId/clients/:clientId/close-cycles", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ fiscalYearId: z.string().uuid(), periodId: z.string().uuid(), items: z.array(z.object({ code: z.string().min(1).max(80), title: z.string().min(1).max(200) }).strict()).min(1).max(200) }).strict().parse(req.body);
    try {
      const cycle = await close.createCycle(tenantCtx(req), { ...body, clientId });
      return reply.status(201).send({ data: cycle });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/close-cycles/:cycleId/work-items/:workItemId/complete", async (req, reply) => {
    const { cycleId, workItemId } = req.params as { cycleId: string; workItemId: string };
    try {
      const item = await close.completeWorkItem(tenantCtx(req), cycleId, workItemId);
      return reply.send({ data: item });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/close-cycles/:cycleId/finalize", async (req, reply) => {
    const { cycleId } = req.params as { cycleId: string };
    try {
      const cycle = await close.finalizeCycle(tenantCtx(req), cycleId);
      return reply.send({ data: cycle });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // --- Trabajo ---
  app.get("/api/v1/firms/:firmId/clients/:clientId/document-requests", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.documentRequest.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! },
      include: { items: true, threads: { include: { messages: { orderBy: { createdAt: "asc" } } } } },
      orderBy: { createdAt: "desc" }, take: 200,
    }));
    return reply.send({ data });
  });
  app.post("/api/v1/firms/:firmId/clients/:clientId/document-requests", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ title: z.string().min(1).max(200), description: z.string().max(4000).optional(), dueDate: z.string().date().optional(), items: z.array(z.object({ description: z.string().min(1).max(500), required: z.boolean().optional() }).strict()).min(1).max(100) }).strict().parse(req.body);
    try {
      const request = await work.createRequest(tenantCtx(req), { title: body.title, items: body.items.map((item) => ({ description: item.description, ...(item.required !== undefined ? { required: item.required } : {}) })), clientId, ...(body.description ? { description: body.description } : {}), ...(body.dueDate ? { dueDate: body.dueDate } : {}) });
      return reply.status(201).send({ data: request });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/document-requests/:requestId/items/:itemId/attach", async (req, reply) => {
    const { requestId, itemId } = req.params as { requestId: string; itemId: string };
    const body = z.object({ documentId: z.string().uuid() }).strict().parse(req.body);
    try {
      const item = await work.attachDocument(tenantCtx(req), requestId, itemId, body.documentId);
      return reply.send({ data: item });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/document-requests/:requestId/threads", async (req, reply) => {
    const { requestId } = req.params as { requestId: string };
    const body = z.object({ visibility: z.enum(["INTERNAL", "SHARED"]).optional() }).strict().parse(req.body ?? {});
    try {
      const thread = await work.createThread(tenantCtx(req), requestId, body.visibility);
      return reply.status(201).send({ data: thread });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/threads/:threadId/messages", async (req, reply) => {
    const { threadId } = req.params as { threadId: string };
    const body = z.object({ body: z.string().trim().min(1).max(5000), visibility: z.enum(["INTERNAL", "SHARED"]).optional() }).strict().parse(req.body);
    try {
      const message = await work.addMessage(tenantCtx(req), threadId, body.body, body.visibility);
      return reply.status(201).send({ data: message });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.patch("/api/v1/firms/:firmId/clients/:clientId/threads/:threadId/messages/:messageId/visibility", async (req, reply) => {
    const { messageId } = req.params as { messageId: string };
    const body = z.object({ visibility: z.enum(["INTERNAL", "SHARED"]), confirmed: z.boolean().optional() }).strict().parse(req.body);
    try {
      const message = await work.changeVisibility(tenantCtx(req), messageId, body.visibility, body.confirmed);
      return reply.send({ data: message });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
