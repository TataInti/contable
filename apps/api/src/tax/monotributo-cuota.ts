import { Prisma } from "@prisma/client";

/**
 * Cuota fija mensual del Monotributo (corte 3F).
 *
 * El Monotributo no se liquida: se paga una cuota fija por mes según la categoría (A a K)
 * y el tipo de actividad. Este módulo tiene solo reglas puras: el mes, la vigencia de la
 * categoría, la cuota de la escala y el vencimiento. No crea liquidación ni declaración.
 */

export const MONOTRIBUTO_CATEGORIES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;
export const MONOTRIBUTO_ACTIVITIES = ["SERVICIOS", "BIENES"] as const;
export type MonotributoActivity = (typeof MONOTRIBUTO_ACTIVITIES)[number];

/** Clave de la familia de cálculo del tipo de impuesto Monotributo (catálogo de sistema). */
export const MONOTRIBUTO_FAMILY_KEY = "MONOTRIBUTO";

/** Día del mes en que vence la cuota (regla fijada en el brief del corte 3F). */
export const MONOTRIBUTO_DUE_DAY = 20;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const AMOUNT_PATTERN = /^\d{1,15}(\.\d{1,2})?$/;

/** «2026-08» → 1 de agosto de 2026 (UTC). Null si el mes no es válido. */
export function monthStartFromKey(key: string): Date | null {
  const m = MONTH_PATTERN.exec(key);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

/** Fecha «AAAA-MM-DD» (UTC) o null si no existe en el calendario. */
export function parseIsoDate(value: string): Date | null {
  const m = DATE_PATTERN.exec(value);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCFullYear() !== Number(m[1]) || date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return date;
}

/** Primer día de un mes como «AAAA-MM-DD». */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** «AAAA-MM» del primer día del mes. */
export function monthKey(monthStart: Date): string {
  return monthStart.toISOString().slice(0, 7);
}

/** Vencimiento de la cuota del mes: día fijado del mismo mes. */
export function dueDateOf(monthStart: Date): string {
  const y = monthStart.getUTCFullYear();
  const m = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-${String(MONOTRIBUTO_DUE_DAY).padStart(2, "0")}`;
}

/** Mes actual en UTC como «AAAA-MM». */
export function currentMonthKey(now: Date = new Date()): string {
  return monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

/** ¿El importe es un decimal positivo con hasta dos decimales? */
export function isPositiveAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value) && Number(value) > 0;
}

export interface CategoriaVigenteRow {
  id: string;
  validFrom: Date;
  category: string;
  activity: string;
}

/** La categoría que rige el mes: la fila con el mes de inicio más reciente que no sea posterior al mes. */
export function categoriaVigente<T extends CategoriaVigenteRow>(rows: readonly T[], monthStart: Date): T | null {
  let elegida: T | null = null;
  for (const row of rows) {
    if (row.validFrom.getTime() > monthStart.getTime()) continue;
    if (!elegida || row.validFrom.getTime() > elegida.validFrom.getTime()) elegida = row;
  }
  return elegida;
}

export interface CuotaEscalaRow {
  validFrom: Date;
  validTo: Date | null;
  category: string;
  activity: string;
  amount: Prisma.Decimal;
  source: string | null;
}

/** Cuota de la escala para una categoría y tipo, vigente en el mes. Null si la escala no la cubre. */
export function cuotaVigente<T extends CuotaEscalaRow>(
  rows: readonly T[],
  category: string,
  activity: string,
  monthStart: Date,
): T | null {
  let elegida: T | null = null;
  for (const row of rows) {
    if (row.category !== category || row.activity !== activity) continue;
    if (row.validFrom.getTime() > monthStart.getTime()) continue;
    if (row.validTo && row.validTo.getTime() < monthStart.getTime()) continue;
    if (!elegida || row.validFrom.getTime() > elegida.validFrom.getTime()) elegida = row;
  }
  return elegida;
}

export type EstadoCuota = "NO_APLICA" | "SIN_CATEGORIA" | "SIN_CUOTA" | "PENDIENTE" | "PAGADA";

/** Estado único de la cuota del mes (P1): qué está listo y qué falta. */
export function estadoCuota(input: {
  applies: boolean;
  hasCategory: boolean;
  fee: Prisma.Decimal | null;
  paid: Prisma.Decimal;
}): EstadoCuota {
  if (!input.applies) return "NO_APLICA";
  if (!input.hasCategory) return "SIN_CATEGORIA";
  if (!input.fee) return "SIN_CUOTA";
  return input.paid.greaterThanOrEqualTo(input.fee) ? "PAGADA" : "PENDIENTE";
}
