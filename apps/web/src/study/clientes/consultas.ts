import type { FetchStatus } from "@tanstack/react-query";

/**
 * Consulta sin respuesta (Foco 5.2): pide datos o está pausada (pestaña oculta o sin conexión).
 * Mientras no responde, la pantalla no puede decir «0», «vacío» ni «no hay». Una consulta deshabilitada
 * (`enabled: false`) queda en `idle`: no entra aquí, porque nunca va a responder.
 */
export function sinRespuesta(consulta: { isPending: boolean; fetchStatus: FetchStatus }): boolean {
  return consulta.isPending && consulta.fetchStatus !== "idle";
}
