import type { TenantContext } from "./tenant.js";

/**
 * Alcance por cliente de la ruta (corte C1 de seguridad, hallazgo 7 del plan S-0).
 *
 * Una ruta /clients/:clientId/... pasa la guardia porque la persona puede operar ese cliente,
 * pero la guardia no sabe a qué cliente pertenece el recurso que la ruta nombra por id, y la RLS
 * de varias tablas solo mira el estudio. Todo cargador por id de una ruta con cliente en la URL
 * arma su `where` con `clientScope(ctx)` y, si no encuentra la fila, lanza `NotFoundInClientError`:
 * el mismo error y el mismo texto si el recurso no existe o es de otro cliente (no revela cuál).
 * Las rutas sin cliente en la URL no usan esta pieza.
 */
export interface ClientScope {
  firmId: string;
  clientId: string;
}

/** Textos de «no encontrado en este cliente», uno por recurso y todos en este lugar. */
export const NOT_FOUND_IN_CLIENT_MESSAGES = {
  asiento:
    "No encontramos el asiento en este cliente. Abrilo desde la ficha del cliente donde está.",
} as const;

export type ClientScopedResource = keyof typeof NOT_FOUND_IN_CLIENT_MESSAGES;

/** El único error «no encontrado en este cliente»: 404 con el código que ya usa la guardia. */
export class NotFoundInClientError extends Error {
  readonly statusCode = 404;
  readonly code = "RESOURCE_NOT_FOUND";

  constructor(resource: ClientScopedResource) {
    super(NOT_FOUND_IN_CLIENT_MESSAGES[resource]);
    this.name = "NotFoundInClientError";
  }
}

/**
 * Estudio y cliente de la ruta, para spread en el `where` de un cargador por id.
 * Sin cliente en el contexto no hay alcance: falla en lugar de abrirse a todo el estudio.
 */
export function clientScope(ctx: TenantContext): ClientScope {
  if (!ctx.clientId) {
    throw new Error("El alcance por cliente requiere el cliente de la ruta en el contexto");
  }
  return { firmId: ctx.firmId, clientId: ctx.clientId };
}
