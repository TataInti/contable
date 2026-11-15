import type { FastifyInstance, FastifyReply } from "fastify";
import { taxPanelQuerySchema } from "@contable/contracts";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { TaxPanelError, TaxPanelService } from "./tax-panel-service.js";

/**
 * Panel de trabajo global por usuario (corte 4a). Solo lectura: la subruta
 * /portfolio/tax-worklist/obligations hereda tax.settlements.read del guard
 * (prefijo /tax-worklist, guard.ts). La visibilidad de filas la impone la RLS por
 * asignación; el modo «me» se resuelve con la sesión, nunca con un parámetro libre.
 */
export function taxPanelRoutes(app: FastifyInstance) {
  const service = new TaxPanelService();

  const handleError = (reply: FastifyReply, err: unknown) => {
    if (err instanceof TaxPanelError) {
      return reply.status(err.status).send({
        error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
      });
    }
    throw err;
  };

  app.get("/api/v1/firms/:firmId/portfolio/tax-worklist/obligations", async (req, reply) => {
    const query = taxPanelQuerySchema.parse(req.query);
    try {
      const result = await service.list(tenantContextFromRequest(req), query);
      return reply.send(result);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
