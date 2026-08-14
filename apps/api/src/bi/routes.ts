import type { FastifyInstance } from "fastify";
import { BiService, BiError, type BiPlan } from "./bi-service.js";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { withTenantContext } from "../auth/tenant.js";
import { z } from "zod";

const biPlanSchema = z.object({ version: z.number().int().positive(), clientId: z.string().uuid(), fiscalPeriodId: z.string().uuid(), metric: z.string().min(1).max(80), dimensions: z.array(z.string().max(80)).max(3), filters: z.array(z.object({ field: z.string(), operator: z.string(), value: z.union([z.string(), z.array(z.string())]) }).strict()).max(5), comparison: z.string(), limit: z.number().int().min(1).max(1000) }).strict();

/**
 * Rutas del copiloto BI (Fase 12).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 */

export function biRoutes(app: FastifyInstance) {
  const bi = new BiService();
  const tenantCtx = tenantContextFromRequest;

  const handleError = (reply: { status: (code: number) => { send: (body: object) => void } }, err: unknown) => {
    if (err instanceof BiError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 400;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // Crear métrica
  app.get("/api/v1/firms/:firmId/clients/:clientId/bi/metrics", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.biMetric.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId!, isActive: true }, orderBy: { name: "asc" }, take: 200,
    }));
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/bi/dashboards", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const data = await withTenantContext(ctx, (tx) => tx.biDashboard.findMany({
      where: { firmId: ctx.firmId, clientId: ctx.clientId! }, include: { widgets: true, snapshots: { take: 1, orderBy: { createdAt: "desc" } } },
      orderBy: { updatedAt: "desc" }, take: 100,
    }));
    return reply.send({ data });
  });
  app.post("/api/v1/firms/:firmId/clients/:clientId/bi/metrics", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ code: z.string().min(1).max(80), name: z.string().min(1).max(160), definition: z.unknown() }).strict().parse(req.body);
    try {
      const metric = await bi.createMetric(tenantCtx(req), { code: body.code, name: body.name, definition: body.definition as unknown, clientId });
      return reply.status(201).send({ data: metric });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Crear dashboard
  app.post("/api/v1/firms/:firmId/clients/:clientId/bi/dashboards", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ name: z.string().min(1).max(160), layout: z.unknown().optional() }).strict().parse(req.body);
    try {
      const dashboard = await bi.createDashboard(tenantCtx(req), { ...body, clientId });
      return reply.status(201).send({ data: dashboard });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Generar plan
  app.post("/api/v1/firms/:firmId/clients/:clientId/bi/plan", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ periodId: z.string().uuid(), query: z.string().trim().min(1).max(4000) }).strict().parse(req.body);
    try {
      const plan = await bi.plan(tenantCtx(req), { ...body, clientId });
      return reply.send({ data: plan });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Ejecutar plan
  app.post("/api/v1/firms/:firmId/clients/:clientId/bi/execute", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const body = z.object({ plan: biPlanSchema }).strict().parse(req.body);
    try {
      const result = await bi.execute(tenantCtx(req), { clientId, plan: body.plan });
      return reply.send({ data: result });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Crear widget
  app.post("/api/v1/firms/:firmId/clients/:clientId/bi/dashboards/:dashboardId/widgets", async (req, reply) => {
    const { clientId, dashboardId } = req.params as { clientId: string; dashboardId: string };
    const body = z.object({ title: z.string().min(1).max(160), plan: biPlanSchema, result: z.unknown(), resultHash: z.string().regex(/^[a-f0-9]{64}$/), metricId: z.string().uuid() }).strict().parse(req.body) as { title: string; plan: BiPlan; result: unknown; resultHash: string; metricId: string };
    try {
      const widget = await bi.createWidget(tenantCtx(req), { ...body, clientId, dashboardId });
      return reply.status(201).send({ data: widget });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Snapshot
  app.post("/api/v1/firms/:firmId/clients/:clientId/bi/dashboards/:dashboardId/snapshot", async (req, reply) => {
    const { dashboardId } = req.params as { dashboardId: string };
    const body = z.object({ cutoff: z.string().datetime() }).strict().parse(req.body);
    try {
      const snapshot = await bi.snapshot(tenantCtx(req), dashboardId, body.cutoff);
      return reply.status(201).send({ data: snapshot });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
