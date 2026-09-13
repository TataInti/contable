import { Decimal } from "decimal.js";
import { applyRate, dec, fmtMoney, roundFor, taxHash, type RoundingConfig, type TaxEngineResult } from "./core.js";

/**
 * Motor IVA — Responsable Inscripto por componente/alícuota (F1.3, PLAN §5.6.4).
 *
 * A diferencia del motor genérico (vat.ts, que colapsa a VENTAS/COMPRAS con
 * una tasa por concepto), este motor trabaja sobre componentes reales con
 * alícuota explícita (21 %, 10,5 % y 27 %), notas de crédito, crédito Dto. 814
 * desde F.931, restituciones, compensaciones y saldos de primer/segundo
 * párrafo diferenciados.
 *
 * Determinista y puro: recibe componentes aprobados, reglas y saldos; devuelve
 * renglones estables, subtotales, total, créditos, advertencias y bloqueos.
 */

export const VAT_RI_ENGINE_VERSION = "ar-vat-ri-v2.1.0";

export type VatRiRate = "21" | "10.5" | "27" | "EXENTO" | "NO_GRAVADO";

export interface VatRiComponent {
  id: string;
  direction: "SALE" | "PURCHASE";
  date: string;
  /** Alícuota del componente: "21", "10.5", "27", "EXENTO", "NO_GRAVADO". */
  rate: VatRiRate;
  /** Base imponible (neto). */
  net: Decimal;
  /** IVA informado por la fuente. El motor lo suma y controla contra base × tasa. */
  tax: Decimal;
  /** Nota de crédito: resta del débito/crédito de su alícuota. */
  isCreditNote: boolean;
  /** Código de actividad (desglose informativo). */
  activityCode?: string;
}

export interface VatRiInput {
  period: { startDate: string; endDate: string; cutoff: string };
  components: VatRiComponent[];
  /** Comprobantes gravados cuyo snapshot no identifica una alícuota. */
  missingRateVoucherIds?: string[];
  /** Diferencias entre neto gravado del libro y bases distribuidas por alícuota. */
  bookDifferences?: Array<{ voucherId: string; difference: Decimal }>;
  /** Reglas: tasa por alícuota (concept = "IVA_21", "IVA_105", "IVA_27"). */
  rules: Array<{ concept: string; rate?: Decimal; validFrom?: string; validTo?: string }>;
  /** Crédito Dto. 814 desde F.931 (remuneración neta × tasa). */
  decree814?: {
    netRemuneration: Decimal;
    rate?: Decimal;
    /** F.931 es una declaración mensual completa: debe existir una sola corrida revisada. */
    runCount?: number;
  };
  credits?: {
    withholding: Decimal;
    perception: Decimal;
    restitution: Decimal;
    compensation: Decimal;
    /** Saldo técnico anterior (primer párrafo). */
    technicalPrevious: Decimal;
    /** Saldo libre anterior (segundo párrafo). */
    freeAvailabilityPrevious: Decimal;
  };
  rounding?: Partial<Record<string, RoundingConfig>>;
}

export function calculateVatRi(input: VatRiInput): TaxEngineResult {
  const rounding = input.rounding ?? {};
  const lines: TaxEngineResult["lines"] = [];
  const warnings: string[] = [];
  const blocks: string[] = [];

  // --- Bloqueos de entrada ---
  if (!input.period.cutoff) {
    blocks.push("Se requiere un cutoff explícito para calcular IVA");
  }
  for (const voucherId of input.missingRateVoucherIds ?? []) {
    blocks.push(`El comprobante ${voucherId} tiene neto gravado sin alícuota IVA`);
  }
  for (const difference of input.bookDifferences ?? []) {
    if (difference.difference.abs().greaterThan("0.02")) {
      blocks.push(
        `El comprobante ${difference.voucherId} difiere ${fmtMoney(difference.difference.abs())} entre neto gravado y bases por alícuota`,
      );
    }
  }

  const inPeriod = input.components.filter((c) => {
    if (c.date < input.period.startDate || c.date > input.period.endDate) return false;
    if (c.date > input.period.cutoff) return false;
    return true;
  });
  const outOfPeriod = input.components.length - inPeriod.length;
  if (outOfPeriod > 0) {
    warnings.push(`${outOfPeriod} componente(s) quedaron fuera del período o del cutoff y no se incluyeron`);
  }

  // --- Débito/crédito por alícuota (neto de NC) ---
  const rates: Array<Exclude<VatRiRate, "EXENTO" | "NO_GRAVADO">> = ["21", "10.5", "27"];
  const rateRules = new Map(input.rules.map((r) => [r.concept, r]));
  const ruleConceptByRate: Record<Exclude<VatRiRate, "EXENTO" | "NO_GRAVADO">, string> = {
    "21": "IVA_21",
    "10.5": "IVA_105",
    "27": "IVA_27",
  };
  type RateTotal = { base: Decimal; tax: Decimal };
  const debitByRate = new Map<VatRiRate, RateTotal>();
  const creditByRate = new Map<VatRiRate, RateTotal>();
  const activityTax = new Map<string, Decimal>();
  const missingRules = new Set<string>();
  let exemptPurchases = dec(0);
  let nonTaxablePurchases = dec(0);

  for (const c of inPeriod) {
    if (c.rate === "EXENTO" || c.rate === "NO_GRAVADO") {
      if (c.direction === "PURCHASE") {
        const signedNet = c.net.abs().times(c.isCreditNote ? -1 : 1);
        if (c.rate === "EXENTO") exemptPurchases = exemptPurchases.plus(signedNet);
        else nonTaxablePurchases = nonTaxablePurchases.plus(signedNet);
      }
      continue;
    }
    const ruleConcept = ruleConceptByRate[c.rate];
    const rule = rateRules.get(ruleConcept);
    if (!rule?.rate) {
      if (!missingRules.has(ruleConcept)) {
        blocks.push(`Falta la regla activa ${ruleConcept} para calcular IVA`);
        missingRules.add(ruleConcept);
      }
      continue;
    }
    const sourceBase = c.net.abs();
    const sourceTax = c.tax.abs();
    const expectedTax = applyRate(sourceBase, rule.rate);
    const difference = sourceTax.minus(expectedTax).abs();
    if (difference.greaterThan("0.02")) {
      blocks.push(
        `El componente ${c.id} difiere ${fmtMoney(difference)} entre IVA fuente y base × tasa`,
      );
    }
    const sign = c.isCreditNote ? -1 : 1;
    const signedBase = sourceBase.times(sign);
    const signedTax = sourceTax.times(sign);
    const target = c.direction === "SALE" ? debitByRate : creditByRate;
    const current = target.get(c.rate) ?? { base: dec(0), tax: dec(0) };
    target.set(c.rate, {
      base: current.base.plus(signedBase),
      tax: current.tax.plus(signedTax),
    });
    const activityKey = `${c.direction}:${c.rate}:${c.activityCode ?? "SIN_ACTIVIDAD"}`;
    activityTax.set(activityKey, (activityTax.get(activityKey) ?? dec(0)).plus(signedTax));
  }

  // --- Renglones por alícuota ---
  for (const rate of rates) {
    const debit = debitByRate.get(rate);
    const credit = creditByRate.get(rate);
    if (!debit && !credit) continue;
    const rule = rateRules.get(ruleConceptByRate[rate]);
    if (debit && (!debit.base.isZero() || !debit.tax.isZero())) {
      lines.push({
        concept: `DEBITO_IVA_${rate.replace(".", "")}`,
        formula: "Σ IVA informado en ventas, neto de notas de crédito",
        inputs: { base: fmtMoney(debit.base), rate: rule?.rate?.toString() ?? "—" },
        result: fmtMoney(debit.tax),
      });
    }
    if (credit && (!credit.base.isZero() || !credit.tax.isZero())) {
      lines.push({
        concept: `CREDITO_IVA_${rate.replace(".", "")}`,
        formula: "Σ IVA informado en compras, neto de notas de crédito",
        inputs: { base: fmtMoney(credit.base), rate: rule?.rate?.toString() ?? "—" },
        result: fmtMoney(credit.tax),
      });
    }
  }
  for (const [key, amount] of [...activityTax.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const [direction, rate, activity] = key.split(":");
    lines.push({
      concept: `DESGLOSE_${direction === "SALE" ? "DEBITO" : "CREDITO"}_${rate!.replace(".", "")}_${activity}`,
      formula: "Desglose informativo por actividad y alícuota",
      inputs: { activity: activity!, rate: rate! },
      result: fmtMoney(amount),
    });
  }
  if (!exemptPurchases.isZero()) {
    lines.push({
      concept: "COMPRAS_EXENTAS",
      formula: "Σ compras exentas netas de notas de crédito",
      inputs: { base: fmtMoney(exemptPurchases) },
      result: fmtMoney(exemptPurchases),
    });
  }
  if (!nonTaxablePurchases.isZero()) {
    lines.push({
      concept: "COMPRAS_NO_GRAVADAS",
      formula: "Σ compras no gravadas netas de notas de crédito",
      inputs: { base: fmtMoney(nonTaxablePurchases) },
      result: fmtMoney(nonTaxablePurchases),
    });
  }

  // --- Totales de débito y crédito ---
  let debitTotal = dec(0);
  let creditTotal = dec(0);
  for (const rate of rates) {
    debitTotal = debitTotal.plus(debitByRate.get(rate)?.tax ?? dec(0));
    creditTotal = creditTotal.plus(creditByRate.get(rate)?.tax ?? dec(0));
  }

  // --- Crédito Dto. 814 ---
  let decree814Credit = dec(0);
  if (input.decree814) {
    if ((input.decree814.runCount ?? 1) !== 1) {
      blocks.push("Dto. 814 requiere una única corrida F.931 revisada para el período");
    } else if (!input.decree814.rate) {
      blocks.push("Falta la regla activa DTO_814 para calcular el crédito por contribuciones");
    } else if (input.decree814.rate.isNegative() || input.decree814.rate.greaterThan(1)) {
      blocks.push("La tasa DTO_814 debe expresarse como decimal entre 0 y 1");
    } else {
      decree814Credit = applyRate(input.decree814.netRemuneration, input.decree814.rate);
      lines.push({
        concept: "CREDITO_DTO_814",
        formula: `remuneración neta(${fmtMoney(input.decree814.netRemuneration)}) × tasa(${input.decree814.rate})`,
        inputs: {
          base: fmtMoney(input.decree814.netRemuneration),
          rate: input.decree814.rate.toString(),
        },
        result: fmtMoney(decree814Credit),
      });
    }
  }

  // --- Créditos totales ---
  const credits = input.credits;
  const withholding = credits?.withholding ?? dec(0);
  const perception = credits?.perception ?? dec(0);
  const restitution = credits?.restitution ?? dec(0);
  const compensation = credits?.compensation ?? dec(0);
  const technicalPrevious = credits?.technicalPrevious ?? dec(0);
  const freeAvailabilityPrevious = credits?.freeAvailabilityPrevious ?? dec(0);

  // --- Determinación de resultado (orden de negocio documentado) ---
  // Primer párrafo: débito − crédito fiscal − Dto. 814 − saldo técnico previo.
  // Segundo párrafo: saldo libre previo + ret/per + compensaciones − restituciones.
  // Nunca se mezclan ambos saldos: si el primer párrafo queda a favor se
  // arrastra como técnico, mientras los créditos de segundo párrafo conservan
  // su disponibilidad independiente.
  const technicalNet = debitTotal
    .minus(creditTotal)
    .minus(decree814Credit)
    .minus(technicalPrevious);
  const technicalDue = Decimal.max(technicalNet, dec(0));
  const technicalAfter = Decimal.max(technicalNet.negated(), dec(0));
  const secondParagraphAvailable = freeAvailabilityPrevious
    .plus(withholding)
    .plus(perception)
    .plus(compensation)
    .minus(restitution);
  const totalDue = Decimal.max(technicalDue.minus(secondParagraphAvailable), dec(0));
  const freeAfter = Decimal.max(secondParagraphAvailable.minus(technicalDue), dec(0));

  const subtotals: Record<string, string> = {
    DEBITO_FISCAL: fmtMoney(roundFor(debitTotal, "VENTAS", rounding.VENTAS)),
    CREDITO_FISCAL: fmtMoney(roundFor(creditTotal, "COMPRAS", rounding.COMPRAS)),
    CREDITO_DTO_814: fmtMoney(roundFor(decree814Credit, "COMPRAS", rounding.COMPRAS)),
    COMPRAS_EXENTAS: fmtMoney(roundFor(exemptPurchases, "COMPRAS", rounding.COMPRAS)),
    COMPRAS_NO_GRAVADAS: fmtMoney(roundFor(nonTaxablePurchases, "COMPRAS", rounding.COMPRAS)),
    RETENCIONES_SUFRIDAS: fmtMoney(roundFor(withholding, "RETENCIONES", rounding.RETENCIONES)),
    PERCEPCIONES_SUFRIDAS: fmtMoney(roundFor(perception, "PERCEPCIONES", rounding.PERCEPCIONES)),
    RESTITUCIONES: fmtMoney(roundFor(restitution, "RESTITUCIONES", rounding.RESTITUCIONES)),
    COMPENSACIONES: fmtMoney(roundFor(compensation, "COMPENSACIONES", rounding.COMPENSACIONES)),
    SALDO_TECNICO_ANTERIOR: fmtMoney(roundFor(technicalPrevious, "SALDOS", rounding.SALDOS)),
    SALDO_LIBRE_ANTERIOR: fmtMoney(roundFor(freeAvailabilityPrevious, "SALDOS", rounding.SALDOS)),
    SALDO_TECNICO_A_INGRESAR: fmtMoney(roundFor(technicalDue, "SALDOS", rounding.SALDOS)),
    CREDITOS_SEGUNDO_PARRAFO: fmtMoney(
      roundFor(secondParagraphAvailable, "SALDOS", rounding.SALDOS),
    ),
    TOTAL_A_INGRESAR: fmtMoney(roundFor(totalDue, "TOTAL", rounding.TOTAL)),
    SALDO_TECNICO_AFTER: fmtMoney(roundFor(technicalAfter, "SALDOS", rounding.SALDOS)),
    SALDO_LIBRE_AFTER: fmtMoney(roundFor(freeAfter, "SALDOS", rounding.SALDOS)),
  };

  const inputHash = taxHash({
    engineVersion: VAT_RI_ENGINE_VERSION,
    period: input.period,
    components: inPeriod.map((c) => ({
      id: c.id,
      direction: c.direction,
      date: c.date,
      rate: c.rate,
      net: c.net.toString(),
      tax: c.tax.toString(),
      isCreditNote: c.isCreditNote,
      activityCode: c.activityCode ?? null,
    })),
    missingRateVoucherIds: [...(input.missingRateVoucherIds ?? [])].sort(),
    bookDifferences: (input.bookDifferences ?? [])
      .map((item) => ({ voucherId: item.voucherId, difference: item.difference.toString() }))
      .sort((left, right) => left.voucherId.localeCompare(right.voucherId)),
    rules: input.rules.map((r) => ({ concept: r.concept, rate: r.rate?.toString() ?? null })),
    decree814: input.decree814
      ? {
          netRemuneration: input.decree814.netRemuneration.toString(),
          rate: input.decree814.rate?.toString() ?? null,
          runCount: input.decree814.runCount ?? 1,
        }
      : null,
    credits: input.credits
      ? {
          withholding: input.credits.withholding.toString(),
          perception: input.credits.perception.toString(),
          restitution: input.credits.restitution.toString(),
          compensation: input.credits.compensation.toString(),
          technicalPrevious: input.credits.technicalPrevious.toString(),
          freeAvailabilityPrevious: input.credits.freeAvailabilityPrevious.toString(),
        }
      : null,
  });

  const outputHash = taxHash({
    inputHash,
    lines: lines.map((l) => ({ concept: l.concept, result: l.result })),
    subtotals,
    totalDue: fmtMoney(roundFor(totalDue, "TOTAL", rounding.TOTAL)),
    credits: { technical: fmtMoney(technicalAfter), free: fmtMoney(freeAfter) },
    warnings,
    blocks,
  });

  return {
    engineVersion: VAT_RI_ENGINE_VERSION,
    lines,
    subtotals,
    totalDue: fmtMoney(roundFor(totalDue, "TOTAL", rounding.TOTAL)),
    credits: { technical: fmtMoney(technicalAfter), free: fmtMoney(freeAfter) },
    warnings,
    blocks,
    inputHash,
    outputHash,
  };
}
