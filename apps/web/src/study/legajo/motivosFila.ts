// Motivos por fila del libro IVA: códigos del adaptador ARCA (packages/tax-engine). Un texto por código.
const MOTIVOS_DE_FILA: Readonly<Record<string, string>> = {
  DIRECTION_INVALID: "No se pudo saber si el comprobante es de venta o de compra.",
  LETTER_INVALID: "El tipo de comprobante no tiene una letra válida en el catálogo de ARCA.",
  POS_INVALID: "El punto de venta no es un número válido.",
  RANGE_INVALID: "El número de comprobante no es válido.",
  CUIT_INVALID: "El CUIT o el documento de la contraparte no es válido.",
  DATE_INVALID: "La fecha no es válida. Usá el formato dd/mm/aaaa.",
  NET_INVALID: "El neto gravado no es un importe válido.",
  AMOUNTS_MISSING: "La fila no trae importes: el neto, el no gravado, las exentas y el total están vacíos o en cero.",
  AMOUNT_INVALID: "Un importe de la fila (no gravado, exentas o total) no es un número válido.",
  IVA_MISSING: "Discrimina IVA pero no trae importes de IVA.",
  ALICUOTA_NO_SOPORTADA: "Tiene IVA al 2,5% o al 5%, que el sistema no liquida.",
  PERIOD_MISMATCH: "La fecha está fuera del período del lote.",
};

/** Texto de una fila con error. Un código que no está en la tabla se informa tal cual, sin inventar un motivo. */
export function motivoDeFila(codigo: string): string {
  return MOTIVOS_DE_FILA[codigo] ?? `Motivo no reconocido: ${codigo}.`;
}
