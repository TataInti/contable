import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { TemCategoryError, TemCategoryService } from "./tem-category-service.js";

/**
 * Categoría anual del TEM del cliente (corte 1E).
 *
 *   GET /…/clients/:clientId/tem-categories?year=AAAA   categoría del año y opciones del catálogo
 *   PUT /…/clients/:clientId/tem-categories/:year       elige o cambia la categoría del año
 *
 * Los permisos son los del perfil fiscal (`tax.profile.read` / `tax.profile.write`).
 */
export function temCategoryRoutes(app: FastifyInstance) {
  const service = new TemCategoryService();

  const yearSchema = z.coerce.number().int().min(2000).max(2100);

  const handleError = (
    reply: { status: (code: number) => { send: (body: object) => void } },
    err: unknown,
  ) => {
    if (err instanceof z.ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: err.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          details: err.issues.map(({ path, message }) => ({ path, message })),
        },
      });
    }
    if (err instanceof TemCategoryError) {
      return reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.message, details: { path: err.path } },
      });
    }
    throw err;
  };

  app.get("/api/v1/firms/:firmId/clients/:clientId/tem-categories", async (req, reply) => {
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

  app.put("/api/v1/firms/:firmId/clients/:clientId/tem-categories/:year", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { year } = z.object({ year: yearSchema }).parse(req.params);
      const body = z
        .object({ category: z.string().trim().min(1, "Elegí una categoría").max(20) })
        .strict()
        .parse(req.body);
      const data = await service.set(ctx, {
        clientId: ctx.clientId!,
        year,
        category: body.category,
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
