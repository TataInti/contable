// Esqueleto del corte 3a: se escribe antes de la implementación para que las
// pruebas corran en rojo. Lo reemplaza la implementación del commit siguiente.

export type HolidayCalendar = ReadonlySet<string> | readonly string[];

export class InvalidIsoDateError extends Error {}

export class InvertedIntervalError extends Error {}

export function isBusinessDay(_dateIso: string, _holidays: HolidayCalendar = []): boolean {
  throw new Error("isBusinessDay: pendiente de implementación");
}

export function businessDaysUntil(
  _fromIso: string,
  _toIso: string,
  _holidays: HolidayCalendar = [],
): number {
  throw new Error("businessDaysUntil: pendiente de implementación");
}
