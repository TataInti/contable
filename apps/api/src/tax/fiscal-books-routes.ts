import type { FastifyInstance, FastifyReply } from "fastify";
import { fiscalBookExportQuerySchema, fiscalBookSummaryQuerySchema } from "@contable/contracts";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { FiscalBooksError, FiscalBooksService } from "./fiscal-books-service.js";

/**
 * Libros de compras y ventas (corte 7a). Base: /api/v1/firms/{firmId}/clients/{clientId}.
 * Solo lectura con tax.vouchers.read (guard.ts, ROUTE_POLICY). El guard exige la
 * asignación del cliente para quien no es Titular ni Administrador (404).
 */
export function fiscalBooksRoutes(app: FastifyInstance) {
  const service = new FiscalBooksService();

  const handleError = (reply: FastifyReply, err: unknown) => {
    if (err instanceof FiscalBooksError) {
      const status = err.code.endsWith("NOT_FOUND") ? 404 : 400;
      return reply.status(status).send({
        error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
      });
    }
    throw err;
  };

  app.get("/api/v1/firms/:firmId/clients/:clientId/fiscal-books/summary", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const query = fiscalBookSummaryQuerySchema.parse(req.query);
    try {
      const data = await service.summary(tenantContextFromRequest(req), { clientId, periodId: query.periodId });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/clients/:clientId/fiscal-books/export", async (req, reply) => {
    const { clientId } = req.params as { clientId: string };
    const query = fiscalBookExportQuerySchema.parse(req.query);
    try {
      const file = await service.export(tenantContextFromRequest(req), { clientId, ...query });
      return reply
        .header("Content-Type", file.contentType)
        .header("Content-Disposition", `attachment; filename="${file.filename}"`)
        .header("Cache-Control", "private, no-store")
        .send(file.body);
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
