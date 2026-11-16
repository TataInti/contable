import {
  TAX_PANEL_DJ_STATES,
  type TaxPanelDjState,
  type TaxPanelResponsable,
  type TaxPanelRow,
} from "@contable/contracts";
import { formatearPeriodo } from "../../lib/formatoFechas";
import { RESPONSABLE_MIS, RESPONSABLE_TODOS } from "./filtros";

/** Rótulo de cada estado de legajo y DJ (D4-2). Un solo nombre en tabla, filtro e indicadores (P3). */
export const ETIQUETA_DJ: Record<TaxPanelDjState, string> = {
  SIN_LEGAJO: "Sin legajo",
  LEGAJO_EN_CURSO: "Legajo en curso",
  DJ_PENDIENTE: "DJ pendiente",
  PRESENTACION_SIN_ACUSE: "Presentación sin acuse",
  PRESENTADO: "Presentado",
};

/**
 * Estado de StatusBadge que fija el tono de cada estado de DJ. La tabla muestra punto y
 * texto (DESIGN.md, «Estados»): el tono sale de la tabla de StatusBadge y el rótulo es ETIQUETA_DJ.
 */
const TONO_DJ: Record<TaxPanelDjState, string> = {
  SIN_LEGAJO: "PENDING",
  LEGAJO_EN_CURSO: "CALCULATED",
  DJ_PENDIENTE: "PENDING",
  PRESENTACION_SIN_ACUSE: "PENDING_VERIFICATION",
  PRESENTADO: "FILED",
};

export function badgeDj(estado: TaxPanelDjState): { status: string; label: string } {
  return { status: TONO_DJ[estado], label: ETIQUETA_DJ[estado] };
}

export function opcionesEstado(): { value: string; label: string }[] {
  return TAX_PANEL_DJ_STATES.map((value) => ({ value, label: ETIQUETA_DJ[value] }));
}

/** Suma días corridos a una fecha AAAA-MM-DD (sin husos: se opera en UTC). */
export function sumarDias(iso: string, dias: number): string {
  const [anio, mes, dia] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/** «en N días» / «vencida hace N días»: días corridos desde la fecha de referencia del servidor (S4-3). */
export function textoVencimiento(dias: number | null): string | null {
  if (dias === null) return null;
  if (dias === 0) return "vence hoy";
  if (dias > 0) return dias === 1 ? "en 1 día" : `en ${dias} días`;
  const atras = -dias;
  return atras === 1 ? "vencida hace 1 día" : `vencida hace ${atras} días`;
}

export interface IndicadoresPanel {
  vencidas: number;
  semana: number;
  sinLegajo: number;
  djPendientes: number;
}

/**
 * Indicadores sobre las filas cargadas. «Vencen esta semana» = vencimiento entre hoy y los
 * 7 días siguientes. Sin vencimiento no entra en vencidas ni en la semana (plan §10).
 */
export function indicadoresDelPanel(filas: readonly TaxPanelRow[]): IndicadoresPanel {
  const indicadores: IndicadoresPanel = { vencidas: 0, semana: 0, sinLegajo: 0, djPendientes: 0 };
  for (const fila of filas) {
    if (fila.daysUntilDue !== null) {
      if (fila.daysUntilDue < 0) indicadores.vencidas += 1;
      else if (fila.daysUntilDue <= 7) indicadores.semana += 1;
    }
    if (fila.djState === "SIN_LEGAJO") indicadores.sinLegajo += 1;
    if (fila.djState === "DJ_PENDIENTE") indicadores.djPendientes += 1;
  }
  return indicadores;
}

/**
 * Columna «Responsable» (D4-5): muestra los nombres que llegan; si no hay ninguno visible,
 * la cantidad con concordancia de número. Nunca inventa nombres.
 */
export function textoResponsables(responsables: readonly TaxPanelResponsable[]): {
  texto: string;
  detalle: string | null;
} {
  if (responsables.length === 0) return { texto: "Sin responsable", detalle: null };
  const nombres = responsables.flatMap((responsable) =>
    responsable.name !== null ? [responsable.name] : [],
  );
  const sinNombre = responsables.length - nombres.length;
  if (nombres.length === 0) {
    return {
      texto: responsables.length === 1 ? "1 responsable" : `${responsables.length} responsables`,
      detalle: null,
    };
  }
  return {
    texto: sinNombre > 0 ? `${nombres.join(", ")} +${sinNombre}` : nombres.join(", "),
    detalle: sinNombre > 0 ? `${sinNombre} más sin nombre visible` : null,
  };
}

const comparar = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** Responsables con nombre visible, sin el usuario actual (ya está en «Mis obligaciones»). */
export function opcionesResponsable(
  responsables: readonly { userId: string; name: string | null }[],
  propio: string | null,
): { value: string; label: string }[] {
  return responsables
    .flatMap((responsable) =>
      responsable.name !== null && responsable.userId !== propio
        ? [{ value: responsable.userId, label: responsable.name }]
        : [],
    )
    .sort((a, b) => comparar.compare(a.label, b.label));
}

/**
 * Períodos fiscales de las filas cargadas, del más reciente al más antiguo. El rótulo sale de
 * periodStart/periodEnd (no de periodLabel, que viene en otro formato).
 */
export function periodosDeFilas(filas: readonly TaxPanelRow[]): { value: string; label: string }[] {
  const porId = new Map<string, TaxPanelRow>();
  for (const fila of filas) {
    if (!porId.has(fila.periodId)) porId.set(fila.periodId, fila);
  }
  return [...porId.values()]
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0))
    .map((fila) => ({
      value: fila.periodId,
      label: formatearPeriodo(fila.periodStart, fila.periodEnd),
    }));
}

/**
 * Si el valor de la URL no está en la lista (p. ej. un responsable sin nombre visible), lo agrega
 * con un rótulo neutro para que el selector no muestre otra opción que la elegida.
 */
export function conOpcionElegida(
  lista: readonly { value: string; label: string }[],
  valor: string,
  etiqueta: string,
): { value: string; label: string }[] {
  if (valor === "" || valor === RESPONSABLE_MIS || valor === RESPONSABLE_TODOS) return [...lista];
  if (lista.some((opcion) => opcion.value === valor)) return [...lista];
  return [{ value: valor, label: etiqueta }, ...lista];
}

export const CODIGO_DEMASIADAS_OBLIGACIONES = "TAX_PANEL_TOO_MANY_OBLIGATIONS";

/**
 * Texto de error del panel. El 422 por más de 5.000 obligaciones usa el mensaje de la API y la
 * acción de acotar el rango de vencimiento (P1). El resto se reintenta.
 */
export function errorDelPanel(error: unknown): {
  demasiadas: boolean;
  titulo: string;
  descripcion: string;
} {
  const detalle = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    message?: unknown;
  };
  const mensaje =
    typeof detalle.message === "string" && detalle.message.trim() !== "" ? detalle.message : null;
  if (detalle.code === CODIGO_DEMASIADAS_OBLIGACIONES) {
    return {
      demasiadas: true,
      titulo: "Hay demasiadas obligaciones para este filtro",
      descripcion: mensaje ?? "Acotá el rango de vencimiento o el responsable.",
    };
  }
  return {
    demasiadas: false,
    titulo: "No se pudo cargar el panel de trabajo",
    descripcion: mensaje ?? "Reintentá en unos minutos o comprobá tu conexión.",
  };
}

/**
 * Hallazgo 62: calificador único, en una línea sobre los contadores. Concuerda el número con el
 * sustantivo («Sobre 1 obligación filtrada:», «Sobre las 2 obligaciones filtradas:»).
 */
export function calificadorDelConteo(n: number, alcance: "filtradas" | "cargadas"): string {
  return n === 1
    ? `Sobre 1 obligación ${alcance === "filtradas" ? "filtrada" : "cargada"}:`
    : `Sobre las ${n} obligaciones ${alcance}:`;
}
