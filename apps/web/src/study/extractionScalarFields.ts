import type { ExtractedField, VoucherData } from "../lib/api";

type ScalarVoucherKey = Exclude<keyof VoucherData, "hora" | "iva" | "percepciones" | "confianza">;

export const EXTRACTION_SCALAR_FIELDS = [
  { field: "Tipo de documento", voucherKey: "tipo_documento", extractedKey: "voucherType" },
  { field: "Letra", voucherKey: "letra", extractedKey: "letter" },
  { field: "Punto de venta", voucherKey: "punto_venta", extractedKey: "pointOfSale" },
  { field: "Número", voucherKey: "numero", extractedKey: "voucherNumber" },
  { field: "Fecha", voucherKey: "fecha", extractedKey: "issueDate" },
  { field: "CUIT emisor", voucherKey: "cuit_emisor", extractedKey: "issuerTaxId" },
  { field: "CUIT receptor", voucherKey: "cuit_receptor", extractedKey: "receiverTaxId" },
  { field: "Razón social emisor", voucherKey: "razon_social_emisor", extractedKey: "issuerName" },
  { field: "Razón social receptor", voucherKey: "razon_social_receptor", extractedKey: "receiverName" },
  { field: "Condición frente al IVA", voucherKey: "condicion_iva", extractedKey: "vatCondition" },
  { field: "Neto gravado", voucherKey: "neto_gravado", extractedKey: "netAmount" },
  { field: "No gravado", voucherKey: "no_gravado", extractedKey: "nonTaxableAmount" },
  { field: "Exento", voucherKey: "exento", extractedKey: "exemptAmount" },
  { field: "Total", voucherKey: "total", extractedKey: "totalAmount" },
  { field: "Moneda", voucherKey: "moneda", extractedKey: "currency" },
  { field: "CAE", voucherKey: "cae", extractedKey: "cae", optional: true },
  { field: "Vencimiento del CAE", voucherKey: "cae_vencimiento", extractedKey: "caeExpiration", optional: true },
] as const satisfies readonly {
  field: string;
  voucherKey: ScalarVoucherKey;
  extractedKey: string;
  optional?: boolean;
}[];

export type ManualFiscalFieldKey = (typeof EXTRACTION_SCALAR_FIELDS)[number]["extractedKey"];

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function effectiveExtractedFieldValue(field: Pick<ExtractedField, "correction" | "normalizedValue" | "rawValue">): string | null {
  const value = field.correction ?? field.normalizedValue ?? field.rawValue;
  return hasText(value) ? value : null;
}

export function fiscalScalarHasValue(
  voucherData: VoucherData | null,
  fields: ExtractedField[],
  definition: (typeof EXTRACTION_SCALAR_FIELDS)[number],
): boolean {
  if (hasText(voucherData?.[definition.voucherKey])) return true;
  return fields.some(
    (field) => field.key === definition.extractedKey && effectiveExtractedFieldValue(field) !== null,
  );
}
