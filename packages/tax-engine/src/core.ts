import { Decimal } from "decimal.js";
import { createHash } from "node:crypto";

/**
 * Núcleo determinista del motor fiscal.
 *
 * Reglas:
 * - Sin Prisma, sin HTTP, sin reloj global, sin efectos externos.
 * - El mismo conjunto de entradas produce exactamente la misma salida.
 * - Todos los cálculos usan Decimal (decimal.js), nunca float.
 * - El redondeo intermedio es explícito y configurabil por concepto.
 */

export type DecimalValue = InstanceType<typeof Decimal>;

export interface RoundingConfig {
  precision: number;
  mode: Decimal.Rounding;
}

export const MONEY: RoundingConfig = { precision: 2, mode: Decimal.ROUND_HALF_UP };
export const RATE: RoundingConfig = { precision: 6, mode: Decimal.ROUND_HALF_UP };

/** Convierte entradas a Decimal de forma segura. */
export function dec(value: string | number | Decimal): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(value);
}

/** Aplica redondeo a un importe. */
export function roundMoney(value: DecimalValue): DecimalValue {
  return value.toDecimalPlaces(MONEY.precision, MONEY.mode);
}

/** Formatea importe con precisión fija (ceros finales incluidos). */
export function fmtMoney(value: DecimalValue, precision = MONEY.precision): string {
  return value.toFixed(precision);
}

/** Serializa un objeto de forma canónica para hashing (determinista). */
export function canonicalSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (value instanceof Decimal) return `D:${value.toString()}`;
  if (value instanceof Date) return `D:${value.toISOString()}`;
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalSerialize((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 determinista sobre una entrada canónica. */
export function taxHash(input: unknown): string {
  return createHash("sha256").update(canonicalSerialize(input)).digest("hex");
}

/** Estado de una línea de cálculo, con trazabilidad de fórmula. */
export interface CalculationTraceLine {
  /** Código del concepto (p.ej. VENTAS_21). */
  concept: string;
  /** Fórmula legible usada para el cálculo. */
  formula: string;
  /** Entradas de la operación (bases, importes, tasas). */
  inputs: Record<string, string>;
  /** Resultado después de redondeo. */
  result: string;
}

export interface CalculationTrace {
  lines: CalculationTraceLine[];
  subtotals: Record<string, string>;
  total: string;
  warnings: string[];
  blocks: string[];
}

/** Firma estándar del motor: misma entrada → misma salida. */
export interface TaxEngineInput {
  /** Versión del motor que produce el resultado. */
  engineVersion: string;
  /** Período [start, end] y cutoff de hechos aprobados. */
  period: { startDate: string; endDate: string; cutoff: string };
  /** Hechos aprobados dentro del período y del cutoff. */
  facts: readonly TaxFact[];
  /** Reglas aplicables (con fuente y vigencia ya validadas). */
  rules: readonly TaxRule[];
  /** Identifica el contrato tipado de reglas sin cambiar las versiones legacy. */
  ruleMode?: "LEGACY" | "TYPED";
  /** Saldos y créditos previos. */
  balances?: {
    previousCredit?: string;
    previousDebit?: string;
    availableCredit?: string;
  };
  /** Redondeos por concepto (global por defecto). */
  rounding?: Partial<Record<string, RoundingConfig>>;
}

/** Hecho fiscal aprobado (voucher o línea oficial). */
export interface TaxFact {
  id: string;
  /** PURCHASE | SALE */
  direction: "PURCHASE" | "SALE";
  date: string;
  /** Base imponible por alícuota o concepto. */
  base: Decimal;
  /** Id del concepto (p.ej. "VENTAS", "COMPRAS", "EXENTO"). */
  concept: string;
  /** Moneda. */
  currency: string;
  /** Tipo de cambio al dólar funcional. */
  exchangeRate?: Decimal;
}

export interface TaxRule {
  id: string;
  concept: string;
  kind?: string;
  activityId?: string | null;
  jurisdictionId?: string | null;
  categoryCode?: string | null;
  isDefault?: boolean;
  /** Tasa aplicable (decimal, p.ej. 0.21). */
  rate?: Decimal;
  /** Mínimo a ingresar si aplica. */
  minimum?: Decimal;
  /** Escala: [desde, hasta, tasa, fijo]. */
  brackets?: ReadonlyArray<readonly [Decimal, Decimal | null, Decimal, Decimal | null]>;
  validFrom: string;
  validTo?: string;
  source?: string;
  /** Código de la regla (traza). */
  code: string;
}

/** Resultado del motor. */
export interface TaxEngineResult {
  engineVersion: string;
  lines: CalculationTraceLine[];
  subtotals: Record<string, string>;
  totalDue: string;
  credits: Record<string, string>;
  warnings: string[];
  blocks: string[];
  inputHash: string;
  outputHash: string;
}

/** Aplica redondeo por concepto (con fallback global). */
export function roundFor(
  value: Decimal,
  concept: string,
  config: Partial<RoundingConfig> = {},
): Decimal {
  const c = config.precision !== undefined ? (config as RoundingConfig) : MONEY;
  return value.toDecimalPlaces(c.precision, c.mode);
}

/** Multiplica base × tasa con redondeo de importe. */
export function applyRate(base: Decimal, rate: Decimal, cfg: RoundingConfig = MONEY): Decimal {
  return base.mul(rate).toDecimalPlaces(cfg.precision, cfg.mode);
}