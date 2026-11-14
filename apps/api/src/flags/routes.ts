import type { FastifyInstance } from "fastify";
import { FEATURE_FLAGS, FeatureFlagService, type FeatureFlagCode } from "./feature-flag-service.js";
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
    const ctx = tenantCtx(req);
    const stored = await flags.list(ctx);
    // Un estudio nuevo no tiene filas: se completan los módulos conocidos (apagados) para que
    // la pantalla de módulos pueda habilitarlos. Al habilitar uno, PUT crea la fila.
    const firmLevel = new Set(stored.filter((flag) => flag.clientId === null).map((flag) => flag.code));
    const missing = FEATURE_FLAGS.filter((code) => !firmLevel.has(code)).map((code) => ({
      id: `default:${code}`,
      firmId: ctx.firmId,
      clientId: null,
      code,
      enabled: false,
      createdAt: null,
      updatedAt: null,
    }));
    return reply.send({ data: [...stored, ...missing] });
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
