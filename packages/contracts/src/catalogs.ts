import { z } from "zod";

/**
 * Catálogo de monedas funcionales respaldadas por el sistema (ficha del cliente).
 *
 * Derivado del comportamiento real del sistema (auditoría de catálogos), no de
 * un estándar externo:
 * - "ARS": moneda funcional por defecto en toda la base (ClientProfile, diario,
 *   cuentas, seeds) y destino del alias "PES" del importador del libro IVA.
 * - "USD": única moneda extranjera con lógica FX operativa en el servicio
 *   bancario (quoteCurrency/currencyCode).
 *
 * El validador LIMITA valores: no se asume que un código de tres letras sea
 * una moneda ISO 4217 válida. Ampliar el catálogo es una decisión de producto
 * (requiere respaldo de conversión/FX) y se hace editando esta constante.
 *
 * Nota: "PES" es un alias de entrada del importador del libro IVA que se
 * normaliza a "ARS" (packages/tax-engine/src/xlsx.ts); no es una moneda
 * guardable en el perfil.
 */
export const BACKED_CURRENCIES = ["ARS", "USD"] as const;
export type BackedCurrency = (typeof BACKED_CURRENCIES)[number];

/**
 * Moneda funcional de la ficha del cliente. Normaliza a mayúsculas para
 * mantener compatibilidad con datos existentes guardados en minúsculas y
 * rechaza todo valor fuera del catálogo.
 */
export const functionalCurrency = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(BACKED_CURRENCIES),
);
