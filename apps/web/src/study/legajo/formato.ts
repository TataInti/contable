import type { WorkpaperCalculationComponent } from "./tipos";

export function formatMoney(value: string | undefined | null): string {
  const num = Number(value ?? 0);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(num);
}

/** Una sola nota cuando quien preparó el legajo también lo revisó o lo finalizó. */
/** Código con el que la determinación guarda el pedido de cambios del revisor (Foco 2.10). */
const CODIGO_PEDIDO_DE_CAMBIOS = "CHANGES_REQUESTED";

/** Un pedido de cambios se muestra bajo el estado del legajo, no en la determinación. */
export function esPedidoDeCambios(diferencia: { code: string }): boolean {
  return diferencia.code === CODIGO_PEDIDO_DE_CAMBIOS;
}

/** Mensajes de los pedidos de cambios de la determinación del legajo, en su orden. */
export function mensajesDePedidoDeCambios(
  componentes: WorkpaperCalculationComponent[] | undefined,
): string[] {
  return (componentes ?? []).flatMap((componente) =>
    (componente.settlement?.differences ?? [])
      .filter(esPedidoDeCambios)
      .map((diferencia) => diferencia.message),
  );
}

export function selfReviewNote(wp: {
  preparedByUserId?: string | null;
  reviewedByUserId?: string | null;
  finalizedByUserId?: string | null;
}): string | null {
  if (!wp.preparedByUserId) return null;
  const reviewed = wp.reviewedByUserId === wp.preparedByUserId;
  const finalized = wp.finalizedByUserId === wp.preparedByUserId;
  if (reviewed && finalized) return "Legajo revisado y finalizado por la misma persona que lo preparó.";
  if (reviewed) return "Legajo revisado por la misma persona que lo preparó.";
  if (finalized) return "Legajo finalizado por la misma persona que lo preparó.";
  return null;
}
