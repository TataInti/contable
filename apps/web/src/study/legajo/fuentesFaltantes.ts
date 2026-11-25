import type { CoberturaLegajo } from "./tipos";

type Fuente = Pick<CoberturaLegajo["sources"][number], "required" | "present" | "status"> & { code?: string; satisfiedBy?: readonly string[] };

const sinCubrir = (fuente: Fuente) => fuente.required && !fuente.present && fuente.status !== "NO_MOVEMENTS";

/**
 * Fuentes que realmente hay que cargar para calcular. Si una fuente declara (satisfiedBy, que viene de la API)
 * que otra la cubre y esa otra todavía falta, la primera es opcional: se pide primero la que la cubre.
 */
export function fuentesFaltantes<T extends Fuente>(fuentes: readonly T[]): T[] {
  const faltantes = fuentes.filter(sinCubrir);
  const codigosFaltantes = new Set(faltantes.flatMap((fuente) => (fuente.code === undefined ? [] : [fuente.code])));
  return faltantes.filter((fuente) => !(fuente.satisfiedBy ?? []).some((codigo) => codigosFaltantes.has(codigo)));
}

export function esOpcionalPorVentas(fuente: Fuente, fuentes: readonly Fuente[]): boolean {
  return sinCubrir(fuente) && !fuentesFaltantes(fuentes).includes(fuente);
}

/** «Falta 1: Ventas del período» / «Faltan 2: A, B». */
export function textoFaltantes(nombres: readonly string[]): string {
  return `${nombres.length === 1 ? "Falta" : "Faltan"} ${nombres.length}: ${nombres.join(", ")}`;
}
