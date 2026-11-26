import type { CoberturaLegajo } from "./tipos";

type FuenteNombrable = Pick<CoberturaLegajo["sources"][number], "origin" | "label" | "expectedColumns">;

/** Nombre de la fuente para el estudio: dice qué se carga, no solo el impuesto. */
export function nombreFuente(source: FuenteNombrable): string {
  if (source.origin === "ARCA") {
    return source.expectedColumns.includes("nonTaxed") ? "Ventas del período" : "Compras del período";
  }
  if (source.origin === "DGR_RPI_TUC") return "Retenciones y percepciones IIBB Tucumán";
  if (source.origin === "DGR_IIBB") return "Base por actividad (IIBB Tucumán)";
  if (source.origin === "SMT_TEM") return "Base por actividad (TEM San Miguel)";
  return source.label;
}

/** Una línea que explica para qué sirve la tabla de base por actividad (carga manual). */
export function explicacionFuente(source: Pick<CoberturaLegajo["sources"][number], "origin">): string | null {
  return source.origin === "DGR_IIBB" || source.origin === "SMT_TEM"
    ? "Tabla que se carga a mano con el ingreso, la alícuota y el mínimo de cada actividad. Si cargás las ventas del período, no hace falta."
    : null;
}
