import { ApiError } from "../../lib/api";

/** Pasos siguientes de la pantalla de Liquidaciones (decisión de Inti, 68): qué pasó y qué hacer. */
const PASO_REINTENTAR =
  "Volvé a intentarlo en unos minutos. Si sigue igual, avisá a quien administra el estudio.";
const PASO_ACTUALIZAR =
  "Actualizá la pantalla. Si sigue igual, avisá a quien administra el estudio.";
const PASO_RECARGAR = "Actualizá la pantalla y volvé a intentarlo.";
const PASO_REVISAR = "Revisá lo indicado y volvé a intentarlo.";

/** Códigos cuyo texto aprobado escribe la API: es la única fuente y se muestra tal como llega. */
const TEXTO_DEL_SERVIDOR = new Set(["ARTIFACT_CHECKSUM_MISMATCH", "ARTIFACT_STORAGE_UNAVAILABLE"]);

function conPunto(texto: string): string {
  const limpio = texto.trim();
  return /[.!?…]$/.test(limpio) ? limpio : `${limpio}.`;
}

/**
 * Texto de un error de la pantalla de Liquidaciones. Decide por código estable y estado HTTP, nunca por el texto:
 * el detalle técnico del servidor (un error de conexión, por ejemplo) no sale al usuario.
 */
export function mensajeDeErrorDeLiquidacion(error: unknown, respaldo: string): string {
  if (!(error instanceof ApiError)) return respaldo;
  if (TEXTO_DEL_SERVIDOR.has(error.code) && error.message.trim()) return error.message;
  if (error.status === 0 || error.status >= 500) return PASO_REINTENTAR;
  const motivo = error.message.trim();
  if (error.status === 404) {
    return motivo
      ? `${conPunto(motivo)} ${PASO_ACTUALIZAR}`
      : `No encontramos lo solicitado. ${PASO_ACTUALIZAR}`;
  }
  if (error.status === 409) return motivo ? `${conPunto(motivo)} ${PASO_RECARGAR}` : PASO_RECARGAR;
  return motivo ? `${conPunto(motivo)} ${PASO_REVISAR}` : respaldo;
}
