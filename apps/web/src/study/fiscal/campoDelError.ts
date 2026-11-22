import { ApiError } from "../../lib/api";

/** Campo que la API señala en un error de validación (`details.path`), para mostrar el motivo junto a él. */
export function campoDelError(error: unknown): string | null {
  const detalles = error instanceof ApiError ? error.details?.details : null;
  const ruta = detalles && typeof detalles === "object" && !Array.isArray(detalles) ? (detalles as { path?: unknown }).path : null;
  return Array.isArray(ruta) && typeof ruta[0] === "string" ? ruta[0] : null;
}
