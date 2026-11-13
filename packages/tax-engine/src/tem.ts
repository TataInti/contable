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
import type { LocalTaxDeclaredParameter } from "./iibb.js";

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

export const TEM_SMT_LEGACY_ENGINE_VERSION = "ar-tem-smt-v1.0.0";
export const TEM_SMT_ENGINE_VERSION = "ar-tem-smt-v1.1.0";

export interface TemSmtInput extends TaxEngineInput {
  /** Ingresos por actividad (código del nomenclador → neto gravado). */
  incomeByActivity: Record<string, string>;
  /**
   * Modo de aplicación del mínimo. El modo vigente suma el mínimo de cada
   * actividad y después aplica el mínimo global ("SUM_BY_ACTIVITY"). La
   * hipótesis alternativa de la ordenanza (total de actividades no inferior
   * al mínimo de mayor rendimiento fiscal) se expresa con "HIGHEST_YIELD".
   * El valor por defecto conserva el comportamiento existente.
   */
  minimumMode?: TemMinimumMode;
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
  /** Parámetros declarados por los archivos municipales, usados como control. */
  declaredParameters?: readonly LocalTaxDeclaredParameter[];
}

export type TemMinimumMode = "SUM_BY_ACTIVITY" | "HIGHEST_YIELD";

export function calculateTemSmt(input: TemSmtInput): TaxEngineResult {
  const engineVersion =
    input.engineVersion === TEM_SMT_LEGACY_ENGINE_VERSION
      ? TEM_SMT_LEGACY_ENGINE_VERSION
      : TEM_SMT_ENGINE_VERSION;
  const strict = engineVersion === TEM_SMT_ENGINE_VERSION;
  const typed = input.ruleMode === "TYPED";
  const minimumMode = input.minimumMode ?? "SUM_BY_ACTIVITY";
  const rounding = input.rounding ?? {};
  const rules = new Map(input.rules.map((r) => [r.concept, r]));
  const typedRulesByActivity = new Map(
    input.rules
      .filter((rule) => rule.kind === "RATE" && rule.activityId)
      .map((rule) => [rule.activityId!, rule]),
  );
  const typedDefaultRule = input.rules.find((rule) => rule.kind === "RATE" && rule.isDefault);
  const lines: TaxEngineResult["lines"] = [];
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!input.period.cutoff) {
    blocks.push("Se requiere un cutoff explícito para calcular TEM San Miguel de Tucumán");
  }

  // --- Base por actividad: ingreso × tasa ---
  const activityLines: Array<{
    activity: string;
    base: DecimalValue;
    rate: DecimalValue;
    tax: DecimalValue;
    determinedTax: DecimalValue;
    minimum?: DecimalValue;
  }> = [];
  let totalBase = dec(0);
  const activityEntries = Object.entries(input.incomeByActivity);
  if (strict) activityEntries.sort(([left], [right]) => left.localeCompare(right));
  for (const [activity, incomeStr] of activityEntries) {
    const income = dec(incomeStr);
    totalBase = totalBase.plus(income);
    const rule = typed
      ? activity === ""
        ? typedDefaultRule
        : typedRulesByActivity.get(activity)
      : rules.get(activity);
    const fallbackRule = typed ? typedDefaultRule : rules.get("DEFAULT");
    const rate = rule?.rate !== undefined ? rule.rate : fallbackRule?.rate;
    if (rate === undefined) {
      const message = `Actividad ${activity} sin alícuota configurada; se omitió`;
      if (strict) blocks.push(message);
      else warnings.push(message);
      continue;
    }
    const tax = applyRate(income, rate);
    const activityMinimum = strict ? rule?.minimum : undefined;
    const appliesActivityMinimum = strict && minimumMode === "SUM_BY_ACTIVITY";
    const determinedTax =
      appliesActivityMinimum &&
      activityMinimum !== undefined &&
      income.isPositive() &&
      tax.lessThan(activityMinimum)
        ? activityMinimum
        : tax;
    activityLines.push({
      activity,
      base: income,
      rate,
      tax,
      determinedTax,
      ...(activityMinimum !== undefined ? { minimum: activityMinimum } : {}),
    });
  }
  if (activityLines.length === 0) {
    warnings.push("No se declararon ingresos gravados por actividad");
  }

  // --- Renglón total por alícuota ---
  let totalByRate = dec(0);
  let totalAfterActivityMinimums = dec(0);
  for (const line of activityLines) {
    totalByRate = totalByRate.plus(line.tax);
    totalAfterActivityMinimums = totalAfterActivityMinimums.plus(line.determinedTax);
  }
  totalByRate = roundFor(totalByRate, "TOTAL", rounding.TOTAL);
  totalAfterActivityMinimums = roundFor(
    totalAfterActivityMinimums,
    "TOTAL",
    rounding.TOTAL,
  );

  // --- Mínimo ---
  const minimum = input.minimum !== undefined
    ? input.minimum
    : typed
      ? undefined
      : rules.get("MINIMO")?.minimum;
  const highestYieldMinimum = minimumMode === "HIGHEST_YIELD"
    ? activityLines.reduce<DecimalValue | undefined>((highest, line) => {
        if (line.minimum === undefined) return highest;
        return highest === undefined || line.minimum.greaterThan(highest)
          ? line.minimum
          : highest;
      }, minimum)
    : minimum;
  const effectiveMinimum = highestYieldMinimum;
  let amountDue: DecimalValue;
  let appliedMinimum = false;
  const amountBeforeGlobalMinimum =
    strict && minimumMode === "SUM_BY_ACTIVITY" ? totalAfterActivityMinimums : totalByRate;
  if (effectiveMinimum !== undefined && amountBeforeGlobalMinimum.lessThan(effectiveMinimum)) {
    amountDue = effectiveMinimum;
    appliedMinimum = true;
  } else {
    amountDue = amountBeforeGlobalMinimum;
  }

  if (strict) {
    const mismatches = new Set<string>();
    for (const declared of [...(input.declaredParameters ?? [])].sort((left, right) =>
      `${left.activity}:${left.sourceId}`.localeCompare(`${right.activity}:${right.sourceId}`),
    )) {
      const rule = typed
        ? declared.activity === ""
          ? typedDefaultRule
          : typedRulesByActivity.get(declared.activity)
        : rules.get(declared.activity) ?? rules.get("DEFAULT");
      if (declared.rate !== undefined) {
        const sourceRate = dec(declared.rate).div(100);
        if (rule?.rate === undefined || !sourceRate.equals(rule.rate)) {
          mismatches.add(
            `La alícuota declarada para ${declared.activity} (${declared.rate}%) no coincide con la regla versionada`,
          );
        }
      }
      if (declared.minimum !== undefined) {
        const configuredMinimum = rule?.minimum ?? minimum;
        if (
          configuredMinimum === undefined ||
          !dec(declared.minimum).equals(configuredMinimum)
        ) {
          mismatches.add(
            `El mínimo declarado para ${declared.activity} (${fmtMoney(dec(declared.minimum))}) no coincide con la regla versionada`,
          );
        }
      }
    }
    blocks.push(...mismatches);
  }

  // --- Créditos ---
  const withholding = input.credits?.withholding ?? dec(0);
  const perception = input.credits?.perception ?? dec(0);
  const previousCredit = input.balances?.previousCredit ? dec(input.balances.previousCredit) : dec(0);

  const subtotals: Record<string, string> = {};
  subtotals["BASE_TOTAL"] = fmtMoney(roundFor(totalBase, "base", rounding.base));
  subtotals["IMPUESTO_POR_ACTIVIDAD"] = fmtMoney(roundFor(totalByRate, "total", rounding.total));
  if (strict) {
    subtotals["IMPUESTO_DETERMINADO"] = fmtMoney(
      roundFor(amountDue, "total", rounding.total),
    );
  }
  if (appliedMinimum) {
    subtotals["MINIMO_APLICADO"] = fmtMoney(roundFor(effectiveMinimum!, "total", rounding.total));
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
    const activityMinimumApplied = line.determinedTax.greaterThan(line.tax);
    lines.push({
      concept: `ACTIVIDAD_${line.activity}`,
      formula: activityMinimumApplied
        ? `max(ingresos(${fmtMoney(line.base)}) × alícuota ${line.rate}, mínimo ${fmtMoney(line.minimum!)})`
        : `ingresos(${fmtMoney(line.base)}) × alícuota ${line.rate} = ${fmtMoney(line.tax)}`,
      inputs: {
        activity: line.activity,
        base: fmtMoney(line.base),
        rate: line.rate.toString(),
        tax: fmtMoney(line.tax),
        ...(line.minimum !== undefined ? { minimum: fmtMoney(line.minimum) } : {}),
      },
      result: fmtMoney(line.determinedTax),
    });
  }
  if (appliedMinimum) {
    lines.push({
      concept: "MINIMO",
      formula:
        minimumMode === "HIGHEST_YIELD"
          ? `aplicado mínimo de mayor rendimiento fiscal ${fmtMoney(effectiveMinimum!)}`
          : `aplicado mínimo ${fmtMoney(effectiveMinimum!)}`,
      inputs: { minimum: fmtMoney(effectiveMinimum!) },
      result: fmtMoney(effectiveMinimum!),
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
    engineVersion,
    period: input.period,
    incomeByActivity: input.incomeByActivity,
    rules: input.rules.map((r) => ({
      concept: r.concept,
      rate: r.rate?.toString(),
      validFrom: r.validFrom,
      ...(typed
        ? { kind: r.kind ?? null, activityId: r.activityId ?? null, isDefault: r.isDefault ?? false }
        : {}),
    })),
    ...(typed ? { ruleMode: "TYPED" as const } : {}),
    ...(minimumMode === "HIGHEST_YIELD" ? { minimumMode } : {}),
    credits: input.credits
      ? {
          withholding: input.credits.withholding.toString(),
          perception: input.credits.perception.toString(),
        }
      : null,
    balances: input.balances ?? null,
    minimum: input.minimum?.toString() ?? null,
    declaredParameters: strict ? input.declaredParameters ?? [] : null,
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
    engineVersion,
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
