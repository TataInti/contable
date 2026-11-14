import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import {
  createTaxCalendarSchema,
  taxCalendarEntryInputSchema,
  taxCalendarEntryPatchSchema,
  taxCalendarListQuerySchema,
  updateTaxCalendarSchema,
} from "@contable/contracts";
import { tenantContextFromRequest } from "../auth/tenant.js";
import { TaxCalendarError, TaxCalendarRegistryService } from "./tax-calendar-service.js";

/**
 * Rutas de calendarios fiscales del estudio (corte 2a-i). Las capacidades las
 * resuelve el guard por el método y el path (tax.calendars.read, .manage y .publish).
 */

const calendars = new TaxCalendarRegistryService();

function handleError(app: FastifyInstance, reply: FastifyReply, err: unknown) {
  if (err instanceof z.ZodError) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
        details: err.issues.map(({ path, message }) => ({ path, message })),
      },
    });
  }
  if (err instanceof TaxCalendarError) {
    return reply.status(err.httpStatus).send({
      error: {
        code: err.code,
        message: err.message,
        ...(err.path || err.problems
          ? { details: { ...(err.path ? { path: err.path } : {}), ...(err.problems ? { problems: err.problems } : {}) } }
          : {}),
      },
    });
  }
  app.log.error({ err }, "Error interno de calendarios fiscales");
  return reply.status(500).send({
    error: { code: "INTERNAL_ERROR", message: "Ocurrió un error interno" },
  });
}

export function taxCalendarRoutes(app: FastifyInstance) {
  app.get("/api/v1/firms/:firmId/tax-calendars", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const query = taxCalendarListQuerySchema.parse(req.query ?? {});
      const data = await calendars.list(ctx, query);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/tax-calendars", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const body = createTaxCalendarSchema.parse(req.body);
      const data = await calendars.create(ctx, body);
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/tax-calendars/:calendarId", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const data = await calendars.get(ctx, calendarId);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.patch("/api/v1/firms/:firmId/tax-calendars/:calendarId", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const body = updateTaxCalendarSchema.parse(req.body);
      const data = await calendars.update(ctx, calendarId, body);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/tax-calendars/:calendarId/entries", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const body = taxCalendarEntryInputSchema.parse(req.body);
      const data = await calendars.addEntry(ctx, calendarId, body);
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.patch("/api/v1/firms/:firmId/tax-calendars/:calendarId/entries/:entryId", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId, entryId } = req.params as { calendarId: string; entryId: string };
      const body = taxCalendarEntryPatchSchema.parse(req.body);
      const data = await calendars.updateEntry(ctx, calendarId, entryId, body);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.get("/api/v1/firms/:firmId/tax-calendars/:calendarId/validation", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const data = await calendars.validate(ctx, calendarId);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/tax-calendars/:calendarId/publish", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const data = await calendars.publish(ctx, calendarId);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/tax-calendars/:calendarId/create-from", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const data = await calendars.createFrom(ctx, calendarId);
      return reply.code(201).send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/tax-calendars/:calendarId/hide", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const data = await calendars.hide(ctx, calendarId);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });

  app.post("/api/v1/firms/:firmId/tax-calendars/:calendarId/show", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    try {
      const { calendarId } = req.params as { calendarId: string };
      const data = await calendars.show(ctx, calendarId);
      return reply.send({ data });
    } catch (err) {
      return handleError(app, reply, err);
    }
  });
}
