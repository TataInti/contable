import { CLIENT_VAT_CONDITION_LABELS } from "@contable/contracts";

export const PERSON_TYPE_LABELS: Record<string, string> = {
  FISICA: "Persona física",
  JURIDICA: "Persona jurídica",
};

export const CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: "Responsable inscripto",
  MONOTRIBUTISTA: "Monotributista",
  EXENTO: "Exento",
  NO_RESPONSABLE: "No responsable",
};

export const MONTH_LABELS = [
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

export function displayValue(value: string | null | undefined) {
  return value?.trim() || "Sin configurar";
}

export function displayVatCondition(value: string | null | undefined) {
  if (!value) return "Sin configurar";
  return (CLIENT_VAT_CONDITION_LABELS as Record<string, string>)[value] ?? value;
}
