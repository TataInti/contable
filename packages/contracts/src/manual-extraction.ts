import { BACKED_CURRENCIES } from "./catalogs.js";
import { CLIENT_VAT_CONDITIONS } from "./client-profile-catalogs.js";
import { voucherLetter } from "./domain-enums.js";

export const VOUCHER_DOCUMENT_TYPES = [
  "factura",
  "ticket_no_fiscal",
  "recibo",
  "nota_credito",
  "nota_debito",
  "otro",
  "ilegible",
] as const;

export const MANUAL_EXTRACTION_FIELD_KEYS = [
  "voucherType",
  "letter",
  "pointOfSale",
  "voucherNumber",
  "issueDate",
  "issuerTaxId",
  "receiverTaxId",
  "issuerName",
  "receiverName",
  "vatCondition",
  "netAmount",
  "nonTaxableAmount",
  "exemptAmount",
  "totalAmount",
  "currency",
  "cae",
  "caeExpiration",
] as const;
export type ManualExtractionFieldKey = (typeof MANUAL_EXTRACTION_FIELD_KEYS)[number];

export function isManualExtractionFieldKey(value: string): value is ManualExtractionFieldKey {
  return (MANUAL_EXTRACTION_FIELD_KEYS as readonly string[]).includes(value);
}

export const MANUAL_EXTRACTION_LETTERS = [...voucherLetter.options, "E", "X"] as const;
export const MANUAL_EXTRACTION_CURRENCIES = BACKED_CURRENCIES;
export const MANUAL_EXTRACTION_VAT_CONDITIONS = CLIENT_VAT_CONDITIONS;

const AMOUNT_FIELDS = new Set<ManualExtractionFieldKey>([
  "netAmount",
  "nonTaxableAmount",
  "exemptAmount",
  "totalAmount",
]);

const CANONICAL_AMOUNT_PATTERN = /^-?\d+\.\d{2}$/;
const DIGITS_PATTERN = /^\d+$/;

function normalizeIntegerPart(value: string): string | null {
  if (DIGITS_PATTERN.test(value)) return value;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) return value.replaceAll(".", "");
  return null;
}

/** Normaliza montos es-AR o con punto decimal a dos decimales canónicos. */
export function normalizeManualExtractionAmount(value: string): string | null {
  const input = value.trim();
  const sign = input.startsWith("-") ? "-" : "";
  const unsigned = sign ? input.slice(1) : input;
  if (!unsigned) return null;

  if (DIGITS_PATTERN.test(unsigned)) return `${sign}${unsigned}.00`;

  const commaIndex = unsigned.indexOf(",");
  if (commaIndex >= 0) {
    if (commaIndex !== unsigned.lastIndexOf(",")) return null;
    const integerPart = normalizeIntegerPart(unsigned.slice(0, commaIndex));
    const decimals = unsigned.slice(commaIndex + 1);
    if (!integerPart || !/^\d{1,2}$/.test(decimals)) return null;
    return `${sign}${integerPart}.${decimals.padEnd(2, "0")}`;
  }

  // Con tres cifras tras un punto, la lectura argentina es agrupación de miles.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(unsigned)) {
    return `${sign}${unsigned.replaceAll(".", "")}.00`;
  }

  const decimalPoint = unsigned.match(/^(\d+)\.(\d{1,2})$/);
  if (decimalPoint) {
    return `${sign}${decimalPoint[1]!}.${decimalPoint[2]!.padEnd(2, "0")}`;
  }

  return null;
}

export function isValidManualExtractionIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1]!;
}

/** Mensaje de formato para el API; los importes deben llegar ya normalizados. */
export function manualExtractionFieldError(
  key: ManualExtractionFieldKey,
  value: string,
): string | null {
  switch (key) {
    case "voucherType":
      return (VOUCHER_DOCUMENT_TYPES as readonly string[]).includes(value)
        ? null
        : "Elegí un tipo de documento de la lista.";
    case "letter":
      return (MANUAL_EXTRACTION_LETTERS as readonly string[]).includes(value)
        ? null
        : "Elegí una letra de la lista.";
    case "pointOfSale":
    case "voucherNumber":
      return DIGITS_PATTERN.test(value) ? null : "Ingresá solo dígitos.";
    case "issueDate":
    case "caeExpiration":
      return isValidManualExtractionIsoDate(value)
        ? null
        : "Ingresá una fecha válida con formato AAAA-MM-DD.";
    case "issuerTaxId":
    case "receiverTaxId":
      return /^\d{11}$/.test(value) ? null : "El CUIT debe tener exactamente 11 dígitos.";
    case "issuerName":
    case "receiverName":
      return null;
    case "vatCondition":
      return (MANUAL_EXTRACTION_VAT_CONDITIONS as readonly string[]).includes(value)
        ? null
        : "Elegí una condición frente al IVA de la lista.";
    case "netAmount":
    case "nonTaxableAmount":
    case "exemptAmount":
    case "totalAmount":
      return CANONICAL_AMOUNT_PATTERN.test(value)
        ? null
        : "El importe debe tener punto decimal y dos decimales (por ejemplo, 1234.56).";
    case "currency":
      return (MANUAL_EXTRACTION_CURRENCIES as readonly string[]).includes(value)
        ? null
        : "Elegí una moneda de la lista.";
    case "cae":
      return /^\d{14}$/.test(value) ? null : "El CAE debe tener exactamente 14 dígitos.";
  }
}

export function isManualExtractionAmountField(key: ManualExtractionFieldKey): boolean {
  return AMOUNT_FIELDS.has(key);
}
