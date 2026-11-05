import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ObjectStorage } from "@contable/storage";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { ClientDeletionService } from "./client-deletion-service.js";

const confirmationSchema = z
  .object({
    confirmation: z.string().min(1).max(300),
  })
  .strict();

/**
 * Rutas de borrado definitivo de clientes.
 * La capability data.delete (sólo OWNER) se valida en el guard global antes
 * de llegar al handler; el servicio repite la validación de estudio/cliente.
 */
export function clientDeletionRoutes(app: FastifyInstance) {
  const service = new ClientDeletionService(new ObjectStorage());

  app.get("/api/v1/firms/:firmId/clients/:clientId/deletion-preview", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const data = await service.preview(firmId, clientId, tenantContextFromRequest(req));
    return reply.send({ data });
  });

  app.delete("/api/v1/firms/:firmId/clients/:clientId", async (req, reply) => {
    const { firmId, clientId } = req.params as { firmId: string; clientId: string };
    const body = confirmationSchema.parse(req.body ?? {});
    const data = await service.delete(
      firmId,
      clientId,
      body.confirmation,
      tenantContextFromRequest(req),
    );
    return reply.send({ data });
  });
}
