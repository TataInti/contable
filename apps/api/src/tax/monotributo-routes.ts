import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { MonotributoError, MonotributoService } from "./monotributo-service.js";
import { currentMonthKey } from "./monotributo-cuota.js";

/**
 * Cuota fija mensual del Monotributo (corte 3F).
 *
 *   GET  /…/clients/:clientId/monotributo?month=AAAA-MM        cuota del mes, pagos e historial de categorías
 *   PUT  /…/clients/:clientId/monotributo-categories/:month    elige la categoría y el tipo desde ese mes
 *   POST /…/clients/:clientId/monotributo/payments             registra un pago de la cuota
 *
 * Permisos: la categoría con los del perfil fiscal (`tax.profile.*`); el pago con `tax.payments.record`.
 */
export function monotributoRoutes(app: FastifyInstance) {
  const service = new MonotributoService();

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
    if (err instanceof MonotributoError) {
      return reply.status(err.httpStatus).send({
        error: { code: err.code, message: err.message, details: { path: err.path } },
      });
    }
    throw err;
  };

  app.get("/api/v1/firms/:firmId/clients/:clientId/monotributo", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const query = z
        .object({ month: z.string().optional() })
        .strict()
        .parse(req.query);
      const data = await service.get(ctx, { clientId: ctx.clientId!, month: query.month ?? currentMonthKey() });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.put("/api/v1/firms/:firmId/clients/:clientId/monotributo-categories/:month", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { month } = z.object({ month: z.string() }).parse(req.params);
      const body = z
        .object({
          category: z.string().trim().min(1, "Elegí una categoría").max(20),
          activity: z.string().trim().min(1, "Elegí si la actividad es de servicios o de venta de bienes").max(20),
        })
        .strict()
        .parse(req.body);
      const data = await service.setCategory(ctx, {
        clientId: ctx.clientId!,
        month,
        category: body.category,
        activity: body.activity,
      });
      return reply.send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/clients/:clientId/monotributo/payments", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const body = z
        .object({
          month: z.string(),
          paidAt: z.string().min(1, "Ingresá la fecha del pago"),
          amount: z.string().trim().min(1, "Ingresá el importe del pago").max(20),
          comprobante: z.string().max(80, "El comprobante admite hasta 80 caracteres").optional(),
        })
        .strict()
        .parse(req.body);
      const data = await service.recordPayment(ctx, {
        clientId: ctx.clientId!,
        month: body.month,
        paidAt: body.paidAt,
        amount: body.amount,
        ...(body.comprobante !== undefined ? { comprobante: body.comprobante } : {}),
      });
      return reply.status(201).send({ data });
    } catch (err) {
      return handleError(reply, err);
    }
  });
}
