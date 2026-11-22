import { formatearMes } from "../../lib/formatoFechas";
import type { TaxRegistration } from "./utilidades";

const ZONA_HORARIA = "America/Argentina/Buenos_Aires";
const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Primer día del mes anterior (AAAA-MM-DD), con el día calendario de Argentina: es el mes que se liquida
 * normalmente, así que la inscripción nueva propone empezar ahí.
 */
export function primerDiaMesAnterior(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit" }).formatToParts(ahora);
  const anio = Number(partes.find((parte) => parte.type === "year")?.value);
  const mes = Number(partes.find((parte) => parte.type === "month")?.value);
  return new Date(Date.UTC(anio, mes - 2, 1)).toISOString().slice(0, 10);
}

/** «1 de octubre de 2026»: el día elegido en letras, sin ambigüedad con el formato del navegador. Vacío si no hay fecha. */
export function fechaLarga(iso: string | null | undefined): string {
  const partes = FECHA_ISO.exec(iso ?? "");
  return partes ? `${Number(partes[3])} de ${formatearMes(iso)}` : "";
}

/** «Octubre de 2026» a partir de AAAA-MM. Vacío si no hay mes. */
export function mesLegible(mes: string | null | undefined): string {
  const texto = formatearMes(mes ?? "", "");
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : "";
}

/** Inscripciones vigentes que empiezan después del último día del mes (AAAA-MM): no lo cubren y su «Desde» se puede corregir. */
export function inscripcionesSinCobertura(inscripciones: TaxRegistration[], mes: string): TaxRegistration[] {
  const partes = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!partes) return [];
  const ultimoDia = new Date(Date.UTC(Number(partes[1]), Number(partes[2]), 0)).getUTCDate();
  const fin = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
  return inscripciones.filter((fila) => fila.status === "ACTIVE" && fila.validFrom.slice(0, 10) > fin);
}
