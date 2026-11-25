import type { CoberturaLegajo } from "./tipos";

type Fuente = Pick<CoberturaLegajo["sources"][number], "required" | "present" | "status"> & { code?: string };

// Tablas manuales por actividad que el libro de ventas revisado reemplaza (satisfiedBy en el servidor).
const CODIGOS_BASE_MANUAL = new Set(["DGR_IIBB_TUC", "SMT_TEM"]);
const CODIGO_VENTAS = "ARCA_IVA_SALES";

const sinCubrir = (fuente: Fuente) => fuente.required && !fuente.present && fuente.status !== "NO_MOVEMENTS";

/**
 * Fuentes que realmente hay que cargar para calcular. Mientras falten las ventas, las tablas manuales de
 * Ingresos Brutos y TEM son opcionales: la base sale del libro de ventas, que es lo único que se pide primero.
 */
export function fuentesFaltantes<T extends Fuente>(fuentes: readonly T[]): T[] {
  const faltantes = fuentes.filter(sinCubrir);
  if (!faltantes.some((fuente) => fuente.code === CODIGO_VENTAS)) return faltantes;
  return faltantes.filter((fuente) => !(fuente.code !== undefined && CODIGOS_BASE_MANUAL.has(fuente.code)));
}

export function esOpcionalPorVentas(fuente: Fuente, fuentes: readonly Fuente[]): boolean {
  return sinCubrir(fuente) && !fuentesFaltantes(fuentes).includes(fuente);
}

/** «Falta 1: Ventas del período» / «Faltan 2: A, B». */
export function textoFaltantes(nombres: readonly string[]): string {
  return `${nombres.length === 1 ? "Falta" : "Faltan"} ${nombres.length}: ${nombres.join(", ")}`;
}
