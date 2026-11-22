
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
 * Motor IIBB — Contribuyente Local Tucumán (AR_IIBB_TUC_LOCAL_V1).
 *
 * Determinista y puro: recibe ingresos por actividad, alícuotas, mínimos,
 * retenciones/percepciones/recaudaciones (RPI) y saldo anterior; devuelve
 * renglones, subtotales, total a ingresar y saldo.
 *
 * Reglas de negocio (según rule pack aprobado):
 * - Base imponible = ingresos del período por actividad (netos).
 * - Alícuota por actividad (nomenclador DGR Tucumán).
 * - Mínimo por actividad o global según rule pack; si el cálculo por
 *   alícuota es menor al mínimo, se paga el mínimo.
 * - Retenciones, percepciones y recaudaciones (RPI) se deducen como
 *   créditos SÓLO de la jurisdicción correcta.
 * - Saldo a favor anterior se aplica al final.
 */

export const IIBB_TUC_LEGACY_ENGINE_VERSION = "ar-iibb-tuc-local-v1.0.0";
/** Versión 1.1.0: liquidaciones ya calculadas; conserva su comportamiento. */
export const IIBB_TUC_PREVIOUS_ENGINE_VERSION = "ar-iibb-tuc-local-v1.1.0";
/** Versión vigente: base negativa con tributo 0 y sin saldo a favor (brief 4E, regla 3). */
export const IIBB_TUC_ENGINE_VERSION = "ar-iibb-tuc-local-v1.2.0";

export interface LocalTaxDeclaredParameter {
  sourceId: string;
  activity: string;
  /** Alícuota informada por la fuente, expresada en puntos porcentuales. */
  rate?: string;
  /** Mínimo informado por la fuente para controlar contra el rule pack. */
  minimum?: string;
}

export interface IibbTucInput extends TaxEngineInput {
  /** Ingresos por actividad (código del nomenclador → neto gravado). */
  incomeByActivity: Record<string, string>;
  /** Saldos y créditos previos de la provincia. */
  balances?: {
    /** Saldo a favor anterior (libre disponibilidad local). */
    previousCredit?: string;
  };
  /** Créditos del período: retenciones, percepciones, recaudaciones. */
  credits?: {
    /** Retenciones sufridas (RPI). */
    withholding: DecimalValue;
    /** Percepciones sufridas. */
    perception: DecimalValue;
    /** Recaudaciones bancarias / tarjetas (RBC). */
    collected: DecimalValue;
    /** Otros créditos revisados del período. */
    other?: DecimalValue;
  };
  /** Mínimo global del período si corresponde (rule). */
  minimum?: DecimalValue;
  /**
   * Mínimo no imponible (simulador «Probar», corte 4C): se resta de la base antes de
   * aplicar la alícuota, en orden de actividad hasta agotarse. Sin valor, el cálculo
   * no cambia. La liquidación mensual no lo informa.
   */
  nonTaxableMinimum?: DecimalValue;
  /** Parámetros declarados por los archivos oficiales, usados como control. */
  declaredParameters?: readonly LocalTaxDeclaredParameter[];
  /**
   * Reglas versionadas contra las que se controlan los parámetros declarados.
   * Si faltan, el control usa `rules`. El mínimo libre del mes no entra en el control.
   */
  controlRules?: IibbTucInput["rules"];
  /** Mínimo versionado para el control (null: el paquete no tiene). Si falta, el control usa `minimum`. */
  controlMinimum?: DecimalValue | null;
}

export function calculateIIbbTuc(input: IibbTucInput): TaxEngineResult {
  const engineVersion =
    input.engineVersion === IIBB_TUC_LEGACY_ENGINE_VERSION ||
    input.engineVersion === IIBB_TUC_PREVIOUS_ENGINE_VERSION
      ? input.engineVersion
      : IIBB_TUC_ENGINE_VERSION;
  const strict = engineVersion !== IIBB_TUC_LEGACY_ENGINE_VERSION;
  // Regla 3 del brief 4E: solo la versión vigente anula el tributo por base negativa.
  const floorsNegativeBase = engineVersion === IIBB_TUC_ENGINE_VERSION;
  const typed = input.ruleMode === "TYPED";
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
    blocks.push("Se requiere un cutoff explícito para calcular IIBB Tucumán");
  }

  // --- Base por actividad: ingreso × tasa ---
  const activityLines: Array<{
    activity: string;
    base: DecimalValue;
    deducted: DecimalValue;
    taxableBase: DecimalValue;
    rate: DecimalValue;
    tax: DecimalValue;
    determinedTax: DecimalValue;
    defaultApplied: boolean;
    minimum?: DecimalValue;
  }> = [];
  let totalBase = dec(0);
  // Mínimo no imponible: se reparte en orden de actividad (solo sobre ingresos positivos).
  let remainingNonTaxable: DecimalValue | undefined =
    input.nonTaxableMinimum !== undefined ? dec(input.nonTaxableMinimum) : undefined;
  let totalNonTaxableApplied = dec(0);
  let totalTaxableBase = dec(0);
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
    const defaultApplied = typed && fallbackRule?.rate !== undefined &&
      (activity === "" || rule?.rate === undefined);
    if (rate === undefined) {
      const message = `Actividad ${activity} sin alícuota configurada; se omitió`;
      if (strict) blocks.push(message);
      else warnings.push(message);
      continue;
    }
    const deducted =
      remainingNonTaxable !== undefined && income.isPositive() && remainingNonTaxable.isPositive()
        ? (income.lessThan(remainingNonTaxable) ? income : remainingNonTaxable)
        : dec(0);
    if (remainingNonTaxable !== undefined) {
      remainingNonTaxable = remainingNonTaxable.minus(deducted);
      totalNonTaxableApplied = totalNonTaxableApplied.plus(deducted);
    }
    const taxableBase = income.minus(deducted);
    totalTaxableBase = totalTaxableBase.plus(taxableBase);
    const tax = applyRate(taxableBase, rate);
    const activityMinimum = strict && !typed ? rule?.minimum : undefined;
    const determinedTax =
      activityMinimum !== undefined && taxableBase.isPositive() && tax.lessThan(activityMinimum)
        ? activityMinimum
        : tax;
    activityLines.push({
      activity,
      base: income,
      deducted,
      taxableBase,
      rate,
      tax,
      determinedTax,
      defaultApplied,
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
  let amountDue: DecimalValue;
  let appliedMinimum = false;
  const amountBeforeGlobalMinimum = strict ? totalAfterActivityMinimums : totalByRate;
  if (floorsNegativeBase && totalBase.isNegative()) {
    warnings.push(
      "Base negativa: las notas de crédito superan las ventas del período; el tributo queda en 0 y el excedente no pasa a saldo a favor",
    );
    amountDue = dec(0);
  } else if (minimum !== undefined && amountBeforeGlobalMinimum.lessThan(minimum)) {
    amountDue = minimum;
    appliedMinimum = true;
  } else {
    amountDue = amountBeforeGlobalMinimum;
  }

  if (strict) {
    const mismatches = new Set<string>();
    const controlList = input.controlRules ?? input.rules;
    const controlRules = new Map(controlList.map((r) => [r.concept, r]));
    const controlTypedByActivity = new Map(
      controlList
        .filter((rule) => rule.kind === "RATE" && rule.activityId)
        .map((rule) => [rule.activityId!, rule]),
    );
    const controlTypedDefault = controlList.find((rule) => rule.kind === "RATE" && rule.isDefault);
    const versionedMinimum =
      input.controlMinimum !== undefined ? input.controlMinimum ?? undefined : minimum;
    for (const declared of [...(input.declaredParameters ?? [])].sort((left, right) =>
      `${left.activity}:${left.sourceId}`.localeCompare(`${right.activity}:${right.sourceId}`),
    )) {
      const rule = typed
        ? controlTypedByActivity.get(declared.activity) ?? controlTypedDefault
        : controlRules.get(declared.activity) ?? controlRules.get("DEFAULT");
      if (declared.rate !== undefined) {
        const sourceRate = dec(declared.rate).div(100);
        if (rule?.rate === undefined || !sourceRate.equals(rule.rate)) {
          mismatches.add(
            `La alícuota declarada para ${declared.activity} (${declared.rate}%) no coincide con la regla versionada`,
          );
        }
      }
      if (declared.minimum !== undefined) {
        const configuredMinimum = rule?.minimum ?? versionedMinimum;
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

  // --- Créditos (RPI) ---
  const withholding = input.credits?.withholding ?? dec(0);
  const perception = input.credits?.perception ?? dec(0);
  const collected = input.credits?.collected ?? dec(0);
  const other = strict ? input.credits?.other ?? dec(0) : dec(0);
  const previousCredit = input.balances?.previousCredit ? dec(input.balances.previousCredit) : dec(0);

  const subtotals: Record<string, string> = {};
  subtotals["BASE_TOTAL"] = fmtMoney(roundFor(totalBase, "base", rounding.base));
  if (remainingNonTaxable !== undefined) {
    subtotals["MINIMO_NO_IMPONIBLE"] = fmtMoney(
      roundFor(totalNonTaxableApplied, "base", rounding.base),
    );
    subtotals["BASE_IMPONIBLE"] = fmtMoney(roundFor(totalTaxableBase, "base", rounding.base));
    if (remainingNonTaxable.isPositive()) {
      warnings.push(
        "El mínimo no imponible supera la base del período: se resta hasta el total de la base y el impuesto queda en cero",
      );
    }
  }
  subtotals["IMPUESTO_POR_ACTIVIDAD"] = fmtMoney(roundFor(totalByRate, "total", rounding.total));
  if (strict) {
    subtotals["IMPUESTO_DETERMINADO"] = fmtMoney(
      roundFor(amountDue, "total", rounding.total),
    );
  }
  if (appliedMinimum) {
    subtotals["MINIMO_APLICADO"] = fmtMoney(roundFor(minimum!, "total", rounding.total));
  }
  subtotals["RETENCIONES"] = fmtMoney(roundFor(withholding, "retenciones", rounding.retenciones));
  subtotals["PERCEPCIONES"] = fmtMoney(roundFor(perception, "percepciones", rounding.percepciones));
  subtotals["RECAUDACIONES"] = fmtMoney(roundFor(collected, "recaudaciones", rounding.recaudaciones));
  if (strict) {
    subtotals["OTROS_CREDITOS"] = fmtMoney(
      roundFor(other, "otros_creditos", rounding.otros_creditos),
    );
  }
  subtotals["SALDO_ANTERIOR"] = fmtMoney(roundFor(previousCredit, "saldos", rounding.saldos));

  // --- Determinación ---
  const deductions = withholding.plus(perception).plus(collected).plus(other).plus(previousCredit);
  let netDue = amountDue.minus(deductions);
  let remainingCredit = dec(0);
  if (netDue.isNegative()) {
    remainingCredit = netDue.abs();
    netDue = dec(0);
  }
  subtotals["TOTAL_A_INGRESAR"] = fmtMoney(roundFor(netDue, "total", rounding.total));
  subtotals["SALDO_A_FAVOR"] = fmtMoney(roundFor(remainingCredit, "saldos", rounding.saldos));

  // --- Renglones de traza ---
  if (remainingNonTaxable !== undefined) {
    lines.push({
      concept: "MINIMO_NO_IMPONIBLE",
      formula: `base ${fmtMoney(totalBase)} − mínimo no imponible ${fmtMoney(totalNonTaxableApplied)} = base imponible ${fmtMoney(totalTaxableBase)}`,
      inputs: {
        base: fmtMoney(totalBase),
        nonTaxable: fmtMoney(totalNonTaxableApplied),
        taxableBase: fmtMoney(totalTaxableBase),
      },
      result: fmtMoney(totalNonTaxableApplied),
    });
  }
  for (const line of activityLines) {
    const activityMinimumApplied = line.determinedTax.greaterThan(line.tax);
    const taxableText = line.deducted.isPositive()
      ? `(ingresos(${fmtMoney(line.base)}) − no imponible(${fmtMoney(line.deducted)}))`
      : `ingresos(${fmtMoney(line.base)})`;
    lines.push({
      concept: `ACTIVIDAD_${line.activity}`,
      formula: activityMinimumApplied
        ? `max(${taxableText} × alícuota ${line.rate}, mínimo ${fmtMoney(line.minimum!)})`
        : `${taxableText} × alícuota ${line.rate} = ${fmtMoney(line.tax)}`,
      inputs: {
        activity: line.activity,
        base: fmtMoney(line.base),
        ...(line.deducted.isPositive()
          ? { nonTaxable: fmtMoney(line.deducted), taxableBase: fmtMoney(line.taxableBase) }
          : {}),
        rate: line.rate.toString(),
        tax: fmtMoney(line.tax),
        ...(typed ? { defaultRuleApplied: String(line.defaultApplied) } : {}),
        ...(line.minimum !== undefined ? { minimum: fmtMoney(line.minimum) } : {}),
      },
      result: fmtMoney(line.determinedTax),
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
    ["RECAUDACION", collected],
    ...(strict ? ([ ["OTRO_CREDITO", other] ] as const) : []),
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
    ...(typed ? { ruleMode: "TYPED" } : {}),
    incomeByActivity: input.incomeByActivity,
    rules: input.rules.map((r) => typed
      ? {
          kind: r.kind,
          activityId: r.activityId ?? null,
          jurisdictionId: r.jurisdictionId ?? null,
          categoryCode: r.categoryCode ?? null,
          isDefault: r.isDefault ?? false,
          rate: r.rate?.toString(),
          minimum: r.minimum?.toString(),
          validFrom: r.validFrom,
        }
      : { concept: r.concept, rate: r.rate?.toString(), validFrom: r.validFrom }),
    credits: input.credits
      ? {
          withholding: input.credits.withholding.toString(),
          perception: input.credits.perception.toString(),
          collected: input.credits.collected.toString(),
          other: strict ? input.credits.other?.toString() ?? "0" : null,
        }
      : null,
    balances: input.balances ?? null,
    minimum: input.minimum?.toString() ?? null,
    declaredParameters: strict ? input.declaredParameters ?? [] : null,
    ...(remainingNonTaxable !== undefined && input.nonTaxableMinimum !== undefined
      ? { nonTaxableMinimum: input.nonTaxableMinimum.toString() }
      : {}),
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
