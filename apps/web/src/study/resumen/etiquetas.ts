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

/** Período de la API con formato único («Noviembre 2026» → «noviembre de 2026»). El texto libre se respeta. */
export function etiquetaPeriodo(label: string | null | undefined) {
  const texto = label?.trim();
  if (!texto) return "Sin configurar";
  const coincidencia = /^([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s+(\d{4})$/.exec(texto);
  const nombreMes = coincidencia?.[1]?.toLocaleLowerCase("es-AR");
  const anio = coincidencia?.[2];
  if (!nombreMes || !anio) return texto;
  const mes = MONTH_LABELS.find((nombre) => nombre.toLocaleLowerCase("es-AR") === nombreMes);
  return mes ? `${mes.toLocaleLowerCase("es-AR")} de ${anio}` : texto;
}

/** Contador de la búsqueda: el total real de coincidencias, sin tope. */
export function etiquetaCoincidencias(total: number) {
  if (total === 0) return "Sin coincidencias";
  return total === 1 ? "1 coincidencia" : `${total} coincidencias`;
}
