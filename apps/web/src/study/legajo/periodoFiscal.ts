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
