/**
 * Utilidades de formato y parseo de montos en formato es-AR:
 * - Separador de miles: punto (`.`)
 * - Separador decimal: coma (`,`)
 *
 * El backend espera montos normalizados como `^-?\d+(?:\.\d{1,4})?$`
 * (punto decimal, sin separadores de miles). Estas funciones convierten
 * entre la representación visible (es-AR) y la normalizada (API).
 */

const MONEY_FORMAT = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Convierte un valor normalizado (ej. "1234567.89") a su representación
 * visible es-AR (ej. "1.234.567,89"). Devuelve "" para valores vacíos.
 */
export function formatMoneyInput(value: string): string {
  if (!value) return "";
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const num = Number(normalized);
  if (Number.isNaN(num)) return value;
  return MONEY_FORMAT.format(num);
}

/**
 * Convierte el texto visible es-AR (ej. "1.234.567,89") a un valor
 * normalizado para la API (ej. "1234567.89"). Devuelve "" si no hay
 * dígitos válidos.
 */
export function parseMoneyInput(value: string): string {
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return "";
  // Si hay coma, es el separador decimal; los puntos son miles.
  const hasComma = cleaned.includes(",");
  let normalized: string;
  if (hasComma) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // Sin coma: el último punto es el separador decimal (si hay más de uno,
    // los anteriores son miles).
    const parts = cleaned.split(".");
    if (parts.length > 1) {
      normalized = parts.slice(0, -1).join("") + "." + parts[parts.length - 1];
    } else {
      normalized = cleaned;
    }
  }
  // Recortar a 4 decimales (máximo que acepta el backend).
  const parts = normalized.split(".");
  const intPart = parts[0] ?? "";
  const dec = parts.slice(1).join("").slice(0, 4);
  const int = intPart.replace(/^0+(?=\d)/, "");
  return dec ? `${int}.${dec}` : int;
}