/**
 * Calendario fiscal determinista (G1-10).
 *
 * Genera vencimientos a partir de reglas de vencimiento (DueDateRule) y
 * feriados. Puro: sin reloj global ni HTTP; las fechas se pasan como
 * argumentos.
 */

import { isBusinessDay } from "./business-days.js";

/** Frecuencias del motor: la misma lista que DUE_DATE_FREQUENCIES de packages/contracts (prueba en apps/api/src/tax). */
export type DueDateFrequency = "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE";

export interface DueDateRuleInput {
  id: string;
  /** Frecuencia. calculateDueDate no la lee; periodsForRange sí, y falla ante un valor fuera de la lista. */
  frequency?: DueDateFrequency;
  /** Día del vencimiento (1-31). */
  dueDay: number;
  /** Meses posteriores al cierre del período. Mensuales: normalmente 1. */
  monthOffset?: number;
  /** Terminación de CUIT (p.ej. "5") si aplica calendario por terminación. */
  cuitEnding?: string;
  validFrom: string;
  validTo?: string;
}

/** Alias para legibilidad en los métodos de cálculo. */
export type DueDateRule = DueDateRuleInput;

export interface HolidayInput {
  jurisdictionId: string;
  date: string;
}

export interface DueDateParams {
  /** Cliente de ejemplo: CUIT para terminación. */
  cuitEnding?: string;
  /** Jurisdicción del vencimiento. */
  jurisdictionId: string;
  /** Período fiscal a liquidar (p.ej. 2026-01). */
  period: string; // "YYYY-MM"
}

/**
 * Devuelve la fecha del vencimiento sin ajuste por feriado.
 * Si cae en fin de semana, se corre al día hábil siguiente (regla base;
 * cada rule pack puede sobreescribir con Holidays).
 */
export function rawDueDate(
  rule: DueDateRule,
  param: { periodMonth: number; periodYear: number },
): string {
  const lastDay = new Date(Date.UTC(param.periodYear, param.periodMonth, 0)).getUTCDate();
  const day = Math.min(rule.dueDay, lastDay);
  return formatIso(param.periodYear, param.periodMonth, day);
}

/** Suma días hábiles salteando sábados y domingos. */
export function nextBusinessDay(iso: string, holidays: readonly string[] = []): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  while (true) {
    const iso2 = formatIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    if (isBusinessDay(iso2, holidays)) return iso2;
    date.setUTCDate(date.getUTCDate() + 1);
  }
}

export function formatIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface DueDateResult {
  /** Fecha límite (YYYY-MM-DD). */
  dueDate: string;
  /** true si se corrió por fin de semana o feriado. */
  adjusted: boolean;
  /** Fecha original antes del ajuste. */
  rawDate: string;
}

/**
 * Calcula el vencimiento para un período usando la regla y los feriados.
 */
export function calculateDueDate(
  rule: DueDateRule,
  period: { startDate: string; endDate: string },
  holidays: readonly HolidayInput[],
  cuitEnding?: string,
): DueDateResult {
  // Terminación de CUIT: la regla aplica sólo si coincide.
  if (rule.cuitEnding && cuitEnding && rule.cuitEnding !== cuitEnding) {
    // La regla no aplica a este contribuyente; devolver sin ajuste (inválido
    // — el llamador debe usar otra regla o marcar NO_APPLICABLE).
    throw new Error(
      `La regla de vencimiento (terminación ${rule.cuitEnding}) no aplica al CUIT ${cuitEnding}`,
    );
  }

  const endParts = period.endDate.split("-").map(Number) as [number, number, number];
  const monthOffset = rule.monthOffset ?? 1;
  if (!Number.isInteger(monthOffset) || monthOffset < 0) {
    throw new Error("El desplazamiento mensual de la regla de vencimiento debe ser un entero no negativo");
  }
  const dueMonth = new Date(Date.UTC(endParts[0], endParts[1] - 1 + monthOffset, 1));

  // El vencimiento se calcula sobre el día hábil siguiente al día del
  // calendario indicado por dueDay.
  const raw = rawDueDate(rule, {
    periodYear: dueMonth.getUTCFullYear(),
    periodMonth: dueMonth.getUTCMonth() + 1,
  });

  const jurisdictionHolidays = holidays
    .filter((h) => h.date >= period.startDate)
    .map((h) => h.date);
  const dueDate = nextBusinessDay(raw, jurisdictionHolidays);
  return {
    dueDate,
    adjusted: dueDate !== raw,
    rawDate: raw,
  };
}

/** Meses entre períodos. Un valor fuera de la lista falla: no se cuenta como anual (D-R3-A). */
function stepMonths(frequency: DueDateFrequency): number {
  switch (frequency) {
    case "MONTHLY":
      return 1;
    case "QUARTERLY":
      return 3;
    case "ANNUAL":
      return 12;
    case "ONCE":
      return 0; // ONCE devuelve un único período antes de llegar aquí.
    default:
      throw new Error(`Frecuencia de vencimiento no válida: ${String(frequency)}`);
  }
}

/**
 * Genera la secuencia de períodos para una frecuencia.
 */
export function periodsForRange(
  frequency: DueDateFrequency,
  start: string,
  end: string,
): Array<{ startDate: string; endDate: string }> {
  const [sy, sm] = start.split("-").map(Number) as [number, number];
  const out: Array<{ startDate: string; endDate: string }> = [];

  if (frequency === "ONCE") {
    out.push({ startDate: start, endDate: end });
    return out;
  }

  const step = stepMonths(frequency);
  let y = sy;
  let m = sm;
  while (true) {
    const monthEnd = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const startDate = formatIso(y, m, 1);
    const endDate = formatIso(y, m, monthEnd);
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    if (ym > end) break;
    out.push({ startDate, endDate });
    if (frequency === "ANNUAL") break;
    m += step;
    if (m > 12) {
      m -= 12;
      y += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------
 * Calendarios fiscales (corte 2a-i): validación de cobertura por
 * terminación de CUIT y resolución del vencimiento de una obligación.
 * Puro: las fechas llegan como YYYY-MM-DD y no se consulta la base.
 * ------------------------------------------------------------------ */

export type TaxCalendarGroupingKind = "ENDING_DIGITS" | "ALL" | "ZONE";
export type TaxCalendarReviewState = "PROPOSED" | "REVIEWED" | "FLAGGED";
export type TaxCalendarAdjustmentKind = "NONE" | "HOLIDAY" | "WEEKEND" | "NOTE";
export type TaxCalendarStatusKind = "DRAFT" | "PUBLISHED" | "HIDDEN";

/** Celda tal como se valida antes de publicar. */
export interface CalendarCoverageEntry {
  conceptLabel: string;
  regimeId?: string | null;
  taxTypeId?: string | null;
  groupingKind: TaxCalendarGroupingKind;
  endingDigits?: string | null;
  zoneCode?: string | null;
  referencePeriodStart?: string | null;
  referencePeriodEnd?: string | null;
  referenceLabel?: string | null;
  dueDate: string;
  adjustment?: TaxCalendarAdjustmentKind | null;
  reviewState?: TaxCalendarReviewState | null;
}

export interface CalendarCoverageContext {
  /** Año del calendario: si se informa, los vencimientos deben caer en él (ver allowedDueYears). */
  year?: number;
  /** Feriados (YYYY-MM-DD) para la advertencia por vencimiento en feriado sin ajuste. */
  holidays?: readonly string[];
}

export type CalendarProblemSeverity = "ERROR" | "ADVERTENCIA";

export interface CalendarProblem {
  /** Campo con su índice, p. ej. entries[3].endingDigits. */
  field: string;
  /** Motivo en castellano. */
  message: string;
  severity: CalendarProblemSeverity;
}

export interface CalendarCoverageReport {
  /** Falso si hay algún ERROR. Las advertencias no bloquean la publicación. */
  canPublish: boolean;
  problems: CalendarProblem[];
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha YYYY-MM-DD real (rechaza, por ejemplo, 2026-02-30). */
export function isValidIsoDate(value: string | null | undefined): value is string {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function yearOfIso(iso: string): number {
  return Number(iso.slice(0, 4));
}

function weekdayOfIso(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function spanishList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

function cellLabel(entry: CalendarCoverageEntry): string {
  const concept = entry.conceptLabel.trim() || "(sin concepto)";
  const period = entry.referenceLabel?.trim() || entry.referencePeriodStart?.slice(0, 7) || "sin período de referencia";
  return `${concept} (${period})`;
}

/** Filas que compiten por los mismos dígitos: mismo concepto, régimen y período de referencia. */
function coverageGroupKey(entry: CalendarCoverageEntry): string {
  return [
    entry.conceptLabel.trim(),
    entry.regimeId ?? "",
    entry.referencePeriodStart ?? "",
    entry.referencePeriodEnd ?? "",
  ].join("|");
}

/**
 * Años en los que puede caer el vencimiento de una celda. Una celda con período
 * de otro año (p. ej. el anticipo de diciembre que vence en enero) puede vencer
 * en el año del calendario o en el siguiente. Una DDJJ anual (período que
 * termina en diciembre del año del calendario) puede vencer en el año siguiente.
 */
function allowedDueYears(year: number, referencePeriodEnd: string): number[] {
  const referenceYear = yearOfIso(referencePeriodEnd);
  if (referenceYear < year) return [year, year + 1];
  if (referenceYear === year && referencePeriodEnd.slice(5, 7) === "12") return [year, year + 1];
  return [year];
}

/**
 * Valida un calendario antes de publicarlo: cobertura exacta de terminaciones
 * (0 a 9, sin faltantes ni repetidos por concepto, régimen y período), fechas
 * válidas, celdas sin revisar y años de vencimiento. Devuelve un informe con
 * campo y motivo en castellano (P4) y lo que falta (P1).
 */
export function validateCalendarCoverage(
  entries: readonly CalendarCoverageEntry[],
  context: CalendarCoverageContext = {},
): CalendarCoverageReport {
  const problems: CalendarProblem[] = [];
  const holidays = new Set(context.holidays ?? []);
  const error = (field: string, message: string) => problems.push({ field, message, severity: "ERROR" });
  const warning = (field: string, message: string) => problems.push({ field, message, severity: "ADVERTENCIA" });

  if (entries.length === 0) {
    error("entries", "El calendario no tiene celdas: cargá al menos un vencimiento");
    return { canPublish: false, problems };
  }

  entries.forEach((entry, index) => {
    const at = (field: string) => `entries[${index}].${field}`;
    const label = cellLabel(entry);

    if (entry.conceptLabel.trim() === "") error(at("conceptLabel"), "Falta el concepto de la celda");
    if (entry.groupingKind === "ZONE") {
      error(at("groupingKind"), `${label}: las zonas están reservadas y todavía no se cargan`);
    }
    if (entry.reviewState === "PROPOSED") {
      error(at("reviewState"), `${label}: la celda está PROPOSED; revisala antes de publicar`);
    }
    if (entry.reviewState === "FLAGGED") {
      error(at("reviewState"), `${label}: la celda está marcada como dudosa (FLAGGED); resolvé la duda antes de publicar`);
    }

    const referenceValid = isValidIsoDate(entry.referencePeriodStart) && isValidIsoDate(entry.referencePeriodEnd);
    if (!referenceValid) {
      error(at("referencePeriodStart"), `${label}: falta el período de referencia (desde y hasta, AAAA-MM-DD)`);
    } else if (entry.referencePeriodStart! > entry.referencePeriodEnd!) {
      error(at("referencePeriodEnd"), `${label}: el período de referencia termina antes de empezar`);
    }

    if (!isValidIsoDate(entry.dueDate)) {
      error(at("dueDate"), `${label}: la fecha de vencimiento no es válida (usá AAAA-MM-DD)`);
      return;
    }

    if (context.year !== undefined) {
      const allowed = referenceValid
        ? allowedDueYears(context.year, entry.referencePeriodEnd!)
        : [context.year];
      if (!allowed.includes(yearOfIso(entry.dueDate))) {
        error(
          at("dueDate"),
          `${label}: el vencimiento ${entry.dueDate} cae fuera del año del calendario (${context.year})`,
        );
      }
    }

    const adjusted = entry.adjustment !== undefined && entry.adjustment !== null && entry.adjustment !== "NONE";
    if (!adjusted) {
      const weekday = weekdayOfIso(entry.dueDate);
      if (weekday === 0 || weekday === 6) {
        warning(
          at("dueDate"),
          `${label}: el vencimiento cae en ${weekday === 6 ? "sábado" : "domingo"} y no tiene ajuste informado`,
        );
      } else if (holidays.has(entry.dueDate)) {
        warning(at("dueDate"), `${label}: el vencimiento cae en feriado y no tiene ajuste informado`);
      }
    }
  });

  const groups = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const key = coverageGroupKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });

  for (const indexes of groups.values()) {
    const firstIndex = indexes[0]!;
    const label = cellLabel(entries[firstIndex]!);
    const allRows = indexes.filter((i) => entries[i]!.groupingKind === "ALL");
    const digitRows = indexes.filter((i) => entries[i]!.groupingKind === "ENDING_DIGITS");

    if (allRows.length > 1) {
      error(`entries[${allRows[1]}].groupingKind`, `${label}: «todos» aparece más de una vez en el mismo concepto y período`);
    }
    if (allRows.length > 0 && digitRows.length > 0) {
      error(
        `entries[${firstIndex}].groupingKind`,
        `${label}: mezcla «todos» con terminaciones en el mismo concepto y período`,
      );
    }
    if (digitRows.length === 0) continue;

    const owner = new Map<number, number>();
    for (const i of digitRows) {
      const raw = entries[i]!.endingDigits ?? "";
      if (!/^[0-9]+$/.test(raw)) {
        error(`entries[${i}].endingDigits`, `${cellLabel(entries[i]!)}: faltan las terminaciones de la fila`);
        continue;
      }
      const inRow = new Set<string>();
      for (const character of raw) {
        const digit = Number(character);
        if (inRow.has(character)) {
          error(`entries[${i}].endingDigits`, `${label}: el dígito ${digit} aparece dos veces en la misma fila`);
          continue;
        }
        inRow.add(character);
        const previous = owner.get(digit);
        if (previous !== undefined) {
          error(
            `entries[${i}].endingDigits`,
            `${label}: el dígito ${digit} aparece en dos filas (entries[${previous}] y entries[${i}])`,
          );
        } else {
          owner.set(digit, i);
        }
      }
    }

    const missing = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((digit) => !owner.has(digit)).map(String);
    if (missing.length > 0) {
      const noun = missing.length === 1 ? "falta el dígito" : "faltan los dígitos";
      error(`entries[${firstIndex}].endingDigits`, `${label}: ${noun} ${spanishList(missing)}`);
    }
  }

  return { canPublish: problems.every((problem) => problem.severity !== "ERROR"), problems };
}

/** Celda de un calendario publicado, con lo necesario para resolver un vencimiento. */
export interface ResolvableDueDateEntry {
  id: string;
  regimeId: string | null;
  taxTypeId: string | null;
  groupingKind: TaxCalendarGroupingKind;
  endingDigits: string | null;
  referencePeriodStart: string | null;
  referencePeriodEnd: string | null;
  dueDate: string;
}

export interface ResolvableDueDateCalendar {
  id: string;
  status: TaxCalendarStatusKind;
  taxAuthorityId: string;
  jurisdictionId: string;
  year: number;
  entries: readonly ResolvableDueDateEntry[];
}

export interface DueDateResolutionInput {
  /** CUIT del cliente: se usa su último dígito (terminación). */
  cuit: string;
  regime: {
    id: string;
    name: string;
    taxTypeId: string;
    jurisdictionId: string;
    authorityId: string;
    authorityName: string;
  };
  /** Período de la obligación (YYYY-MM-DD). */
  period: { startDate: string; endDate: string };
  calendars: readonly ResolvableDueDateCalendar[];
  /** Valor manual de la obligación: gana sobre el calendario (D-C2). */
  override?: { dueDate: string; reason: string } | null;
}

export type DueDateResolution =
  | { source: "MANUAL"; dueDate: string; calendarId: null; entryId: null }
  | { source: "CALENDAR"; dueDate: string; calendarId: string; entryId: string }
  | {
      source: null;
      dueDate: null;
      calendarId: null;
      entryId: null;
      reason: "SIN_CALENDARIO" | "SIN_CELDA";
      message: string;
    };

function entryMatchesRegime(entry: ResolvableDueDateEntry, regime: DueDateResolutionInput["regime"]): boolean {
  // La celda con régimen se vincula por id. Sin régimen, por tipo de impuesto
  // (la jurisdicción ya filtró el calendario).
  if (entry.regimeId) return entry.regimeId === regime.id;
  return entry.taxTypeId === regime.taxTypeId;
}

function entryCoversDigit(entry: ResolvableDueDateEntry, digit: string): boolean {
  if (entry.groupingKind === "ALL") return true;
  if (entry.groupingKind === "ENDING_DIGITS") return (entry.endingDigits ?? "").includes(digit);
  return false; // ZONE: reservado, no resuelve en este corte.
}

/**
 * Resuelve la fecha de vencimiento de una obligación según la precedencia de
 * D-C2: valor manual > calendario publicado > (la regla la aplica el llamador) >
 * sin fecha. Solo considera calendarios PUBLISHED del mismo organismo y
 * jurisdicción, del año del período o del siguiente, con el período de referencia
 * exacto. Más de una celda que coincida es un error interno: la validación de
 * cobertura debe impedirlo.
 */
export function resolveDueDate(input: DueDateResolutionInput): DueDateResolution {
  if (input.override) {
    return { source: "MANUAL", dueDate: input.override.dueDate, calendarId: null, entryId: null };
  }

  const digit = input.cuit.replace(/\D/g, "").slice(-1);
  if (digit === "") {
    throw new Error("No se puede resolver el vencimiento: el CUIT no tiene dígitos");
  }

  const periodYear = yearOfIso(input.period.startDate);
  const candidates = input.calendars.filter(
    (calendar) =>
      calendar.status === "PUBLISHED" &&
      calendar.taxAuthorityId === input.regime.authorityId &&
      calendar.jurisdictionId === input.regime.jurisdictionId &&
      (calendar.year === periodYear || calendar.year === periodYear + 1),
  );
  if (candidates.length === 0) {
    return {
      source: null,
      dueDate: null,
      calendarId: null,
      entryId: null,
      reason: "SIN_CALENDARIO",
      message: `Falta cargar el calendario de ${input.regime.authorityName} para ${periodYear}`,
    };
  }

  const matches: Array<{ calendarId: string; entryId: string; dueDate: string }> = [];
  for (const calendar of candidates) {
    for (const entry of calendar.entries) {
      if (!entryMatchesRegime(entry, input.regime)) continue;
      if (entry.referencePeriodStart !== input.period.startDate) continue;
      if (entry.referencePeriodEnd !== input.period.endDate) continue;
      if (!entryCoversDigit(entry, digit)) continue;
      matches.push({ calendarId: calendar.id, entryId: entry.id, dueDate: entry.dueDate });
    }
  }

  if (matches.length === 0) {
    return {
      source: null,
      dueDate: null,
      calendarId: null,
      entryId: null,
      reason: "SIN_CELDA",
      message:
        `El calendario de ${input.regime.authorityName} para ${periodYear} no tiene una celda para ` +
        `${input.regime.name}, el período ${input.period.startDate.slice(0, 7)} y la terminación ${digit}`,
    };
  }
  if (matches.length > 1) {
    throw new Error(
      `CALENDAR_AMBIGUOUS: ${matches.length} celdas coinciden con el mismo vencimiento; la validación de cobertura debe impedirlo`,
    );
  }
  const [only] = matches;
  return { source: "CALENDAR", dueDate: only!.dueDate, calendarId: only!.calendarId, entryId: only!.entryId };
}
