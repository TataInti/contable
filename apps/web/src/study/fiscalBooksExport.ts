import {
  FISCAL_BOOK_COLUMNS,
  FISCAL_BOOK_COLUMN_KEYS,
  FISCAL_BOOK_TITLES,
  type FiscalBookColumnKey,
  type FiscalBookFormat,
  type FiscalBookKind,
  type FiscalBookSortBy,
  type FiscalBookSortDir,
} from "@contable/contracts";

/**
 * Libros de compras y ventas (corte 7b): opciones de los controles, dirección
 * de la descarga y forma del resumen que devuelve el servidor. La pantalla no
 * decide qué comprobantes entran: arma la consulta y muestra la respuesta.
 */

export const FISCAL_BOOK_KIND_OPTIONS: ReadonlyArray<{ value: FiscalBookKind; label: string }> = [
  { value: "purchases", label: FISCAL_BOOK_TITLES.purchases },
  { value: "sales", label: FISCAL_BOOK_TITLES.sales },
];

export const FISCAL_BOOK_FORMAT_OPTIONS: ReadonlyArray<{ value: FiscalBookFormat; label: string }> = [
  { value: "xlsx", label: "Excel (.xlsx)" },
  { value: "csv", label: "CSV (.csv)" },
];

export const FISCAL_BOOK_SORT_OPTIONS: ReadonlyArray<{ value: FiscalBookSortBy; label: string }> = [
  { value: "issuedOn", label: "Fecha de emisión" },
  { value: "number", label: "Número" },
  { value: "total", label: "Total" },
];

export const FISCAL_BOOK_SORT_DIR_OPTIONS: ReadonlyArray<{ value: FiscalBookSortDir; label: string }> = [
  { value: "asc", label: "Ascendente" },
  { value: "desc", label: "Descendente" },
];

/** Etiquetas de columna tomadas de FISCAL_BOOK_COLUMNS, en el orden del libro. */
export const FISCAL_BOOK_COLUMN_OPTIONS: ReadonlyArray<{ value: FiscalBookColumnKey; label: string }> =
  FISCAL_BOOK_COLUMNS.map((column) => ({ value: column.key, label: column.header }));

export const ALL_FISCAL_BOOK_COLUMNS: readonly FiscalBookColumnKey[] = FISCAL_BOOK_COLUMN_KEYS;

export interface FiscalBookExportParams {
  firmId: string;
  clientId: string;
  periodId: string;
  book: FiscalBookKind;
  format: FiscalBookFormat;
  columns: readonly FiscalBookColumnKey[];
  sortBy: FiscalBookSortBy;
  sortDir: FiscalBookSortDir;
}

/** Columnas pedidas, en el orden del libro y sin repetidas. */
export function orderFiscalBookColumns(columns: readonly FiscalBookColumnKey[]): FiscalBookColumnKey[] {
  const selected = new Set(columns);
  return FISCAL_BOOK_COLUMN_KEYS.filter((key) => selected.has(key));
}

function fiscalBooksBasePath(firmId: string, clientId: string): string {
  return `/firms/${encodeURIComponent(firmId)}/clients/${encodeURIComponent(clientId)}/fiscal-books`;
}

/** Ruta relativa a /api/v1 del resumen del período (la consulta con api.get). */
export function fiscalBooksSummaryUrl(scope: { firmId: string; clientId: string; periodId: string }): string {
  const query = new URLSearchParams({ periodId: scope.periodId });
  return `${fiscalBooksBasePath(scope.firmId, scope.clientId)}/summary?${query.toString()}`;
}

/**
 * Ruta relativa a /api/v1 de la descarga (la usa downloadFile). Siempre envía
 * `columns` con la lista explícita en orden de libro: el servidor rechaza un
 * valor vacío, así que la selección completa se pide con todas las claves.
 */
export function buildFiscalBookExportUrl(params: FiscalBookExportParams): string {
  const columns = orderFiscalBookColumns(params.columns);
  if (columns.length === 0) {
    throw new Error("Elegí al menos una columna para descargar el libro.");
  }
  const query = new URLSearchParams({
    periodId: params.periodId,
    book: params.book,
    format: params.format,
    columns: columns.join(","),
    sortBy: params.sortBy,
    sortDir: params.sortDir,
  });
  return `${fiscalBooksBasePath(params.firmId, params.clientId)}/export?${query.toString()}`;
}

/** Grupo de comprobantes excluidos de un libro, con el motivo que informa el servidor. */
export interface FiscalBookExcludedGroup {
  reason: string;
  label: string;
  count: number;
}

export interface FiscalBookSummary {
  title: string;
  included: { count: number; totals: Record<string, string> };
  excluded: FiscalBookExcludedGroup[];
  excludedCount: number;
}

export interface FiscalBooksSummary {
  period: { id: string; label: string | null; startDate: string; endDate: string };
  books: Record<FiscalBookKind, FiscalBookSummary>;
}

const AMOUNT_FORMAT = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Importe en pesos para mostrar; el valor de la API llega como texto decimal. */
export function formatFiscalAmount(value: string | undefined): string {
  const amount = Number(value ?? 0);
  return AMOUNT_FORMAT.format(Number.isFinite(amount) ? amount : 0);
}
