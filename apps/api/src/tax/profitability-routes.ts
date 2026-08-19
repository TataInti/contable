import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { ProfitabilityService, ProfitabilityError } from "./profitability-service.js";

/**
 * Rutas de rentabilidad gerencial (Puerta 5).
 * Base: /api/v1/firms/{firmId}/clients/{clientId}
 *
 * G5-01/02: cálculo DEVENGADO y CAJA.
 * G5-05: publicación versionada (sólo datos publicados llegan al portal).
 */

const basisEnum = z.enum(["DEVENGADO", "CAJA"]);

export function profitabilityRoutes(app: FastifyInstance) {
  const service = new ProfitabilityService();

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof ProfitabilityError) {
      const status = err.code.includes("NOT_FOUND") ? 404 : 409;
      return reply.status(status).send({ error: { code: err.code, message: err.message } });
    }
    throw err;
  };

  // Historial versionado del cliente.
  app.get("/api/v1/firms/:firmId/clients/:clientId/profitability", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const q = z.object({ periodId: z.string().uuid().optional() }).parse(req.query);
    try {
      const data = q.periodId
        ? await service.listForPeriod(ctx, ctx.clientId!, q.periodId)
        : await service.list(ctx, ctx.clientId!);
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Calcula (o recalcula) un snapshot DRAFT en la base pedida.
  app.post("/api/v1/firms/:firmId/clients/:clientId/profitability/calculate", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({
        periodId: z.string().uuid(),
        basis: basisEnum,
        cutoff: z.string().date(),
      })
      .strict()
      .parse(req.body);
    try {
      const data = await service.calculate(ctx, {
        clientId: ctx.clientId!,
        periodId: body.periodId,
        basis: body.basis,
        cutoff: body.cutoff,
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  // Publica la versión en curso (G5-05: snapshot inmutable versionado).
  app.post("/api/v1/firms/:firmId/clients/:clientId/profitability/publish", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const body = z
      .object({ periodId: z.string().uuid(), basis: basisEnum })
      .strict()
      .parse(req.body);
    try {
      const data = await service.publish(ctx, {
        clientId: ctx.clientId!,
        periodId: body.periodId,
        basis: body.basis,
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}