/**
 * Días hábiles para los avisos de vencimiento (corte 3a).
 *
 * Puro: sin reloj, sin HTTP y sin zona horaria del proceso. Las fechas se
 * pasan como AAAA-MM-DD (calendario) y la aritmética se hace en UTC, así que el
 * resultado no depende de la variable TZ del servidor.
 *
 * Criterio único de día hábil: no es sábado ni domingo y no figura en la lista
 * de feriados que recibe. El llamador filtra los feriados por jurisdicción
 * (nacionales más los del régimen; plan de corte 3, C-8).
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Feriados como conjunto o como arreglo de fechas AAAA-MM-DD. */
export type HolidayCalendar = ReadonlySet<string> | readonly string[];

/** La fecha no es AAAA-MM-DD o no existe en el calendario (p. ej. 2026-02-30). */
export class InvalidIsoDateError extends Error {
  readonly value: string;

  constructor(value: string) {
    super(`Fecha inválida «${value}»: se espera AAAA-MM-DD de calendario.`);
    this.name = "InvalidIsoDateError";
    this.value = value;
  }
}

/** desde es posterior a hasta. El llamador lo trata como «vencida antes de contar» (SINT-11). */
export class InvertedIntervalError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Intervalo inválido: desde ${from} es posterior a hasta ${to}.`);
    this.name = "InvertedIntervalError";
    this.from = from;
    this.to = to;
  }
}

/** Milisegundos UTC a medianoche de una fecha AAAA-MM-DD real; lanza si no lo es. */
function parseIsoUtc(iso: string): number {
  const partes = ISO_DATE_PATTERN.exec(iso);
  if (partes === null) throw new InvalidIsoDateError(iso);
  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const ms = Date.UTC(anio, mes - 1, dia);
  const fecha = new Date(ms);
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new InvalidIsoDateError(iso);
  }
  return ms;
}

/** AAAA-MM-DD de un instante UTC a medianoche. */
function formatIsoUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Día hábil en un instante UTC a medianoche; los feriados ya están en un conjunto. */
function isBusinessMillis(ms: number, feriados: ReadonlySet<string>): boolean {
  const diaDeSemana = new Date(ms).getUTCDay(); // 0 = domingo, 6 = sábado
  if (diaDeSemana === 0 || diaDeSemana === 6) return false;
  return !feriados.has(formatIsoUtc(ms));
}

/**
 * true si dateIso es día hábil: no es sábado, domingo ni feriado.
 * Lanza InvalidIsoDateError si la fecha no es AAAA-MM-DD de calendario.
 */
export function isBusinessDay(dateIso: string, holidays: HolidayCalendar = []): boolean {
  return isBusinessMillis(parseIsoUtc(dateIso), new Set(holidays));
}

/**
 * Cuenta los días hábiles del intervalo (desde, hasta]: desde no cuenta y hasta sí.
 * Si desde y hasta son el mismo día, devuelve 0 («vence hoy»).
 * Si desde es posterior a hasta, lanza InvertedIntervalError.
 */
export function businessDaysUntil(
  fromIso: string,
  toIso: string,
  holidays: HolidayCalendar = [],
): number {
  const desde = parseIsoUtc(fromIso);
  const hasta = parseIsoUtc(toIso);
  if (desde > hasta) throw new InvertedIntervalError(fromIso, toIso);
  const feriados = new Set(holidays);
  let habiles = 0;
  for (let ms = desde + MS_PER_DAY; ms <= hasta; ms += MS_PER_DAY) {
    if (isBusinessMillis(ms, feriados)) habiles += 1;
  }
  return habiles;
}
