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
 * Motor IIBB — Convenio Multilateral CM03 artículo 2 (AR_IIBB_CM_ART2_V1).
 *
 * Determinista y puro: recibe base país por actividad, coeficiente unificado
 * por jurisdicción, retenciones/percepciones por jurisdicción y saldos
 * anteriores; distribuye la base por jurisdicción y devuelve renglones,
 * subtotales, total a ingresar y saldo.
 *
 * Reglas de negocio (según rule pack aprobado):
 * - Base país = ingresos gravados del período por actividad.
 * - Coeficiente unificado por jurisdicción (suma debe ser 1).
 * - Base por jurisdicción = base país × coeficiente.
 * - Alícuota por jurisdicción (o DEFAULT).
 * - Retenciones y percepciones se deducen SÓLO de la jurisdicción correcta.
 * - Saldo a favor anterior se aplica al final.
 * - Regímenes especiales quedan bloqueados (NO SOPORTADO).
 */

export const CM03_ENGINE_VERSION = "ar-iibb-cm-art2-v1.0.0";

export interface Cm03Input extends TaxEngineInput {
  /** Base país por actividad (código → neto gravado). */
  incomeByActivity: Record<string, string>;
  /** Coeficiente unificado por jurisdicción (código → 0..1). */
  coefficients: Record<string, string>;
  /** Saldos y créditos previos por jurisdicción. */
  cmBalances?: {
    /** Saldo a favor anterior por jurisdicción. */
    previousCreditByJurisdiction?: Record<string, string>;
  };
  /** Créditos del período por jurisdicción. */
  credits?: {
    /** Retenciones sufridas por jurisdicción. */
    withholdingByJurisdiction?: Record<string, DecimalValue>;
    /** Percepciones sufridas por jurisdicción. */
    perceptionByJurisdiction?: Record<string, DecimalValue>;
  };
}

export function calculateCm03(input: Cm03Input): TaxEngineResult {
  const rounding = input.rounding ?? {};
  const rules = new Map(input.rules.map((r) => [r.concept, r]));
  const lines: TaxEngineResult["lines"] = [];
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!input.period.cutoff) {
    blocks.push("Se requiere un cutoff explícito para calcular CM03 artículo 2");
  }

  // --- Base país por actividad ---
  let totalBase = dec(0);
  for (const incomeStr of Object.values(input.incomeByActivity)) {
    totalBase = totalBase.plus(dec(incomeStr));
  }

  // --- Coeficientes: validar suma = 1 ---
  const coeffEntries = Object.entries(input.coefficients);
  if (coeffEntries.length === 0) {
    blocks.push("No se declararon coeficientes por jurisdicción");
  }
  let coeffSum = dec(0);
  for (const c of coeffEntries) {
    coeffSum = coeffSum.plus(dec(c[1]));
  }
  if (!coeffSum.equals(1)) {
    blocks.push(`La suma de coeficientes es ${coeffSum.toString()}; debe ser 1`);
  }

  // --- Distribución por jurisdicción ---
  const jurisdictionLines: Array<{
    jurisdiction: string;
    base: DecimalValue;
    rate: DecimalValue;
    tax: DecimalValue;
  }> = [];
  for (const [jurisdiction, coeffStr] of coeffEntries) {
    const coeff = dec(coeffStr);
    const base = totalBase.mul(coeff);
    const rule = rules.get(jurisdiction);
    const rate = rule?.rate !== undefined ? rule.rate : rules.get("DEFAULT")?.rate;
    if (rate === undefined) {
      warnings.push(`Jurisdicción ${jurisdiction} sin alícuota configurada; se omitió`);
      continue;
    }
    const tax = applyRate(base, rate);
    jurisdictionLines.push({ jurisdiction, base, rate, tax });
  }

  // --- Renglón total por alícuota ---
  let totalByRate = dec(0);
  for (const line of jurisdictionLines) {
    totalByRate = totalByRate.plus(line.tax);
  }
  totalByRate = roundFor(totalByRate, "TOTAL", rounding.TOTAL);

  // --- Créditos por jurisdicción ---
  const withholdingByJurisdiction = input.credits?.withholdingByJurisdiction ?? {};
  const perceptionByJurisdiction = input.credits?.perceptionByJurisdiction ?? {};
  const previousCreditByJurisdiction = input.cmBalances?.previousCreditByJurisdiction ?? {};

  const subtotals: Record<string, string> = {};
  subtotals["BASE_PAIS"] = fmtMoney(roundFor(totalBase, "base", rounding.base));
  subtotals["IMPUESTO_POR_JURISDICCION"] = fmtMoney(roundFor(totalByRate, "total", rounding.total));

  let totalWithholding = dec(0);
  let totalPerception = dec(0);
  let totalPrevious = dec(0);
  for (const line of jurisdictionLines) {
    const w = withholdingByJurisdiction[line.jurisdiction] ?? dec(0);
    const p = perceptionByJurisdiction[line.jurisdiction] ?? dec(0);
    const prevStr = previousCreditByJurisdiction[line.jurisdiction];
    const prev = prevStr ? dec(prevStr) : dec(0);
    totalWithholding = totalWithholding.plus(w);
    totalPerception = totalPerception.plus(p);
    totalPrevious = totalPrevious.plus(prev);
  }
  subtotals["RETENCIONES"] = fmtMoney(roundFor(totalWithholding, "retenciones", rounding.retenciones));
  subtotals["PERCEPCIONES"] = fmtMoney(roundFor(totalPerception, "percepciones", rounding.percepciones));
  subtotals["SALDO_ANTERIOR"] = fmtMoney(roundFor(totalPrevious, "saldos", rounding.saldos));

  // --- Determinación ---
  const deductions = totalWithholding.plus(totalPerception).plus(totalPrevious);
  let netDue = totalByRate.minus(deductions);
  let remainingCredit = dec(0);
  if (netDue.isNegative()) {
    remainingCredit = netDue.abs();
    netDue = dec(0);
  }
  subtotals["TOTAL_A_INGRESAR"] = fmtMoney(roundFor(netDue, "total", rounding.total));
  subtotals["SALDO_A_FAVOR"] = fmtMoney(roundFor(remainingCredit, "saldos", rounding.saldos));

  // --- Renglones de traza ---
  for (const line of jurisdictionLines) {
    lines.push({
      concept: `JURISDICCION_${line.jurisdiction}`,
      formula: `base(${fmtMoney(line.base)}) × alícuota ${line.rate} = ${fmtMoney(line.tax)}`,
      inputs: { jurisdiction: line.jurisdiction, base: fmtMoney(line.base), rate: line.rate.toString(), tax: fmtMoney(line.tax) },
      result: fmtMoney(line.tax),
    });
  }
  for (const [concept, value] of [
    ["RETENCION", totalWithholding],
    ["PERCEPCION", totalPerception],
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
    engineVersion: CM03_ENGINE_VERSION,
    period: input.period,
    incomeByActivity: input.incomeByActivity,
    coefficients: input.coefficients,
    rules: input.rules.map((r) => ({ concept: r.concept, rate: r.rate?.toString(), validFrom: r.validFrom })),
    credits: input.credits ?? null,
    balances: input.cmBalances ?? null,
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
    engineVersion: CM03_ENGINE_VERSION,
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