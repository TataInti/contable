import { CLIENT_VAT_CONDITION_LABELS } from "@contable/contracts";
import { clientConfigurationMissing } from "@contable/contracts";
import type { ClientProfile, ClientWithProfile } from "./tipos";

/** Cuando falta el dato de la API, no inventar un estado completo. */
export function configurationGaps(client: ClientWithProfile) {
  return client.configurationMissing ?? clientConfigurationMissing({
    hasAccountingProfile: Boolean(client.profile), hasActiveFiscalProfile: false,
    hasActiveRegistration: false, hasActiveActivity: false, hasTaxPeriod: false, hasObligation: false,
  });
}

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
  // La norma contable es opcional (A57): no integra los faltantes de la ficha.
  return gaps;
}

/** Sigla de la condición frente al IVA para columnas angostas; el nombre completo va en el tooltip. */
const VAT_SHORT: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "RI",
  MONOTRIBUTISTA: "Monotributo",
  EXENTO: "Exento",
  NO_RESPONSABLE: "No resp.",
};
export function vatShort(value: string | null | undefined): string {
  if (!value) return "";
  return VAT_SHORT[value] ?? vatLabel(value);
}
