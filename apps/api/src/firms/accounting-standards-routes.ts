import type { FastifyInstance } from "fastify";
import {
  createAccountingStandardSchema,
  updateAccountingStandardSchema,
} from "@contable/contracts";
import { tenantContextFromRequest, withTenantContext } from "../auth/tenant.js";

/**
 * Catálogo de normas contables del estudio (decisión de producto TataInti).
 *
 * Cada estudio define sus propias normas desde Administración, como cualquier
 * otro parámetro estandarizado. No hay valores precargados ni catálogo global:
 * el alta, la edición y la activación/desactivación son siempre por estudio y
 * RLS acota cada fila a la firma del contexto.
 *
 * La ficha del cliente valida `accountingStandard` contra este catálogo
 * (clients/routes.ts): las normas desactivadas siguen siendo válidas para los
 * clientes que ya las tenían — desactivar sólo las saca del selector.
 */
export function accountingStandardRoutes(app: FastifyInstance) {
  // Listar el catálogo del estudio (activas e inactivas; el selector de la
  // ficha filtra del lado del cliente para poder conservar valores legacy).
  app.get("/api/v1/firms/:firmId/accounting-standards", async (req, reply) => {
    const ctx = tenantContextFromRequest(req);
    const rows = await withTenantContext(ctx, (tx) =>
      tx.accountingStandard.findMany({
        where: { firmId: ctx.firmId },
        orderBy: { name: "asc" },
      }),
    );
    return reply.send({ data: rows });
  });

  // Alta de norma contable
  app.post("/api/v1/firms/:firmId/accounting-standards", async (req, reply) => {
    const body = createAccountingStandardSchema.parse(req.body);
    const ctx = tenantContextFromRequest(req);
    const duplicate = await withTenantContext(ctx, (tx) =>
      tx.accountingStandard.findFirst({
        where: {
          firmId: ctx.firmId,
          name: { equals: body.name, mode: "insensitive" },
        },
        select: { id: true },
      }),
    );
    if (duplicate) {
      return reply.status(409).send({
        error: {
          code: "ACCOUNTING_STANDARD_DUPLICATE",
          message: `Ya existe la norma contable "${body.name}" en el catálogo del estudio.`,
          requestId: req.id,
        },
      });
    }
    const created = await withTenantContext(ctx, (tx) =>
      tx.accountingStandard.create({ data: { firmId: ctx.firmId, name: body.name } }),
    );
    return reply.status(201).send({ data: created });
  });

  // Edición (nombre) y activación/desactivación (isActive) de una norma
  app.patch("/api/v1/firms/:firmId/accounting-standards/:standardId", async (req, reply) => {
    const { standardId } = req.params as { standardId: string };
    const body = updateAccountingStandardSchema.parse(req.body);
    const ctx = tenantContextFromRequest(req);
    const result = await withTenantContext(ctx, async (tx) => {
      const existing = await tx.accountingStandard.findFirst({
        where: { id: standardId, firmId: ctx.firmId },
        select: { id: true, name: true },
      });
      if (!existing) return { status: "not_found" as const };
      if (body.name !== undefined && body.name !== existing.name) {
        const duplicate = await tx.accountingStandard.findFirst({
          where: {
            firmId: ctx.firmId,
            name: { equals: body.name, mode: "insensitive" },
            id: { not: existing.id },
          },
          select: { id: true },
        });
        if (duplicate) return { status: "duplicate" as const, name: body.name };
      }
      const row = await tx.accountingStandard.update({
        where: { id: existing.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      return { status: "updated" as const, row };
    });
    if (result.status === "not_found") {
      return reply.status(404).send({
        error: {
          code: "ACCOUNTING_STANDARD_NOT_FOUND",
          message: "Norma contable no encontrada en el catálogo del estudio",
          requestId: req.id,
        },
      });
    }
    if (result.status === "duplicate") {
      return reply.status(409).send({
        error: {
          code: "ACCOUNTING_STANDARD_DUPLICATE",
          message: `Ya existe la norma contable "${result.name}" en el catálogo del estudio.`,
          requestId: req.id,
        },
      });
    }
    return reply.send({ data: result.row });
  });
}
