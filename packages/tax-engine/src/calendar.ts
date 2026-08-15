/**
 * Calendario fiscal determinista (G1-10).
 *
 * Genera vencimientos a partir de reglas de vencimiento (DueDateRule) y
 * feriados. Puro: sin reloj global ni HTTP; las fechas se pasan como
 * argumentos.
 */

export interface DueDateRuleInput {
  id: string;
  /** Frecuencia: MONTHLY, QUARTERLY, ANNUAL, ONCE. */
  frequency: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE";
  /** Día del vencimiento (1-31). */
  dueDay: number;
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
    const day = date.getUTCDay(); // 0=Sun,6=Sat
    const iso2 = formatIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    if (day !== 0 && day !== 6 && !holidays.includes(iso2)) return iso2;
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

  // El vencimiento se calcula sobre el día hábil siguiente al día del
  // calendario indicado por dueDay.
  const raw = rawDueDate(rule, {
    periodYear: endParts[0],
    periodMonth: endParts[1],
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

/**
 * Genera la secuencia de períodos para una frecuencia.
 */
export function periodsForRange(
  frequency: "MONTHLY" | "QUARTERLY" | "ANNUAL" | "ONCE",
  start: string,
  end: string,
): Array<{ startDate: string; endDate: string }> {
  const [sy, sm] = start.split("-").map(Number) as [number, number];
  const out: Array<{ startDate: string; endDate: string }> = [];

  if (frequency === "ONCE") {
    out.push({ startDate: start, endDate: end });
    return out;
  }

  const step = frequency === "MONTHLY" ? 1 : frequency === "QUARTERLY" ? 3 : 12;
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