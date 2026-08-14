import type { FastifyInstance } from "fastify";
import { FeatureFlagService, type FeatureFlagCode } from "./feature-flag-service.js";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { z } from "zod";

/**
 * Rutas de feature flags (Fase 13).
 * Base: /api/v1/firms/{firmId}
 */

export function flagRoutes(app: FastifyInstance) {
  const flags = new FeatureFlagService();
  const tenantCtx = tenantContextFromRequest;

  // Listar flags de la firma
  app.get("/api/v1/firms/:firmId/feature-flags", async (req, reply) => {
    const flagsList = await flags.list(tenantCtx(req));
    return reply.send({ data: flagsList });
  });

  // Consultar un flag
  app.get("/api/v1/firms/:firmId/feature-flags/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    const q = z.object({ clientId: z.string().uuid().optional() }).strict().parse(req.query);
    const enabled = await flags.isEnabled(tenantCtx(req), code as FeatureFlagCode, q.clientId);
    return reply.send({ data: { code, enabled } });
  });

  // Setear un flag
  app.put("/api/v1/firms/:firmId/feature-flags/:code", async (req, reply) => {
    const { code } = req.params as { code: string };
    const body = z.object({ enabled: z.boolean(), clientId: z.string().uuid().optional() }).strict().parse(req.body);
    const flag = await flags.set(tenantCtx(req), {
      code: code as FeatureFlagCode,
      enabled: body.enabled,
      ...(body.clientId !== undefined ? { clientId: body.clientId } : {}),
    });
    return reply.send({ data: flag });
  });
}
