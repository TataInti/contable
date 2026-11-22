import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { VoucherPermissionsError, VoucherPermissionsService } from "./voucher-permissions-service.js";
import { CLASES_COMPROBANTE } from "./voucher-profile.js";

/**
 * Tipos de comprobante que el cliente puede emitir, por año (corte 4B).
 *
 *   GET /…/clients/:clientId/voucher-permissions?year=AAAA   tildes del año y propuesta por condición
 *   PUT /…/clients/:clientId/voucher-permissions/:year       guarda las tildes del año
 *
 * Los permisos son los del perfil fiscal (`tax.profile.read` / `tax.profile.write`).
 */
export function voucherPermissionRoutes(app: FastifyInstance) {
  const service = new VoucherPermissionsService();

  const yearSchema = z.coerce.number().int().min(2000).max(2100);

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
          details: err.issues.map(({ path, message }) => ({ path, message })),
        },
      });
    }
    if (err instanceof VoucherPermissionsError) {
      return reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.message, details: { path: err.path } },
      });
    }
    throw err;
  };

  app.get("/api/v1/firms/:firmId/clients/:clientId/voucher-permissions", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const query = z
        .object({ year: yearSchema.default(() => new Date().getUTCFullYear()) })
        .strict()
        .parse(req.query);
      const data = await service.get(ctx, { clientId: ctx.clientId!, year: query.year });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.put("/api/v1/firms/:firmId/clients/:clientId/voucher-permissions/:year", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { year } = z.object({ year: yearSchema }).parse(req.params);
      const body = z
        .object({
          allowedClasses: z
            .array(z.enum(CLASES_COMPROBANTE, { message: "Elegí tipos de la lista" }))
            .max(CLASES_COMPROBANTE.length),
          exemptAllowed: z.boolean(),
        })
        .strict()
        .parse(req.body);
      const data = await service.set(ctx, {
        clientId: ctx.clientId!,
        year,
        allowedClasses: body.allowedClasses,
        exemptAllowed: body.exemptAllowed,
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
