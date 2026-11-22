import { createTaxCalendarSchema, taxCalendarEntryInputSchema } from "@contable/contracts";
import { ApiError } from "../lib/api";
import { formatearPeriodo } from "../lib/formatoFechas";

/**
 * Lógica pura de la pantalla «Calendarios fiscales» (corte 2a-ii-b): tipos de
 * la API, validación con los esquemas de packages/contracts (P4: el mismo
 * mensaje al tipear y al guardar), filtros en la dirección y lectura de errores.
 */

export type CalendarStatusKey = "DRAFT" | "PUBLISHED" | "HIDDEN";
export type GroupingKind = "ENDING_DIGITS" | "ALL";
export type AdjustmentKind = "NONE" | "HOLIDAY" | "WEEKEND" | "NOTE";
export type ReviewStateKey = "PROPOSED" | "REVIEWED" | "FLAGGED";

export interface CalendarRef {
  id: string;
  code: string;
  name: string;
}

interface CalendarBase {
  id: string;
  firmId: string;
  taxAuthorityId: string;
  jurisdictionId: string;
  year: number;
  title: string;
  version: number;
  status: CalendarStatusKey;
  sourceId: string | null;
  supersedesId: string | null;
  createdByUserId: string;
  publishedByUserId: string | null;
  publishedAt: string | null;
  hiddenByUserId: string | null;
  hiddenAt: string | null;
  createdAt: string;
  updatedAt: string;
  taxAuthority: CalendarRef;
  jurisdiction: CalendarRef;
}

/** Fila de la lista (GET …/tax-calendars). */
export interface CalendarListItem extends CalendarBase {
  _count: { entries: number };
}

/** Celda de un calendario tal como la devuelve la ficha. */
export interface CalendarEntryRow {
  id: string;
  conceptLabel: string;
  taxTypeId: string | null;
  regimeId: string | null;
  groupingKind: GroupingKind;
  endingDigits: string | null;
  zoneCode: string | null;
  referencePeriodStart: string | null;
  referencePeriodEnd: string | null;
  referenceLabel: string | null;
  /** Llega como AAAA-MM-DD o como ISO completo (medianoche UTC). */
  dueDate: string;
  dueDateRaw: string | null;
  adjustment: AdjustmentKind;
  noteRef: string | null;
  noteText: string | null;
  reviewState: ReviewStateKey | null;
  /** Página del PDF fuente de la celda (null si se cargó a mano). */
  sourcePage: number | null;
  sortOrder: number;
}

/** Ficha (GET …/tax-calendars/:id): el calendario con sus celdas. */
export interface CalendarDetail extends CalendarBase {
  entries: CalendarEntryRow[];
}

export interface ValidationProblem {
  /** Campo con su índice, por ejemplo `entries[3].endingDigits`. */
  field: string;
  message: string;
  severity: "ERROR" | "ADVERTENCIA";
}

export interface ValidationReport {
  calendarId: string;
  status: CalendarStatusKey;
  entries: number;
  canPublish: boolean;
  problems: ValidationProblem[];
}

/** Respuesta de publicar y de mostrar: informa qué versión dejó de estar visible. */
export interface VisibilityResult {
  calendar: CalendarDetail;
  hiddenCalendarId: string | null;
}

export function statusLabel(status: CalendarStatusKey): string {
  if (status === "PUBLISHED") return "Publicado";
  if (status === "HIDDEN") return "Oculto";
  return "Borrador";
}

/** Día AAAA-MM-DD de un valor de fecha (también acepta ISO completo). */
export function dayOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? null;
}

export function calendarTitleLine(calendar: Pick<CalendarBase, "year" | "taxAuthority" | "jurisdiction">): string {
  return `${calendar.taxAuthority.name} · ${calendar.jurisdiction.name} · ${calendar.year}`;
}

export function scopeOf(calendar: Pick<CalendarBase, "taxAuthorityId" | "jurisdictionId" | "year">) {
  return { year: calendar.year, taxAuthorityId: calendar.taxAuthorityId, jurisdictionId: calendar.jurisdictionId };
}

/* ───────── Filtros en la dirección (C05) ───────── */

export const STATUS_FILTERS = [
  { value: "borrador", label: "Borrador", status: "DRAFT" },
  { value: "publicado", label: "Publicado", status: "PUBLISHED" },
  { value: "oculto", label: "Oculto", status: "HIDDEN" },
] as const satisfies ReadonlyArray<{ value: string; label: string; status: CalendarStatusKey }>;

export type StatusFilterValue = (typeof STATUS_FILTERS)[number]["value"];

export interface CalendarFilters {
  year: number | null;
  taxAuthorityId: string | null;
  jurisdictionId: string | null;
  statuses: StatusFilterValue[];
}

export const NO_CALENDAR_FILTERS: CalendarFilters = {
  year: null,
  taxAuthorityId: null,
  jurisdictionId: null,
  statuses: [],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_FILTER_VALUES: readonly string[] = STATUS_FILTERS.map((item) => item.value);

export function hasCalendarFilters(filters: CalendarFilters): boolean {
  return (
    filters.year !== null ||
    filters.taxAuthorityId !== null ||
    filters.jurisdictionId !== null ||
    filters.statuses.length > 0
  );
}

/** Lee los filtros de la dirección. Un valor inválido se ignora en vez de romper la lista. */
export function filtersFromParams(params: URLSearchParams): CalendarFilters {
  const anio = params.get("anio") ?? "";
  const year = /^\d{4}$/.test(anio) && Number(anio) >= 2000 && Number(anio) <= 2100 ? Number(anio) : null;
  const organismo = params.get("organismo") ?? "";
  const jurisdiccion = params.get("jurisdiccion") ?? "";
  const statuses = (params.get("estado") ?? "")
    .split(",")
    .filter((value): value is StatusFilterValue => STATUS_FILTER_VALUES.includes(value))
    .filter((value, index, all) => all.indexOf(value) === index);
  return {
    year,
    taxAuthorityId: UUID_PATTERN.test(organismo) ? organismo : null,
    jurisdictionId: UUID_PATTERN.test(jurisdiccion) ? jurisdiccion : null,
    statuses,
  };
}

/** Escribe los filtros en la dirección, conservando los demás parámetros (p. ej. el calendario abierto). */
export function paramsWithFilters(current: URLSearchParams, filters: CalendarFilters): URLSearchParams {
  const next = new URLSearchParams(current);
  const set = (key: string, value: string | null) => {
    if (value) next.set(key, value);
    else next.delete(key);
  };
  set("anio", filters.year === null ? null : String(filters.year));
  set("organismo", filters.taxAuthorityId);
  set("jurisdiccion", filters.jurisdictionId);
  set("estado", filters.statuses.length > 0 ? filters.statuses.join(",") : null);
  return next;
}

/** Query de la lista: el año, el organismo y la jurisdicción van a la API; el estado se filtra en la pantalla. */
export function scopeQuery(scope: { year: number | null; taxAuthorityId: string | null; jurisdictionId: string | null }): string {
  const params = new URLSearchParams();
  if (scope.year !== null) params.set("year", String(scope.year));
  if (scope.taxAuthorityId) params.set("taxAuthorityId", scope.taxAuthorityId);
  if (scope.jurisdictionId) params.set("jurisdictionId", scope.jurisdictionId);
  return params.toString();
}

export function applyStatusFilter(rows: readonly CalendarListItem[], statuses: readonly StatusFilterValue[]) {
  if (statuses.length === 0) return [...rows];
  const wanted = new Set(STATUS_FILTERS.filter((item) => statuses.includes(item.value)).map((item) => item.status));
  return rows.filter((row) => wanted.has(row.status));
}

export function statusFilterOf(status: CalendarStatusKey): StatusFilterValue {
  return STATUS_FILTERS.find((item) => item.status === status)?.value ?? "borrador";
}

/* ───────── Dígitos de terminación ───────── */

export const CUIT_DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/** Dígitos seleccionados en orden, como texto («0123»). Sin repetidos. */
export function sortedDigits(selected: readonly string[]): string {
  return [...new Set(selected.filter((digit) => /^[0-9]$/.test(digit)))].sort().join("");
}

export function digitsOf(endingDigits: string | null): string[] {
  return endingDigits ? [...endingDigits] : [];
}

/** Texto de un grupo de terminaciones: «0 a 3», «0 y 2», «0 a 1 y 3». */
export function digitsLabel(digits: readonly string[]): string {
  const numbers = [...new Set(digits.map(Number))].filter(Number.isInteger).sort((a, b) => a - b);
  const runs: Array<[number, number]> = [];
  for (const number of numbers) {
    const last = runs[runs.length - 1];
    if (last && number === last[1] + 1) last[1] = number;
    else runs.push([number, number]);
  }
  const parts = runs.map(([from, to]) => (from === to ? `${from}` : `${from} a ${to}`));
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

/* ───────── Celdas ───────── */

export interface CellForm {
  conceptLabel: string;
  taxTypeId: string;
  regimeId: string;
  groupingKind: GroupingKind;
  digits: string[];
  referenceLabel: string;
  referencePeriodStart: string;
  referencePeriodEnd: string;
  dueDate: string;
  dueDateRaw: string;
  adjustment: AdjustmentKind;
  noteRef: string;
  noteText: string;
}

export function emptyCellForm(): CellForm {
  return {
    conceptLabel: "",
    taxTypeId: "",
    regimeId: "",
    groupingKind: "ENDING_DIGITS",
    digits: [],
    referenceLabel: "",
    referencePeriodStart: "",
    referencePeriodEnd: "",
    dueDate: "",
    dueDateRaw: "",
    adjustment: "NONE",
    noteRef: "",
    noteText: "",
  };
}

export function cellFormFromEntry(entry: CalendarEntryRow): CellForm {
  return {
    conceptLabel: entry.conceptLabel,
    taxTypeId: entry.taxTypeId ?? "",
    regimeId: entry.regimeId ?? "",
    groupingKind: entry.groupingKind,
    digits: digitsOf(entry.endingDigits),
    referenceLabel: entry.referenceLabel ?? "",
    referencePeriodStart: dayOf(entry.referencePeriodStart) ?? "",
    referencePeriodEnd: dayOf(entry.referencePeriodEnd) ?? "",
    dueDate: dayOf(entry.dueDate) ?? "",
    dueDateRaw: entry.dueDateRaw ?? "",
    adjustment: entry.adjustment,
    noteRef: entry.noteRef ?? "",
    noteText: entry.noteText ?? "",
  };
}

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Cuerpo de alta y de edición de una celda, con la forma de los esquemas de contracts. */
export function cellPayload(form: CellForm) {
  return {
    conceptLabel: form.conceptLabel.trim(),
    taxTypeId: form.taxTypeId || null,
    regimeId: form.regimeId || null,
    groupingKind: form.groupingKind,
    endingDigits: form.groupingKind === "ENDING_DIGITS" ? nullIfBlank(sortedDigits(form.digits)) : null,
    referenceLabel: nullIfBlank(form.referenceLabel),
    referencePeriodStart: nullIfBlank(form.referencePeriodStart),
    referencePeriodEnd: nullIfBlank(form.referencePeriodEnd),
    dueDate: form.dueDate.trim(),
    dueDateRaw: nullIfBlank(form.dueDateRaw),
    adjustment: form.adjustment,
    noteRef: nullIfBlank(form.noteRef),
    noteText: nullIfBlank(form.noteText),
  };
}

interface IssueLike {
  path: ReadonlyArray<string | number>;
  message: string;
}

/** Primer mensaje de cada campo (la clave es el primer segmento de la ruta). */
function firstIssueByField(issues: readonly IssueLike[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && fields[key] === undefined) fields[key] = issue.message;
  }
  return fields;
}

/** Errores de la celda según taxCalendarEntryInputSchema, para validar al tipear. */
export function cellIssues(form: CellForm): Record<string, string> {
  const result = taxCalendarEntryInputSchema.safeParse(cellPayload(form));
  return result.success ? {} : firstIssueByField(result.error.issues);
}

export interface CalendarForm {
  taxAuthorityId: string;
  jurisdictionId: string;
  year: string;
  title: string;
}

export function emptyCalendarForm(): CalendarForm {
  return { taxAuthorityId: "", jurisdictionId: "", year: "", title: "" };
}

/** Errores del alta de calendario según createTaxCalendarSchema. */
export function calendarIssues(form: CalendarForm): Record<string, string> {
  const year = form.year.trim();
  const yearIsNumber = /^\d+$/.test(year);
  const result = createTaxCalendarSchema.safeParse({
    taxAuthorityId: form.taxAuthorityId || undefined,
    jurisdictionId: form.jurisdictionId || undefined,
    year: yearIsNumber ? Number(year) : undefined,
    title: form.title.trim(),
  });
  const fields = result.success ? {} : firstIssueByField(result.error.issues);
  if (year !== "" && !yearIsNumber) fields.year = "El año debe ser un número entero";
  return fields;
}

export function calendarPayload(form: CalendarForm) {
  return {
    taxAuthorityId: form.taxAuthorityId,
    jurisdictionId: form.jurisdictionId,
    year: Number(form.year.trim()),
    title: form.title.trim(),
  };
}

/** Clave para comparar textos: sin tildes, en minúsculas y con los espacios colapsados. */
function claveDeTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Texto del período de referencia: el rótulo y, entre paréntesis, las fechas. Si el rótulo es el
 * mismo mes que el rango («enero de 2026»), se muestra una sola vez.
 */
export function periodLabel(entry: CalendarEntryRow): string {
  const start = dayOf(entry.referencePeriodStart);
  const end = dayOf(entry.referencePeriodEnd);
  const range = start && end ? formatearPeriodo(start, end) : null;
  if (entry.referenceLabel && range) {
    if (claveDeTexto(entry.referenceLabel) === claveDeTexto(range)) return range;
    return `${entry.referenceLabel} (${range})`;
  }
  return entry.referenceLabel ?? range ?? "—";
}

export function groupingLabel(entry: CalendarEntryRow): string {
  if (entry.groupingKind === "ALL") return "Todos";
  const digits = digitsOf(entry.endingDigits);
  return digits.length > 0 ? digitsLabel(digits) : "—";
}

export function adjustmentLabel(adjustment: AdjustmentKind): string {
  if (adjustment === "HOLIDAY") return "Feriado";
  if (adjustment === "WEEKEND") return "Fin de semana";
  if (adjustment === "NOTE") return "Nota";
  return "Sin ajuste";
}

/** Estado de revisión de una celda: el rótulo lo pone quien presenta el StatusBadge. */
export function reviewStatus(state: ReviewStateKey | null): { status: string; label: string } {
  if (state === "PROPOSED") return { status: "PENDING_REVIEW", label: "Propuesta" };
  if (state === "FLAGGED") return { status: "NEEDS_REVIEW", label: "Dudosa" };
  if (state === "REVIEWED") return { status: "REVIEWED", label: "Revisada" };
  return { status: "", label: "—" };
}

/** Celda a la que apunta un problema del informe (`entries[i].campo`); null si el problema es del calendario. */
export function problemTarget(
  problem: ValidationProblem,
  entries: readonly CalendarEntryRow[],
): { entryId: string; field: string } | null {
  const match = /^entries\[(\d+)\](?:\.(\w+))?$/.exec(problem.field);
  if (!match) return null;
  const entry = entries[Number(match[1] ?? "")];
  if (!entry) return null;
  return { entryId: entry.id, field: match[2] ?? "" };
}

/** Orden de aparición de cada concepto: el agrupado de la tabla sigue el orden de la ficha. */
export function conceptOrder(entries: readonly CalendarEntryRow[]): Map<string, number> {
  const order = new Map<string, number>();
  for (const entry of entries) {
    if (!order.has(entry.conceptLabel)) order.set(entry.conceptLabel, order.size);
  }
  return order;
}

/* ───────── Errores del servidor ───────── */

export interface ServerIssues {
  /** Mensaje del servidor por campo del formulario (clave = último segmento de la ruta). */
  fields: Record<string, string>;
  message: string;
}

/**
 * Lee los dos formatos de error de la API: el de validación (details: lista de
 * {path, message}) y el del dominio (details: {path, problems}). El mensaje
 * general siempre se devuelve para mostrarlo cuando no hay campo.
 */
export function serverIssues(error: unknown): ServerIssues {
  if (!(error instanceof ApiError)) {
    return { fields: {}, message: "No se pudo completar la solicitud. Reintentá en unos minutos." };
  }
  const details = error.details?.details;
  const fields: Record<string, string> = {};
  if (Array.isArray(details)) {
    for (const issue of details) {
      const key = String(issue.path[issue.path.length - 1] ?? "");
      if (key && fields[key] === undefined) fields[key] = issue.message;
    }
  } else if (details && typeof details === "object") {
    const path = (details as { path?: unknown }).path;
    if (Array.isArray(path)) {
      const key = String(path[path.length - 1] ?? "");
      if (key) fields[key] = error.message;
    }
  }
  return { fields, message: error.message };
}

/** Una celda es dudosa cuando su revisión es «Dudosa» en `reviewStatus` (estado FLAGGED). */
export function esCeldaDudosa(entrada: Pick<CalendarEntryRow, "reviewState">): boolean {
  return entrada.reviewState === "FLAGGED";
}

/** Filas de la pestaña Celdas: con «Solo dudosas», únicamente las dudosas, en su orden (hallazgo 80). */
export function celdasVisibles<T extends Pick<CalendarEntryRow, "reviewState">>(
  entradas: readonly T[],
  soloDudosas: boolean,
): T[] {
  return soloDudosas ? entradas.filter(esCeldaDudosa) : [...entradas];
}

export function resumenCeldas(entradas: readonly Pick<CalendarEntryRow, "reviewState">[]): {
  total: number;
  dudosas: number;
} {
  return { total: entradas.length, dudosas: entradas.filter(esCeldaDudosa).length };
}

/** «1 dudosa» o «297 dudosas». */
export function textoDudosas(cantidad: number): string {
  return cantidad === 1 ? "1 dudosa" : `${cantidad} dudosas`;
}

/** Pie de la pestaña Celdas: «412 celdas · 297 dudosas». */
export function textoPieCeldas(total: number, dudosas: number): string {
  return `${total} ${total === 1 ? "celda" : "celdas"} · ${textoDudosas(dudosas)}`;
}
