import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import type { FastifyRequest } from "fastify";

/**
 * Ejecuta una transacción estableciendo el contexto RLS (ADR-006).
 * Cada transacción fija app.user_id, app.firm_id y app.actor_kind.
 * Las conexiones se devuelven al pool sin contexto persistente.
 */

export interface TenantContext {
  userId: string;
  firmId: string;
  clientId?: string | null;
  actorKind: "USER" | "PORTAL" | "PLATFORM_ADMIN" | "SYSTEM";
}

type Tx = Prisma.TransactionClient;

export function tenantContextFromRequest(req: FastifyRequest): TenantContext {
  if (!req.userId || !req.firmId) {
    throw Object.assign(new Error("Se requiere un contexto autenticado de estudio"), {
      statusCode: 401,
      code: "TENANT_CONTEXT_REQUIRED",
    });
  }
  return {
    userId: req.userId,
    firmId: req.firmId,
    ...(req.clientId ? { clientId: req.clientId } : {}),
    actorKind: req.isPortalRequest ? "PORTAL" : "USER",
  };
}

export async function withTenantContext<T>(
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${ctx.userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${ctx.firmId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', ${ctx.clientId ?? ""}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', ${ctx.actorKind}, true)`;
    return fn(tx);
  }, options);
}

/**
 * Transacción sin contexto de firma (para alta de firmas, auth, etc.).
 * Usa un firm_id nulo y actor por defecto; las policies de negocio lo bloquean.
 */
export async function withoutTenantContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${""}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${""}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', ${""}, true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', ${"SYSTEM"}, true)`;
    return fn(tx);
  });
}
