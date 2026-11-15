import { z } from "zod";
import { uuid } from "./primitives.js";

/**
 * Declaración jurada (DJ) de una presentación (corte 5a). Los importes se cargan
 * a mano (S1): cadenas decimales no negativas con hasta 4 decimales (NUMERIC(20,4)).
 * Cada error indica el campo y el motivo (P4).
 */

/** Categoría de Document que identifica la DJ. Document.category es texto libre: la API la valida. */
export const FILING_DECLARATION_DOCUMENT_CATEGORY = "DECLARACION_JURADA";

/** Diferencia que no genera advertencia; el mismo criterio que el importe presentado (recordFiling). */
export const FILING_DECLARATION_TOLERANCE = "0.01";

const declaredAmount = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, "Importe en pesos, sin signo, con hasta 4 decimales");

export const taxFilingDeclarationBodySchema = z
  .object({
    declarationDocumentId: uuid,
    impuestoDeterminado: declaredAmount,
    saldoFavorTecnico: declaredAmount,
    saldoLibreDisponibilidad: declaredAmount,
    totalAPagar: declaredAmount,
  })
  .strict();
export type TaxFilingDeclarationBody = z.infer<typeof taxFilingDeclarationBodySchema>;

/** Advertencias de la DJ: informan, no bloquean (D3 y P4). */
export const TAX_FILING_DECLARATION_WARNING_CODES = [
  "TOTAL_A_PAGAR_DISTINTO_DE_PRESENTADO",
  "SALDO_TECNICO_DISTINTO_DE_LIQUIDACION",
  "SALDO_LIBRE_DISTINTO_DE_LIQUIDACION",
] as const;
export type TaxFilingDeclarationWarningCode = (typeof TAX_FILING_DECLARATION_WARNING_CODES)[number];

export interface TaxFilingDeclarationWarning {
  code: TaxFilingDeclarationWarningCode;
  field: "totalAPagar" | "saldoFavorTecnico" | "saldoLibreDisponibilidad";
  message: string;
}
