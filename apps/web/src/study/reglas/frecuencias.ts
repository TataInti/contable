import { DUE_DATE_FREQUENCIES, type DueDateFrequency } from "@contable/contracts";

// Etiquetas de la lista cerrada de frecuencias (D-R3-A). Un solo mapa código → etiqueta:
// lo usan el desplegable del alta y la columna de la tabla.
const ETIQUETAS: Record<DueDateFrequency, string> = {
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
  ANNUAL: "Anual",
  ONCE: "Única",
};

export type { DueDateFrequency };

export const FRECUENCIA_POR_DEFECTO: DueDateFrequency = "MONTHLY";

export const OPCIONES_FRECUENCIA = DUE_DATE_FREQUENCIES.map((value) => ({
  value,
  label: ETIQUETAS[value],
}));

export function esFrecuencia(valor: string): valor is DueDateFrequency {
  return (DUE_DATE_FREQUENCIES as readonly string[]).includes(valor);
}

// Los códigos de la lista muestran su etiqueta; cualquier otro valor guardado se muestra tal cual.
export function etiquetaFrecuencia(valor: string | null): string {
  if (valor === null) return "—";
  return esFrecuencia(valor) ? ETIQUETAS[valor] : valor;
}
