import type { FiscalTaxPeriod } from "./tipos";
import { formatearPeriodo } from "../../lib/formatoFechas";

export function fiscalTaxPeriodLabel(period: FiscalTaxPeriod) {
  return period.label ?? formatearPeriodo(period.startDate, period.endDate);
}

export function fiscalTaxPeriodSelectionKey(firmId: string, clientId: string) {
  return `contable:${firmId}:${clientId}:selected-tax-period`;
}

export function readFiscalTaxPeriodSelection(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeFiscalTaxPeriodSelection(key: string, periodId: string) {
  if (typeof window === "undefined") return;
  try {
    if (periodId) window.sessionStorage.setItem(key, periodId);
    else window.sessionStorage.removeItem(key);
  } catch {
    // La selección en memoria sigue funcionando si el navegador bloquea storage.
  }
}

/** Comparación de rótulos: sin mayúsculas, sin tildes y sin la palabra «de» (Barra 2d). */
function claveDeRotulo(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es-AR")
    .replace(/\bde\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rótulo del período en el desplegable de la barra: «Mes de año · nombre del impuesto» (Barra 2d, A29).
 * El rótulo propio del período se agrega al final solo si dice algo distinto del mes y el año
 * (por ejemplo «DEMO IVA 2026-06»); «Marzo 2025», «marzo de 2025» o un período sin rótulo no repiten el mes.
 */
export function rotuloPeriodoFiscal(period: FiscalTaxPeriod) {
  const mes = formatearPeriodo(period.startDate, period.endDate);
  const partes = [
    `${mes.charAt(0).toLocaleUpperCase("es-AR")}${mes.slice(1)}`,
    period.taxType.name,
  ];
  const rotulo = period.label?.trim() ?? "";
  if (rotulo && claveDeRotulo(rotulo) !== claveDeRotulo(mes)) partes.push(rotulo);
  return partes.join(" · ");
}
