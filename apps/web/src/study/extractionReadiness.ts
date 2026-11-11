import type { ExtractedField, VoucherData } from "../lib/api";

/**
 * Motivos con los que el backend informa que la lectura automática no está
 * disponible para el documento. En la bandeja se traducen a un mensaje
 * accionable en español en lugar de mostrar el código crudo.
 */
export const AUTOMATED_READING_UNAVAILABLE_REASONS = [
  "CUSTOMER_DATA_EXTRACTION_DISABLED",
  "AI_SERVICE_UNAVAILABLE",
  "MODEL_NOT_CONFIGURED",
] as const;

const AUTOMATED_READING_UNAVAILABLE = new Set<string>(AUTOMATED_READING_UNAVAILABLE_REASONS);

export const AUTOMATED_READING_UNAVAILABLE_MESSAGE =
  "La lectura automática no está activada para este documento. Podés cargar los datos a mano en la tabla y aprobar, o rechazarlo.";

export function isAutomatedReadingUnavailableReason(reason: string): boolean {
  return AUTOMATED_READING_UNAVAILABLE.has(reason);
}

type FiscalVoucherKey = Exclude<
  keyof VoucherData,
  "hora" | "iva" | "percepciones" | "confianza"
>;

/** Campos escalares que la tabla fiscal muestra como dato del comprobante. */
const FISCAL_VOUCHER_KEYS: readonly FiscalVoucherKey[] = [
  "tipo_documento",
  "letra",
  "punto_venta",
  "numero",
  "fecha",
  "cuit_emisor",
  "cuit_receptor",
  "razon_social_emisor",
  "razon_social_receptor",
  "condicion_iva",
  "neto_gravado",
  "no_gravado",
  "exento",
  "total",
  "moneda",
  "cae",
  "cae_vencimiento",
];

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Indica si el voucher leído tiene al menos un dato fiscal con valor. */
export function voucherHasFiscalData(voucher: VoucherData | null): boolean {
  if (!voucher) return false;
  if (FISCAL_VOUCHER_KEYS.some((key) => hasText(voucher[key]))) return true;

  const vatHasValue = (voucher.iva ?? []).some(
    (entry) => hasText(entry?.alicuota) || hasText(entry?.importe),
  );
  if (vatHasValue) return true;

  return (voucher.percepciones ?? []).some((entry) => {
    if (!entry) return false;
    if (hasText(entry.importe)) return true;
    if ("tipo" in entry) return hasText(entry.tipo);
    return hasText(entry.tipo_texto);
  });
}

/**
 * Datos efectivos de una extracción: los valores leídos del comprobante más
 * las correcciones manuales vigentes en el formulario. Sin ninguno de los dos
 * no hay nada que aprobar.
 */
export function hasEffectiveFiscalData(
  voucherData: VoucherData | null,
  correctableFields: Pick<ExtractedField, "id">[],
  corrections: Record<string, string>,
): boolean {
  if (voucherHasFiscalData(voucherData)) return true;
  return correctableFields.some((field) => hasText(corrections[field.id]));
}
