import { TAX_PANEL_DJ_STATES } from "@contable/contracts";
import { parseEndingFilter } from "../clientes/terminacion";

/**
 * Filtros del Panel de trabajo (corte 4b). Viven en la URL, como en Clientes: la
 * vista inicial es la ausencia de criterios (S4-5). Los nombres de parámetro de la
 * URL son los de pantalla; la traducción a la API está en `rutaObligaciones`.
 */

export const RESPONSABLE_MIS = "me";
export const RESPONSABLE_TODOS = "todos";
/** Filas por página: el contrato acepta 1 a 200 (TAX_PANEL_MAX_LIMIT). */
export const PANEL_PAGE_SIZE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FiltrosPanel {
  /** «me», «todos» o el identificador de un usuario. */
  responsable: string;
  /** Dígitos de terminación de CUIT, en orden. */
  terminacion: string[];
  /** Identificador del impuesto; vacío = todos. */
  impuesto: string;
  /** Uno de los estados de DJ del contrato; vacío = todos. */
  estado: string;
  /** Identificador del período fiscal; vacío = todos. */
  periodo: string;
  /** Vencimiento desde (AAAA-MM-DD); vacío = la ventana inicial de la API. */
  desde: string;
  /** Vencimiento hasta (AAAA-MM-DD); vacío = sin tope. */
  hasta: string;
}

function esDiaReal(valor: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  return new Date(`${valor}T00:00:00Z`).toISOString().slice(0, 10) === valor;
}

function responsableDe(valor: string | null): string {
  if (valor === RESPONSABLE_TODOS || valor === RESPONSABLE_MIS) return valor;
  return valor !== null && UUID.test(valor) ? valor : RESPONSABLE_MIS;
}

function uuidDe(valor: string | null): string {
  return valor !== null && UUID.test(valor) ? valor : "";
}

function diaDe(valor: string | null): string {
  return valor !== null && esDiaReal(valor) ? valor : "";
}

function estadoDe(valor: string | null): string {
  return (TAX_PANEL_DJ_STATES as readonly string[]).includes(valor ?? "") ? (valor ?? "") : "";
}

/** Lee la URL. Un valor inválido se ignora (no llega a la API como 400 por editar la URL). */
export function leerFiltros(params: URLSearchParams): FiltrosPanel {
  return {
    responsable: responsableDe(params.get("responsable")),
    terminacion: parseEndingFilter(params.get("terminacion")),
    impuesto: uuidDe(params.get("impuesto")),
    estado: estadoDe(params.get("estado")),
    periodo: uuidDe(params.get("periodo")),
    desde: diaDe(params.get("desde")),
    hasta: diaDe(params.get("hasta")),
  };
}

/** Escribe solo los criterios que difieren de la vista inicial («Mis obligaciones» es el valor por defecto). */
export function escribirFiltros(filtros: FiltrosPanel): URLSearchParams {
  const params = new URLSearchParams();
  if (filtros.responsable !== RESPONSABLE_MIS) params.set("responsable", filtros.responsable);
  if (filtros.terminacion.length > 0) params.set("terminacion", filtros.terminacion.join(","));
  if (filtros.impuesto) params.set("impuesto", filtros.impuesto);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.periodo) params.set("periodo", filtros.periodo);
  if (filtros.desde) params.set("desde", filtros.desde);
  if (filtros.hasta) params.set("hasta", filtros.hasta);
  return params;
}

/** Hay algún criterio distinto de la vista inicial: habilita «Quitar filtros». */
export function hayFiltrosActivos(filtros: FiltrosPanel): boolean {
  return (
    filtros.responsable !== RESPONSABLE_MIS ||
    filtros.terminacion.length > 0 ||
    filtros.impuesto !== "" ||
    filtros.estado !== "" ||
    filtros.periodo !== "" ||
    filtros.desde !== "" ||
    filtros.hasta !== ""
  );
}

/** Ruta de la lectura agregada (GET …/portfolio/tax-worklist/obligations) para una página. */
export function rutaObligaciones(
  firmId: string,
  filtros: FiltrosPanel,
  pagina: { offset: number; limit: number },
): string {
  const params = new URLSearchParams();
  if (filtros.responsable !== RESPONSABLE_TODOS) params.set("responsable", filtros.responsable);
  if (filtros.terminacion.length > 0) params.set("terminacion", filtros.terminacion.join(","));
  if (filtros.impuesto) params.set("taxTypeId", filtros.impuesto);
  if (filtros.estado) params.set("estado", filtros.estado);
  if (filtros.periodo) params.set("periodId", filtros.periodo);
  if (filtros.desde) params.set("dueFrom", filtros.desde);
  if (filtros.hasta) params.set("dueTo", filtros.hasta);
  params.set("limit", String(pagina.limit));
  params.set("offset", String(pagina.offset));
  return `/firms/${firmId}/portfolio/tax-worklist/obligations?${params.toString()}`;
}

/** Hallazgo 58: mensaje del rango invertido, junto a los campos de fecha. */
export const MENSAJE_RANGO_INVERTIDO =
  "La fecha hasta tiene que ser igual o posterior a la fecha desde";

/** Vacío = sin tope. Las fechas AAAA-MM-DD se comparan como texto. */
export function esRangoValido(desde: string, hasta: string): boolean {
  return desde === "" || hasta === "" || desde <= hasta;
}
