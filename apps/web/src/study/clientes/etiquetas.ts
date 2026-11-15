import { CLIENT_VAT_CONDITION_LABELS } from "@contable/contracts";
import type { ClientProfile } from "./tipos";

export const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const MONTH_LONG = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

export function vatLabel(value: string | null | undefined): string {
  if (!value) return "";
  return (CLIENT_VAT_CONDITION_LABELS as Record<string, string>)[value] ?? value;
}

/** Datos de la ficha que todavía no se completaron (alimenta la métrica y el aviso). */
export function profileGaps(client: { profile?: ClientProfile | null }): string[] {
  const profile = client.profile;
  const gaps: string[] = [];
  if (!profile?.vatCondition) gaps.push("condición IVA");
  if (!profile?.province) gaps.push("provincia");
  if (!profile?.activity) gaps.push("actividad");
  if (!profile?.accountingStandard) gaps.push("norma contable");
  return gaps;
}
