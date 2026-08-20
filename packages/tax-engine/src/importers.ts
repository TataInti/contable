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
  /** Dirección del comprobante: SALE (venta) o PURCHASE (compra). */
  direction: "SALE" | "PURCHASE";
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
  | "DIRECTION_INVALID"
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
  /** Dirección del comprobante: SALE (venta) o PURCHASE (compra). */
  direction?: unknown;
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

  // F0.4: la dirección es obligatoria y tipada. Nunca se infiere de taxTypeId.
  const direction = typeof input.direction === "string" ? input.direction.toUpperCase() : "";
  if (direction !== "SALE" && direction !== "PURCHASE") {
    errors.push("DIRECTION_INVALID");
  }

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
      direction: direction as "SALE" | "PURCHASE",
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

// ============================================================
// G2-02 — Adaptador DGR Tucumán IIBB (Ingresos Brutos local)
//
// Formato esperado (padrón/constancia de DGR Tucumán):
//   activityCode | description | income | rate | minimum | exemption
//
// Cada fila representa ingresos gravados por actividad (nomenclador).
// ============================================================

export interface IibbTucRow {
  activityCode: string;
  description: string | null;
  income: string;
  rate: string | null;
  minimum: string | null;
  exemption: string;
}

export type IibbTucError =
  | "ACTIVITY_CODE_INVALID"
  | "INCOME_INVALID"
  | "RATE_INVALID"
  | "MINIMUM_INVALID";

export interface IibbTucImportRow {
  activityCode?: unknown;
  description?: unknown;
  income?: unknown;
  rate?: unknown;
  minimum?: unknown;
  exemption?: unknown;
}

/**
 * Normaliza una fila de ingresos brutos DGR Tucumán.
 * Devuelve { status: 'VALID', data } o { status: 'ERROR', errors }.
 */
export function normalizeIibbTucRow(input: IibbTucImportRow): NormalizedRow<IibbTucRow> {
  const errors: IibbTucError[] = [];

  const activityCode = typeof input.activityCode === "string"
    ? input.activityCode.trim().toUpperCase()
    : "";
  if (activityCode.length === 0) errors.push("ACTIVITY_CODE_INVALID");

  const income = isDecimalString(input.income) ? new Decimal(input.income) : null;
  if (!income || income.isNegative()) errors.push("INCOME_INVALID");

  const rate = isDecimalString(input.rate) ? new Decimal(input.rate) : null;
  if (input.rate !== undefined && input.rate !== null && !rate) errors.push("RATE_INVALID");

  const minimum = isDecimalString(input.minimum) ? new Decimal(input.minimum) : null;
  if (input.minimum !== undefined && input.minimum !== null && !minimum) errors.push("MINIMUM_INVALID");

  const exemption = isDecimalString(input.exemption) ? new Decimal(input.exemption) : new Decimal(0);

  const description = typeof input.description === "string" && input.description.trim().length > 0
    ? input.description.trim()
    : null;

  if (errors.length > 0) return { status: "ERROR", errors };

  return {
    status: "VALID",
    data: {
      activityCode,
      description,
      income: (income as Decimal).toFixed(4),
      rate: rate ? rate.toFixed(6) : null,
      minimum: minimum ? minimum.toFixed(4) : null,
      exemption: exemption.toFixed(4),
    },
  };
}

/**
 * Procesa un lote de filas IIBB DGR Tucumán y devuelve normalizadas + totales.
 */
export function normalizeIibbTucBatch(
  rows: readonly IibbTucImportRow[],
): { rows: NormalizedRow<IibbTucRow>[]; totals: ImportTotals } {
  let net = new Decimal(0);
  let valid = 0;
  let errors = 0;

  const normalized = rows.map((row) => {
    const result = normalizeIibbTucRow(row);
    if (result.status === "VALID" && result.data) {
      net = net.plus(result.data.income);
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
      iva: "0",
      validRows: valid,
      errorRows: errors,
    },
  };
}

// ============================================================
// G4 — Adaptador SMT TEM (Tasa de Actividades Económicas)
//
// Formato esperado (padrón/constancia de la Municipalidad de San Miguel de
// Tucumán):
//   activityCode | description | income | rate | minimum | exemption
//
// Cada fila representa ingresos gravados por actividad (nomenclador municipal).
// Comparte el mismo esquema que el adaptador DGR IIBB, pero se distingue por
// el prefijo de adapterVersion (SMT_TEM) para el dispatch en ingestión.
// ============================================================

export interface TemSmtRow {
  activityCode: string;
  description: string | null;
  income: string;
  rate: string | null;
  minimum: string | null;
  exemption: string;
}

export type TemSmtError =
  | "ACTIVITY_CODE_INVALID"
  | "INCOME_INVALID"
  | "RATE_INVALID"
  | "MINIMUM_INVALID";

export interface TemSmtImportRow {
  activityCode?: unknown;
  description?: unknown;
  income?: unknown;
  rate?: unknown;
  minimum?: unknown;
  exemption?: unknown;
}

/**
 * Normaliza una fila de TEM San Miguel de Tucumán.
 * Devuelve { status: 'VALID', data } o { status: 'ERROR', errors }.
 */
export function normalizeTemSmtRow(input: TemSmtImportRow): NormalizedRow<TemSmtRow> {
  const errors: TemSmtError[] = [];

  const activityCode = typeof input.activityCode === "string"
    ? input.activityCode.trim().toUpperCase()
    : "";
  if (activityCode.length === 0) errors.push("ACTIVITY_CODE_INVALID");

  const income = isDecimalString(input.income) ? new Decimal(input.income) : null;
  if (!income || income.isNegative()) errors.push("INCOME_INVALID");

  const rate = isDecimalString(input.rate) ? new Decimal(input.rate) : null;
  if (input.rate !== undefined && input.rate !== null && !rate) errors.push("RATE_INVALID");

  const minimum = isDecimalString(input.minimum) ? new Decimal(input.minimum) : null;
  if (input.minimum !== undefined && input.minimum !== null && !minimum) errors.push("MINIMUM_INVALID");

  const exemption = isDecimalString(input.exemption) ? new Decimal(input.exemption) : new Decimal(0);

  const description = typeof input.description === "string" && input.description.trim().length > 0
    ? input.description.trim()
    : null;

  if (errors.length > 0) return { status: "ERROR", errors };

  return {
    status: "VALID",
    data: {
      activityCode,
      description,
      income: (income as Decimal).toFixed(4),
      rate: rate ? rate.toFixed(6) : null,
      minimum: minimum ? minimum.toFixed(4) : null,
      exemption: exemption.toFixed(4),
    },
  };
}

/**
 * Procesa un lote de filas TEM SMT y devuelve normalizadas + totales.
 */
export function normalizeTemSmtBatch(
  rows: readonly TemSmtImportRow[],
): { rows: NormalizedRow<TemSmtRow>[]; totals: ImportTotals } {
  let net = new Decimal(0);
  let valid = 0;
  let errors = 0;

  const normalized = rows.map((row) => {
    const result = normalizeTemSmtRow(row);
    if (result.status === "VALID" && result.data) {
      net = net.plus(result.data.income);
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
      iva: "0",
      validRows: valid,
      errorRows: errors,
    },
  };
}

// ============================================================
// G4 — Adaptador CM03 artículo 2 (Convenio Multilateral)
//
// Formato esperado (declaración CM03 / SIFERE):
//   activityCode | description | income | jurisdiction | coefficient
//
// Cada fila representa ingresos gravados por actividad (base país). Los
// coeficientes por jurisdicción se declaran en filas con activityCode
// "COEF_<jur>" y el valor en `coefficient` (0..1). El adaptador separa
// ingresos de coeficientes y valida que la suma de coeficientes sea 1.
// ============================================================

export interface Cm03Row {
  activityCode: string;
  description: string | null;
  income: string;
  jurisdiction: string | null;
  coefficient: string | null;
}

export type Cm03Error =
  | "ACTIVITY_CODE_INVALID"
  | "INCOME_INVALID"
  | "COEFFICIENT_INVALID"
  | "COEFFICIENT_SUM_INVALID";

export interface Cm03ImportRow {
  activityCode?: unknown;
  description?: unknown;
  income?: unknown;
  jurisdiction?: unknown;
  coefficient?: unknown;
}

/**
 * Normaliza una fila de CM03 artículo 2.
 * Devuelve { status: 'VALID', data } o { status: 'ERROR', errors }.
 */
export function normalizeCm03Row(input: Cm03ImportRow): NormalizedRow<Cm03Row> {
  const errors: Cm03Error[] = [];

  const activityCode = typeof input.activityCode === "string"
    ? input.activityCode.trim().toUpperCase()
    : "";
  if (activityCode.length === 0) errors.push("ACTIVITY_CODE_INVALID");

  const income = isDecimalString(input.income) ? new Decimal(input.income) : null;
  if (!income || income.isNegative()) errors.push("INCOME_INVALID");

  const coefficient = isDecimalString(input.coefficient) ? new Decimal(input.coefficient) : null;
  if (input.coefficient !== undefined && input.coefficient !== null && !coefficient) {
    errors.push("COEFFICIENT_INVALID");
  }
  if (coefficient && (coefficient.isNegative() || coefficient.greaterThan(1))) {
    errors.push("COEFFICIENT_INVALID");
  }

  const jurisdiction =
    typeof input.jurisdiction === "string" && input.jurisdiction.trim().length > 0
      ? input.jurisdiction.trim().toUpperCase()
      : null;

  const description = typeof input.description === "string" && input.description.trim().length > 0
    ? input.description.trim()
    : null;

  if (errors.length > 0) return { status: "ERROR", errors };

  return {
    status: "VALID",
    data: {
      activityCode,
      description,
      income: (income as Decimal).toFixed(4),
      jurisdiction,
      coefficient: coefficient ? coefficient.toFixed(6) : null,
    },
  };
}

/**
 * Procesa un lote de filas CM03 y devuelve normalizadas + totales.
 * Valida que la suma de coeficientes declarados sea 1.
 */
export function normalizeCm03Batch(
  rows: readonly Cm03ImportRow[],
): { rows: NormalizedRow<Cm03Row>[]; totals: ImportTotals } {
  let net = new Decimal(0);
  let valid = 0;
  let errors = 0;
  let coeffSum = new Decimal(0);
  let hasCoeff = false;

  const normalized = rows.map((row) => {
    const result = normalizeCm03Row(row);
    if (result.status === "VALID" && result.data) {
      if (result.data.coefficient !== null) {
        coeffSum = coeffSum.plus(result.data.coefficient);
        hasCoeff = true;
      } else {
        net = net.plus(result.data.income);
      }
      valid += 1;
    } else {
      errors += 1;
    }
    return result;
  });

  // Si hay coeficientes declarados y no suman 1, el lote es inválido.
  if (hasCoeff && !coeffSum.equals(1)) {
    return {
      rows: normalized.map((r) =>
        r.status === "VALID" && r.data && r.data.coefficient !== null
          ? { status: "ERROR" as const, errors: ["COEFFICIENT_SUM_INVALID"] }
          : r,
      ),
      totals: {
        net: net.toFixed(4),
        iva: "0",
        validRows: valid - 1,
        errorRows: errors + 1,
      },
    };
  }

  return {
    rows: normalized,
    totals: {
      net: net.toFixed(4),
      iva: "0",
      validRows: valid,
      errorRows: errors,
    },
  };
}

// ============================================================
// F1.2 — Adaptador F.931 (remuneraciones para Dto. 814)
//
// Formato esperado (columnas de F.931):
//   cuit | remuneracion | detraccion
// El importador calcula la remuneración neta (remuneración - detracción)
// y valida que la detracción no supere la remuneración.
// ============================================================

export interface F931Row {
  cuit: string;
  remuneration: string;
  deduction: string;
  netRemuneration: string;
}

export type F931Error = "CUIT_INVALID" | "REMUNERATION_INVALID" | "DEDUCTION_INVALID" | "DEDUCTION_EXCEEDS";

export interface F931Input {
  cuit?: unknown;
  remuneration?: unknown;
  deduction?: unknown;
}

export function normalizeF931Row(input: F931Input): NormalizedRow<F931Row> {
  const errors: F931Error[] = [];

  if (!isCuit(input.cuit)) errors.push("CUIT_INVALID");

  const remuneration = isDecimalString(input.remuneration) ? new Decimal(input.remuneration) : null;
  if (!remuneration) errors.push("REMUNERATION_INVALID");

  const deduction = isDecimalString(input.deduction) ? new Decimal(input.deduction) : new Decimal(0);
  if (deduction.isNegative()) errors.push("DEDUCTION_INVALID");

  if (remuneration && deduction.greaterThan(remuneration)) {
    errors.push("DEDUCTION_EXCEEDS");
  }

  if (errors.length > 0) {
    return { status: "ERROR", errors };
  }

  const net = (remuneration as Decimal).minus(deduction);
  return {
    status: "VALID",
    data: {
      cuit: input.cuit as string,
      remuneration: (remuneration as Decimal).toFixed(4),
      deduction: deduction.toFixed(4),
      netRemuneration: net.toFixed(4),
    },
  };
}

export function normalizeF931Batch(
  rows: readonly F931Input[],
): { rows: NormalizedRow<F931Row>[]; totals: ImportTotals } {
  let remuneration = new Decimal(0);
  let deduction = new Decimal(0);
  let valid = 0;
  let errors = 0;

  const normalized = rows.map((row) => {
    const result = normalizeF931Row(row);
    if (result.status === "VALID" && result.data) {
      remuneration = remuneration.plus(result.data.remuneration);
      deduction = deduction.plus(result.data.deduction);
      valid += 1;
    } else {
      errors += 1;
    }
    return result;
  });

  return {
    rows: normalized,
    totals: {
      net: remuneration.minus(deduction).toFixed(4),
      iva: "0",
      validRows: valid,
      errorRows: errors,
    },
  };
}
