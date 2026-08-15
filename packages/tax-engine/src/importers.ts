import { Decimal } from "decimal.js";

/**
 * Adaptadores de importación fiscal (G2-02 / G2-03).
 *
 * Puros y deterministas: reciben filas crudas (formato oficial) y devuelven
 * filas normalizadas o errores por fila. No consultan DB ni HTTP.
 *
 * Regla central: una fila con formato inválido NUNCA se silencia — se marca
 * como ERROR con detalle para que el lote muestre qué quedó fuera.
 */

// ============================================================
// Tipos comunes
// ============================================================

export type RowStatus = "VALID" | "ERROR";

export interface NormalizedRow<T = Record<string, unknown>> {
  status: RowStatus;
  /** Datos normalizados si la fila es válida. */
  data?: T;
  /** Detalle de errores por campo. */
  errors?: string[];
}

export interface ImportTotals {
  /** Suma de importes netos normalizados. */
  net: string;
  /** Suma de importes IVA. */
  iva: string;
  /** Suma de retenciones (si aplica). */
  withholding?: string;
  /** Suma de percepciones (si aplica). */
  perception?: string;
  /** Cantidad de filas válidas. */
  validRows: number;
  /** Cantidad de filas con error. */
  errorRows: number;
}

function isDecimalString(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value);
}

function isIntString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isCuit(value: unknown): value is string {
  return typeof value === "string" && /^\d{11}$/.test(value);
}

// ============================================================
// G2-02 — Adaptador ARCA compras/ventas (IVA)
//
// Formato esperado (columnas de ARCA Libro IVA Digital):
//   tipoComprobante | puntoVenta | numeroDesde | numeroHasta | cuitContraparte |
//   fechaEmision | importeNeto | conIva | iva21 | iva105 | iva27 | exento |
//   otrosTributos | tipoCambio | moneda
// ============================================================

export interface ArcaVoucherRow {
  /** Letra del comprobante: A, B, C, M, NC, ND. */
  letter: string;
  pointOfSale: number;
  numberFrom: number;
  numberTo: number;
  counterpartyCuit: string;
  issuedOn: string;
  net: string;
  hasIva: boolean;
  iva21: string;
  iva105: string;
  iva27: string;
  exempt: string;
  otherTaxes: string;
  exchangeRate: string | null;
  currency: string;
  total: string;
}

export type ArcaVoucherError =
  | "LETTER_INVALID"
  | "POS_INVALID"
  | "RANGE_INVALID"
  | "CUIT_INVALID"
  | "DATE_INVALID"
  | "NET_INVALID"
  | "IVA_MISSING"
  | "TOTAL_MISMATCH";

const VALID_LETTERS = new Set(["A", "B", "C", "M", "NC", "ND"]);

export interface ArcaVoucherInput {
  /** Letra o tipo del comprobante. */
  letter?: unknown;
  /** Punto de venta. */
  pointOfSale?: unknown;
  /** Número (o rango "desde-hasta"). */
  numberFrom?: unknown;
  numberTo?: unknown;
  /** CUIT de la contraparte. */
  cuit?: unknown;
  /** Fecha de emisión YYYY-MM-DD. */
  issuedOn?: unknown;
  /** Importe neto. */
  net?: unknown;
  /** Indica si el comprobante discrimina IVA. */
  hasIva?: unknown;
  /** IVA 21% (o valor por alícuota). */
  iva?: unknown;
  iva21?: unknown;
  iva105?: unknown;
  iva27?: unknown;
  /** Importe exento. */
  exempt?: unknown;
  /** Otros tributos. */
  otherTaxes?: unknown;
  /** Tipo de cambio (moneda extranjera). */
  exchangeRate?: unknown;
  /** Moneda ISO 4217. */
  currency?: unknown;
}

function normalizeLetter(value: unknown): { ok: true; letter: string } | { ok: false; error: ArcaVoucherError } {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (raw === "NC") return { ok: true, letter: "NC" };
  if (raw === "ND") return { ok: true, letter: "ND" };
  if (VALID_LETTERS.has(raw)) return { ok: true, letter: raw };
  return { ok: false, error: "LETTER_INVALID" };
}

/**
 * Normaliza una fila del libro IVA de ARCA (ventas o compras).
 * Devuelve { status: 'VALID', data } o { status: 'ERROR', errors }.
 */
export function normalizeArcaVoucherRow(input: ArcaVoucherInput): NormalizedRow<ArcaVoucherRow> {
  const errors: ArcaVoucherError[] = [];

  const letter = normalizeLetter(input.letter);
  if (!letter.ok) errors.push(letter.error);

  const pos = isIntString(input.pointOfSale) ? Number(input.pointOfSale) : NaN;
  if (!Number.isInteger(pos) || pos <= 0) errors.push("POS_INVALID");

  const numberFrom = isIntString(input.numberFrom) ? Number(input.numberFrom) : NaN;
  const numberTo =
    isIntString(input.numberTo) && input.numberTo !== undefined ? Number(input.numberTo) : numberFrom;
  if (!Number.isInteger(numberFrom) || numberFrom <= 0) errors.push("RANGE_INVALID");
  else if (!Number.isInteger(numberTo) || numberTo < numberFrom) errors.push("RANGE_INVALID");

  if (!isCuit(input.cuit)) errors.push("CUIT_INVALID");

  if (!isDateString(input.issuedOn)) errors.push("DATE_INVALID");

  const net = isDecimalString(input.net) ? new Decimal(input.net) : null;
  if (!net) errors.push("NET_INVALID");

  const hasIva = input.hasIva === true || input.hasIva === "true" || input.hasIva === "SI" || input.hasIva === "S";
  const ivaRaw = isDecimalString(input.iva) ? (input.iva as string) : undefined;
  const iva21 = isDecimalString(input.iva21) ? new Decimal(input.iva21) : ivaRaw ? new Decimal(ivaRaw) : null;
  const iva105 = isDecimalString(input.iva105) ? new Decimal(input.iva105) : null;
  const iva27 = isDecimalString(input.iva27) ? new Decimal(input.iva27) : null;

  if (hasIva && !iva21 && !iva105 && !iva27) {
    errors.push("IVA_MISSING");
  }

  const exempt = isDecimalString(input.exempt) ? new Decimal(input.exempt) : new Decimal(0);
  const otherTaxes = isDecimalString(input.otherTaxes) ? new Decimal(input.otherTaxes) : new Decimal(0);
  const exchangeRate = isDecimalString(input.exchangeRate) ? new Decimal(input.exchangeRate) : null;
  const currency = typeof input.currency === "string" && input.currency.length === 3 ? input.currency : "ARS";

  // Total = neto + IVA + exento + otros tributos
  let total: Decimal | null = null;
  if (net) {
    total = net.plus(iva21 ?? 0).plus(iva105 ?? 0).plus(iva27 ?? 0).plus(exempt).plus(otherTaxes);
  }

  if (errors.length > 0) {
    return { status: "ERROR", errors };
  }

  return {
    status: "VALID",
    data: {
      letter: (letter as { ok: true; letter: string }).letter,
      pointOfSale: pos,
      numberFrom,
      numberTo,
      counterpartyCuit: input.cuit as string,
      issuedOn: input.issuedOn as string,
      net: (net as Decimal).toFixed(4),
      hasIva,
      iva21: (iva21 ?? new Decimal(0)).toFixed(4),
      iva105: (iva105 ?? new Decimal(0)).toFixed(4),
      iva27: (iva27 ?? new Decimal(0)).toFixed(4),
      exempt: exempt.toFixed(4),
      otherTaxes: otherTaxes.toFixed(4),
      exchangeRate: exchangeRate ? exchangeRate.toFixed(8) : null,
      currency,
      total: (total as Decimal).toFixed(4),
    },
  };
}

/**
 * Procesa un lote de filas ARCA y devuelve las normalizadas + totales.
 */
export function normalizeArcaVoucherBatch(
  rows: readonly ArcaVoucherInput[],
): { rows: NormalizedRow<ArcaVoucherRow>[]; totals: ImportTotals } {
  let net = new Decimal(0);
  let iva = new Decimal(0);
  let valid = 0;
  let errors = 0;

  const normalized = rows.map((row) => {
    const result = normalizeArcaVoucherRow(row);
    if (result.status === "VALID" && result.data) {
      net = net.plus(result.data.net);
      iva = iva.plus(result.data.iva21).plus(result.data.iva105).plus(result.data.iva27);
      valid += 1;
    } else {
      errors += 1;
    }
    return result;
  });

  return {
    rows: normalized,
    totals: {
      net: net.toFixed(4),
      iva: iva.toFixed(4),
      validRows: valid,
      errorRows: errors,
    },
  };
}

// ============================================================
// G2-03 — Adaptador ARCA retenciones/percepciones
//
// Formato esperado (columnas típicas de Mis Retenciones):
//   cuitResponsable | cuitAgente | concepto | base | importe | tipo
//   (RETENCION | PERCEPCION) | fechaEmision | numeroCertificado
// ============================================================

export interface WithholdingRow {
  cuitResponsable: string;
  cuitAgente: string;
  concept: string;
  base: string;
  amount: string;
  rate: string | null;
  kind: "RETENCION" | "PERCEPCION";
  issuedOn: string;
  certificateNumber: string | null;
}

export type WithholdingError =
  | "CUIT_RESPONSABLE_INVALID"
  | "CUIT_AGENTE_INVALID"
  | "CONCEPT_INVALID"
  | "BASE_INVALID"
  | "AMOUNT_INVALID"
  | "KIND_INVALID"
  | "DATE_INVALID";

export interface WithholdingInput {
  cuitResponsable?: unknown;
  cuitAgente?: unknown;
  concept?: unknown;
  base?: unknown;
  amount?: unknown;
  rate?: unknown;
  tipo?: unknown;
  kind?: unknown;
  issuedOn?: unknown;
  fechaEmision?: unknown;
  certificateNumber?: unknown;
}

/**
 * Normaliza una fila de retención o percepción (ARCA Mis Retenciones).
 */
export function normalizeWithholdingRow(input: WithholdingInput): NormalizedRow<WithholdingRow> {
  const errors: WithholdingError[] = [];

  if (!isCuit(input.cuitResponsable)) errors.push("CUIT_RESPONSABLE_INVALID");
  if (!isCuit(input.cuitAgente)) errors.push("CUIT_AGENTE_INVALID");

  const concept = typeof input.concept === "string" && input.concept.trim().length > 0
    ? input.concept.trim()
    : null;
  if (!concept) errors.push("CONCEPT_INVALID");

  const base = isDecimalString(input.base) ? new Decimal(input.base) : null;
  if (!base) errors.push("BASE_INVALID");
  else if (base.isNegative()) errors.push("BASE_INVALID");

  const amount = isDecimalString(input.amount) ? new Decimal(input.amount) : null;
  if (!amount) errors.push("AMOUNT_INVALID");
  else if (amount.isNegative()) errors.push("AMOUNT_INVALID");

  const rate = isDecimalString(input.rate) ? new Decimal(input.rate) : null;

  const kindRaw = typeof input.tipo === "string"
    ? input.tipo.trim().toUpperCase()
    : typeof input.kind === "string"
      ? input.kind.trim().toUpperCase()
      : "";
  const kind = kindRaw === "RETENCION" || kindRaw === "RETENCIÓN"
    ? "RETENCION"
    : kindRaw === "PERCEPCION" || kindRaw === "PERCEPCIÓN"
      ? "PERCEPCION"
      : null;
  if (!kind) errors.push("KIND_INVALID");

  const issuedOn = isDateString(input.issuedOn) ? input.issuedOn : isDateString(input.fechaEmision) ? input.fechaEmision : null;
  if (!issuedOn) errors.push("DATE_INVALID");

  const certificateNumber =
    typeof input.certificateNumber === "string" && input.certificateNumber.trim().length > 0
      ? input.certificateNumber.trim()
      : null;

  if (errors.length > 0) return { status: "ERROR", errors };

  return {
    status: "VALID",
    data: {
      cuitResponsable: input.cuitResponsable as string,
      cuitAgente: input.cuitAgente as string,
      concept: concept as string,
      base: (base as Decimal).toFixed(4),
      amount: (amount as Decimal).toFixed(4),
      rate: rate ? rate.toFixed(6) : null,
      kind: kind as "RETENCION" | "PERCEPCION",
      issuedOn: issuedOn as string,
      certificateNumber,
    },
  };
}

export function normalizeWithholdingBatch(
  rows: readonly WithholdingInput[],
): { rows: NormalizedRow<WithholdingRow>[]; totals: ImportTotals } {
  let withholding = new Decimal(0);
  let perception = new Decimal(0);
  let valid = 0;
  let errors = 0;

  const normalized = rows.map((row) => {
    const result = normalizeWithholdingRow(row);
    if (result.status === "VALID" && result.data) {
      if (result.data.kind === "RETENCION") withholding = withholding.plus(result.data.amount);
      else perception = perception.plus(result.data.amount);
      valid += 1;
    } else {
      errors += 1;
    }
    return result;
  });

  return {
    rows: normalized,
    totals: {
      net: "0",
      iva: "0",
      withholding: withholding.toFixed(4),
      perception: perception.toFixed(4),
      validRows: valid,
      errorRows: errors,
    },
  };
}
