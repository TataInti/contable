import {
  applyRate,
  dec,
  fmtMoney,
  roundFor,
  taxHash,
  type DecimalValue,
  type TaxEngineInput,
  type TaxEngineResult,
} from "./core.js";

/**
 * Motor TEM — Tasa de Actividades Económicas, San Miguel de Tucumán
 * (AR_TEM_SMT_V1).
 *
 * Determinista y puro: recibe ingresos por actividad, alícuotas, mínimo,
 * retenciones/percepciones y saldo anterior; devuelve renglones, subtotales,
 * total a ingresar y saldo.
 *
 * Reglas de negocio (según rule pack aprobado):
 * - Base imponible = ingresos del período por actividad (netos).
 * - Alícuota por actividad (nomenclador municipal SMT).
 * - Mínimo por actividad o global; si el cálculo por alícuota es menor al
 *   mínimo, se paga el mínimo.
 * - Retenciones y percepciones se deducen como créditos de la jurisdicción.
 * - Saldo a favor anterior se aplica al final.
 */

export const TEM_SMT_ENGINE_VERSION = "ar-tem-smt-v1.0.0";

export interface TemSmtInput extends TaxEngineInput {
  /** Ingresos por actividad (código del nomenclador → neto gravado). */
  incomeByActivity: Record<string, string>;
  /** Saldos y créditos previos del municipio. */
  balances?: {
    /** Saldo a favor anterior. */
    previousCredit?: string;
  };
  /** Créditos del período: retenciones y percepciones. */
  credits?: {
    /** Retenciones sufridas. */
    withholding: DecimalValue;
    /** Percepciones sufridas. */
    perception: DecimalValue;
  };
  /** Mínimo global del período si corresponde (rule). */
  minimum?: DecimalValue;
}

export function calculateTemSmt(input: TemSmtInput): TaxEngineResult {
  const rounding = input.rounding ?? {};
  const rules = new Map(input.rules.map((r) => [r.concept, r]));
  const lines: TaxEngineResult["lines"] = [];
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!input.period.cutoff) {
    blocks.push("Se requiere un cutoff explícito para calcular TEM San Miguel de Tucumán");
  }

  // --- Base por actividad: ingreso × tasa ---
  const activityLines: Array<{ activity: string; base: DecimalValue; rate: DecimalValue; tax: DecimalValue }> = [];
  let totalBase = dec(0);
  for (const [activity, incomeStr] of Object.entries(input.incomeByActivity)) {
    const income = dec(incomeStr);
    totalBase = totalBase.plus(income);
    const rule = rules.get(activity);
    const rate = rule?.rate !== undefined ? rule.rate : rules.get("DEFAULT")?.rate;
    if (rate === undefined) {
      warnings.push(`Actividad ${activity} sin alícuota configurada; se omitió`);
      continue;
    }
    const tax = applyRate(income, rate);
    activityLines.push({ activity, base: income, rate, tax });
  }
  if (activityLines.length === 0) {
    warnings.push("No se declararon ingresos gravados por actividad");
  }

  // --- Renglón total por alícuota ---
  let totalByRate = dec(0);
  for (const line of activityLines) {
    totalByRate = totalByRate.plus(line.tax);
  }
  totalByRate = roundFor(totalByRate, "TOTAL", rounding.TOTAL);

  // --- Mínimo ---
  const minimum = input.minimum !== undefined ? input.minimum : rules.get("MINIMO")?.minimum;
  let amountDue: DecimalValue;
  let appliedMinimum = false;
  if (minimum !== undefined && totalByRate.lessThan(minimum)) {
    amountDue = minimum;
    appliedMinimum = true;
  } else {
    amountDue = totalByRate;
  }

  // --- Créditos ---
  const withholding = input.credits?.withholding ?? dec(0);
  const perception = input.credits?.perception ?? dec(0);
  const previousCredit = input.balances?.previousCredit ? dec(input.balances.previousCredit) : dec(0);

  const subtotals: Record<string, string> = {};
  subtotals["BASE_TOTAL"] = fmtMoney(roundFor(totalBase, "base", rounding.base));
  subtotals["IMPUESTO_POR_ACTIVIDAD"] = fmtMoney(roundFor(totalByRate, "total", rounding.total));
  if (appliedMinimum) {
    subtotals["MINIMO_APLICADO"] = fmtMoney(roundFor(minimum!, "total", rounding.total));
  }
  subtotals["RETENCIONES"] = fmtMoney(roundFor(withholding, "retenciones", rounding.retenciones));
  subtotals["PERCEPCIONES"] = fmtMoney(roundFor(perception, "percepciones", rounding.percepciones));
  subtotals["SALDO_ANTERIOR"] = fmtMoney(roundFor(previousCredit, "saldos", rounding.saldos));

  // --- Determinación ---
  const deductions = withholding.plus(perception).plus(previousCredit);
  let netDue = amountDue.minus(deductions);
  let remainingCredit = dec(0);
  if (netDue.isNegative()) {
    remainingCredit = netDue.abs();
    netDue = dec(0);
  }
  subtotals["TOTAL_A_INGRESAR"] = fmtMoney(roundFor(netDue, "total", rounding.total));
  subtotals["SALDO_A_FAVOR"] = fmtMoney(roundFor(remainingCredit, "saldos", rounding.saldos));

  // --- Renglones de traza ---
  for (const line of activityLines) {
    lines.push({
      concept: `ACTIVIDAD_${line.activity}`,
      formula: `ingresos(${fmtMoney(line.base)}) × alícuota ${line.rate} = ${fmtMoney(line.tax)}`,
      inputs: { activity: line.activity, base: fmtMoney(line.base), rate: line.rate.toString(), tax: fmtMoney(line.tax) },
      result: fmtMoney(line.tax),
    });
  }
  if (appliedMinimum) {
    lines.push({
      concept: "MINIMO",
      formula: `aplicado mínimo ${fmtMoney(minimum!)}`,
      inputs: { minimum: fmtMoney(minimum!) },
      result: fmtMoney(minimum!),
    });
  }
  for (const [concept, value] of [
    ["RETENCION", withholding],
    ["PERCEPCION", perception],
  ] as const) {
    lines.push({
      concept,
      formula: "crédito sobre impuesto",
      inputs: {},
      result: fmtMoney(value),
    });
  }

  // --- Hashes (V-004 / determinismo) ---
  const inputHash = taxHash({
    engineVersion: TEM_SMT_ENGINE_VERSION,
    period: input.period,
    incomeByActivity: input.incomeByActivity,
    rules: input.rules.map((r) => ({ concept: r.concept, rate: r.rate?.toString(), validFrom: r.validFrom })),
    credits: input.credits
      ? {
          withholding: input.credits.withholding.toString(),
          perception: input.credits.perception.toString(),
        }
      : null,
    balances: input.balances ?? null,
    minimum: input.minimum?.toString() ?? null,
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
    engineVersion: TEM_SMT_ENGINE_VERSION,
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