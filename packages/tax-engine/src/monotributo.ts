import {
  dec,
  fmtMoney,
  roundFor,
  taxHash,
  type DecimalValue,
  type TaxEngineInput,
  type TaxEngineResult,
} from "./core.js";

/**
 * Motor Monotributo (AR_MONOTRIBUTO_V1).
 *
 * Determinista y puro: recibe la categoría vigente, los parámetros oficiales
 * versionados (cuota por categoría) y pagos del período; devuelve la cuota
 * aplicable, componentes, vencimiento y saldo.
 *
 * Reglas de negocio (según rule pack aprobado):
 * - La categoría se toma del perfil/registro vigente; el motor NO la inventa.
 * - La cuota mensual proviene de los parámetros oficiales versionados.
 * - Pagos del período se deducen de la cuota.
 * - Una sugerencia de recategorización queda pendiente de decisión profesional
 *   (se emite como advertencia, nunca se aplica automáticamente).
 */

export const MONOTRIBUTO_ENGINE_VERSION = "ar-monotributo-v1.0.0";

export interface MonotributoInput extends TaxEngineInput {
  /** Categoría vigente (p.ej. "A", "B", "C"...). */
  category: string;
  /** Parámetros oficiales: cuota por categoría (rule concept = categoría). */
  parameters?: {
    /** Cuota mensual por categoría. */
    monthlyFeeByCategory?: Record<string, string>;
  };
  /** Pagos del período. */
  payments?: {
    /** Importe ya pagado en el período. */
    paid: DecimalValue;
  };
  /** Vencimiento derivado (rule). */
  dueDate?: string;
}

export function calculateMonotributo(input: MonotributoInput): TaxEngineResult {
  const rounding = input.rounding ?? {};
  const rules = new Map(input.rules.map((r) => [r.concept, r]));
  const lines: TaxEngineResult["lines"] = [];
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!input.period.cutoff) {
    blocks.push("Se requiere un cutoff explícito para calcular Monotributo");
  }

  // --- Cuota por categoría ---
  const feeByCategory = input.parameters?.monthlyFeeByCategory ?? {};
  const feeStr = feeByCategory[input.category];
  let fee: DecimalValue;
  if (feeStr !== undefined) {
    fee = dec(feeStr);
  } else {
    // Fallback: regla con concept = categoría.
    const rule = rules.get(input.category);
    if (rule?.minimum !== undefined) {
      fee = rule.minimum;
    } else {
      blocks.push(`No hay cuota configurada para la categoría ${input.category}`);
      fee = dec(0);
    }
  }

  // --- Pagos ---
  const paid = input.payments?.paid ?? dec(0);

  const subtotals: Record<string, string> = {};
  subtotals["CATEGORIA"] = input.category;
  subtotals["CUOTA_MENSUAL"] = fmtMoney(roundFor(fee, "total", rounding.total));
  subtotals["PAGOS"] = fmtMoney(roundFor(paid, "pagos", rounding.pagos));

  // --- Determinación ---
  let netDue = fee.minus(paid);
  let remainingCredit = dec(0);
  if (netDue.isNegative()) {
    remainingCredit = netDue.abs();
    netDue = dec(0);
  }
  subtotals["TOTAL_A_INGRESAR"] = fmtMoney(roundFor(netDue, "total", rounding.total));
  subtotals["SALDO_A_FAVOR"] = fmtMoney(roundFor(remainingCredit, "saldos", rounding.saldos));
  if (input.dueDate) {
    subtotals["VENCIMIENTO"] = input.dueDate;
  }

  // --- Renglones de traza ---
  lines.push({
    concept: "CUOTA",
    formula: `cuota categoría ${input.category} = ${fmtMoney(fee)}`,
    inputs: { category: input.category, fee: fmtMoney(fee) },
    result: fmtMoney(fee),
  });
  lines.push({
    concept: "PAGOS",
    formula: `pagado en el período = ${fmtMoney(paid)}`,
    inputs: { paid: fmtMoney(paid) },
    result: fmtMoney(paid),
  });

  // --- Recategorización: nunca automática ---
  warnings.push("La recategorización queda pendiente de decisión profesional; el motor no la aplica");

  // --- Hashes (V-004 / determinismo) ---
  const inputHash = taxHash({
    engineVersion: MONOTRIBUTO_ENGINE_VERSION,
    period: input.period,
    category: input.category,
    parameters: input.parameters ?? null,
    payments: input.payments ? { paid: input.payments.paid.toString() } : null,
    dueDate: input.dueDate ?? null,
  });
  const outputHash = taxHash({
    inputHash,
    lines: lines.map((l) => ({ concept: l.concept, result: l.result })),
    subtotals,
    totalDue: fmtMoney(roundFor(netDue, "total", rounding.total)),
    credits: { remaining: fmtMoney(remainingCredit) },
    warnings,
    blocks,
  });

  return {
    engineVersion: MONOTRIBUTO_ENGINE_VERSION,
    lines,
    subtotals,
    totalDue: fmtMoney(roundFor(netDue, "total", rounding.total)),
    credits: { remaining: fmtMoney(remainingCredit) },
    warnings,
    blocks,
    inputHash,
    outputHash,
  };
}