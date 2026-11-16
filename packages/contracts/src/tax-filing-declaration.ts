import { z } from "zod";
import { money, uuid } from "./primitives.js";

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

/** Tope de ítems del detalle del saldo a favor por declaración (D13-4 a). */
export const FILING_DECLARATION_CREDIT_DETAIL_MAX_ITEMS = 100;

/**
 * Saldo a favor de la DJ por impuesto, régimen y jurisdicción (D13-4 a). Usa el mismo modelo que
 * el saldo inicial (TaxCreditLot). El impuesto no puede ser IVA, que tiene sus campos propios; el
 * régimen, la jurisdicción y su vigencia se validan en la API (P4: campo y motivo).
 */
export const taxFilingCreditDetailItemSchema = z
  .object({
    taxTypeId: uuid,
    regimeId: uuid.optional(),
    jurisdictionId: uuid.optional(),
    amount: declaredAmount.refine((value) => /[1-9]/.test(value), "El importe debe ser mayor que cero"),
  })
  .strict();
export type TaxFilingCreditDetailItem = z.infer<typeof taxFilingCreditDetailItemSchema>;

/** Una sola fila por combinación de impuesto, régimen y jurisdicción. */
export const taxFilingCreditDetailSchema = z
  .array(taxFilingCreditDetailItemSchema)
  .max(
    FILING_DECLARATION_CREDIT_DETAIL_MAX_ITEMS,
    `Hasta ${FILING_DECLARATION_CREDIT_DETAIL_MAX_ITEMS} saldos a favor por declaración`,
  )
  .superRefine((items, ctx) => {
    const combinaciones = new Set<string>();
    items.forEach((item, index) => {
      const combinacion = [item.taxTypeId, item.regimeId ?? "", item.jurisdictionId ?? ""].join("|");
      if (combinaciones.has(combinacion)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: "Ya hay un saldo para este impuesto, régimen y jurisdicción: cargalo una sola vez",
        });
      }
      combinaciones.add(combinacion);
    });
  });

/** Lectura del detalle guardado: importes NUMERIC(20,4) como cadena; null si la DJ no lo trae. */
export const taxFilingCreditDetailReadSchema = z
  .array(
    z.object({
      taxTypeId: uuid,
      regimeId: uuid.nullish(),
      jurisdictionId: uuid.nullish(),
      amount: money,
    }),
  )
  .nullish();

export const taxFilingDeclarationBodySchema = z
  .object({
    declarationDocumentId: uuid,
    impuestoDeterminado: declaredAmount,
    saldoFavorTecnico: declaredAmount,
    saldoLibreDisponibilidad: declaredAmount,
    totalAPagar: declaredAmount,
    saldosFavorDetalle: taxFilingCreditDetailSchema.optional(),
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
