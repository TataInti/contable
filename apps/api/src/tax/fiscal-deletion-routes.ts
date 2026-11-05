import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { FiscalDeletionService } from "./fiscal-deletion-service.js";

const confirmationSchema = z
  .object({
    confirmation: z.string().min(1).max(300),
  })
  .strict();

/**
 * Rutas de borrado definitivo de catálogos y reglas fiscales.
 * Sólo OWNER: la capability data.delete se valida en el guard global.
 */
export function fiscalDeletionRoutes(app: FastifyInstance) {
  const service = new FiscalDeletionService();

  app.get("/api/v1/firms/:firmId/tax/authorities/:authorityId/deletion-preview", async (req, reply) => {
    const { authorityId } = req.params as { authorityId: string };
    const data = await service.previewAuthority(authorityId, tenantContextFromRequest(req));
    return reply.send({ data });
  });

  app.delete("/api/v1/firms/:firmId/tax/authorities/:authorityId", async (req, reply) => {
    const { authorityId } = req.params as { authorityId: string };
    const body = confirmationSchema.parse(req.body ?? {});
    const data = await service.deleteAuthority(
      authorityId,
      body.confirmation,
      tenantContextFromRequest(req),
    );
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/tax/regimes/:regimeId/deletion-preview", async (req, reply) => {
    const { regimeId } = req.params as { regimeId: string };
    const data = await service.previewRegime(regimeId, tenantContextFromRequest(req));
    return reply.send({ data });
  });

  app.delete("/api/v1/firms/:firmId/tax/regimes/:regimeId", async (req, reply) => {
    const { regimeId } = req.params as { regimeId: string };
    const body = confirmationSchema.parse(req.body ?? {});
    const data = await service.deleteRegime(
      regimeId,
      body.confirmation,
      tenantContextFromRequest(req),
    );
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/tax/activities/:activityId/deletion-preview", async (req, reply) => {
    const { activityId } = req.params as { activityId: string };
    const data = await service.previewActivity(activityId, tenantContextFromRequest(req));
    return reply.send({ data });
  });

  app.delete("/api/v1/firms/:firmId/tax/activities/:activityId", async (req, reply) => {
    const { activityId } = req.params as { activityId: string };
    const body = confirmationSchema.parse(req.body ?? {});
    const data = await service.deleteActivity(
      activityId,
      body.confirmation,
      tenantContextFromRequest(req),
    );
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/tax/rule-packs/:packId/deletion-preview", async (req, reply) => {
    const { packId } = req.params as { packId: string };
    const data = await service.previewRulePack(packId, tenantContextFromRequest(req));
    return reply.send({ data });
  });

  app.delete("/api/v1/firms/:firmId/tax/rule-packs/:packId", async (req, reply) => {
    const { packId } = req.params as { packId: string };
    const body = confirmationSchema.parse(req.body ?? {});
    const data = await service.deleteRulePack(
      packId,
      body.confirmation,
      tenantContextFromRequest(req),
    );
    return reply.send({ data });
  });

  app.get("/api/v1/firms/:firmId/tax/rule-versions/:versionId/deletion-preview", async (req, reply) => {
    const { versionId } = req.params as { versionId: string };
    const data = await service.previewRuleVersion(versionId, tenantContextFromRequest(req));
    return reply.send({ data });
  });

  app.delete("/api/v1/firms/:firmId/tax/rule-versions/:versionId", async (req, reply) => {
    const { versionId } = req.params as { versionId: string };
    const body = confirmationSchema.parse(req.body ?? {});
    const data = await service.deleteRuleVersion(
      versionId,
      body.confirmation,
      tenantContextFromRequest(req),
    );
    return reply.send({ data });
  });
}
