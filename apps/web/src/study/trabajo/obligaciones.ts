import { formatearRango } from "../../lib/formatoFechas";
import type { Obligation } from "./tipos";

export interface FilaObligacion {
  id: string;
  /** Período fiscal (impuesto y mes) con el que se abre el Legajo. */
  taxPeriodId: string;
  name: string;
  periodLabel: string;
  dueDate: string;
  status: string;
}

export function filasDeObligaciones(
  obligaciones: Obligation[] | undefined,
  selectedAccountingPeriod: { startDate: string; endDate: string } | undefined,
): FilaObligacion[] {
  return (obligaciones ?? [])
    .filter((item) => {
      if (!selectedAccountingPeriod) return true;
      return (
        item.period.startDate.slice(0, 10) === selectedAccountingPeriod.startDate.slice(0, 10) &&
        item.period.endDate.slice(0, 10) === selectedAccountingPeriod.endDate.slice(0, 10)
      );
    })
    .map((item) => ({
    id: item.id,
    taxPeriodId: item.period.id,
    name: `${item.regime.taxType.name} · ${item.regime.jurisdiction.name}`,
    periodLabel:
      item.period.label ??
      formatearRango(item.period.startDate, item.period.endDate),
    dueDate: item.dueDate ?? item.period.endDate,
    status: item.status,
    }));
}
