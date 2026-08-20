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

export const VAT_RI_ENGINE_VERSION = "ar-vat-ri-v2.0.0";

export type VatRiRate = "21" | "10.5" | "27" | "EXENTO" | "NO_GRAVADO";

export interface VatRiComponent {
  id: string;
  direction: "SALE" | "PURCHASE";
  date: string;
  /** Alícuota del componente: "21", "10.5", "27", "EXENTO", "NO_GRAVADO". */
  rate: VatRiRate;
  /** Base imponible (neto). */
  net: Decimal;
  /** Nota de crédito: resta del débito/crédito de su alícuota. */
  isCreditNote: boolean;
  /** Código de actividad (desglose informativo). */
  activityCode?: string;
}

export interface VatRiInput {
  period: { startDate: string; endDate: string; cutoff: string };
  components: VatRiComponent[];
  /** Reglas: tasa por alícuota (concept = "IVA_21", "IVA_105", "IVA_27"). */
  rules: Array<{ concept: string; rate?: Decimal; validFrom?: string; validTo?: string }>;
  /** Crédito Dto. 814 desde F.931 (remuneración neta × tasa). */
  decree814?: {
    netRemuneration: Decimal;
    rate: Decimal;
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
  const rates: VatRiRate[] = ["21", "10.5", "27"];
  const rateRules = new Map(input.rules.map((r) => [r.concept, r]));
  const rateByRate: Record<string, Decimal> = {
    "21": rateRules.get("IVA_21")?.rate ?? dec("0.21"),
    "10.5": rateRules.get("IVA_105")?.rate ?? dec("0.105"),
    "27": rateRules.get("IVA_27")?.rate ?? dec("0.27"),
  };
  const debitByRate = new Map<VatRiRate, Decimal>();
  const creditByRate = new Map<VatRiRate, Decimal>();
  let creditNoteRestitution = dec(0); // NC de compras que restituyen crédito
  let exemptPurchases = dec(0);
  let nonTaxablePurchases = dec(0);

  for (const c of inPeriod) {
    if (c.rate === "EXENTO" || c.rate === "NO_GRAVADO") {
      if (c.direction === "PURCHASE") {
        if (c.rate === "EXENTO") exemptPurchases = exemptPurchases.plus(c.net);
        else nonTaxablePurchases = nonTaxablePurchases.plus(c.net);
      }
      continue;
    }
    const sign = c.isCreditNote ? -1 : 1;
    const tax = applyRate(c.net, rateByRate[c.rate] ?? dec("0.21")).times(sign);
    if (c.direction === "SALE") {
      debitByRate.set(c.rate, (debitByRate.get(c.rate) ?? dec(0)).plus(tax));
    } else {
      creditByRate.set(c.rate, (creditByRate.get(c.rate) ?? dec(0)).plus(tax));
      if (c.isCreditNote) creditNoteRestitution = creditNoteRestitution.plus(c.net);
    }
  }

  // --- Renglones por alícuota ---
  for (const rate of rates) {
    const debit = debitByRate.get(rate) ?? dec(0);
    const credit = creditByRate.get(rate) ?? dec(0);
    if (debit.isZero() && credit.isZero()) continue;
    const rule = rateRules.get(`IVA_${rate.replace(".", "")}`);
    const formula = rule?.rate
      ? `base(${fmtMoney(debit)}) × tasa(${rule.rate})`
      : `base(${fmtMoney(debit)}) (sin tasa)`;
    lines.push({
      concept: `DEBITO_IVA_${rate.replace(".", "")}`,
      formula,
      inputs: { base: fmtMoney(debit), rate: rule?.rate?.toString() ?? "—" },
      result: fmtMoney(debit),
    });
    if (!credit.isZero()) {
      lines.push({
        concept: `CREDITO_IVA_${rate.replace(".", "")}`,
        formula: `base(${fmtMoney(credit)})`,
        inputs: { base: fmtMoney(credit) },
        result: fmtMoney(credit),
      });
    }
  }

  // --- Totales de débito y crédito ---
  let debitTotal = dec(0);
  let creditTotal = dec(0);
  for (const rate of rates) {
    debitTotal = debitTotal.plus(debitByRate.get(rate) ?? dec(0));
    creditTotal = creditTotal.plus(creditByRate.get(rate) ?? dec(0));
  }

  // --- Crédito Dto. 814 ---
  let decree814Credit = dec(0);
  if (input.decree814) {
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

  // --- Créditos totales ---
  const credits = input.credits;
  const withholding = credits?.withholding ?? dec(0);
  const perception = credits?.perception ?? dec(0);
  const restitution = credits?.restitution ?? dec(0);
  const compensation = credits?.compensation ?? dec(0);
  const technicalPrevious = credits?.technicalPrevious ?? dec(0);
  const freeAvailabilityPrevious = credits?.freeAvailabilityPrevious ?? dec(0);

  const totalCredit = creditTotal.plus(decree814Credit).plus(withholding).plus(perception).plus(restitution).plus(compensation);

  // --- Determinación de resultado (orden de negocio documentado) ---
  // 1) Saldo técnico = crédito total − débito total.
  // 2) Si hay excedente de crédito, se aplica saldo técnico anterior (primer
  //    párrafo) y luego saldo libre anterior (segundo párrafo).
  // 3) Si hay débito neto, se aplica saldo libre anterior.
  const technical = totalCredit.minus(debitTotal);
  let totalDue: Decimal;
  let technicalAfter: Decimal;
  let freeAfter: Decimal;

  if (technical.isZero() || technical.isPositive()) {
    // Crédito a favor: aplicar saldo técnico anterior y libre anterior.
    const excess = technical;
    const technicalConsumption = Decimal.min(excess, technicalPrevious);
    let remaining = excess.minus(technicalConsumption);
    const freeConsumption = Decimal.min(remaining, freeAvailabilityPrevious);
    remaining = remaining.minus(freeConsumption);
    totalDue = dec(0);
    technicalAfter = technicalPrevious.minus(technicalConsumption).plus(remaining);
    freeAfter = freeAvailabilityPrevious.minus(freeConsumption);
  } else {
    // Débito neto: aplicar saldo libre anterior (segundo párrafo).
    const netDebit = technical.abs();
    const freeConsumption = Decimal.min(netDebit, freeAvailabilityPrevious);
    totalDue = netDebit.minus(freeConsumption);
    technicalAfter = technicalPrevious;
    freeAfter = freeAvailabilityPrevious.minus(freeConsumption);
  }

  const subtotals: Record<string, string> = {
    DEBITO_FISCAL: fmtMoney(roundFor(debitTotal, "VENTAS", rounding.VENTAS)),
    CREDITO_FISCAL: fmtMoney(roundFor(creditTotal, "COMPRAS", rounding.COMPRAS)),
    CREDITO_DTO_814: fmtMoney(roundFor(decree814Credit, "COMPRAS", rounding.COMPRAS)),
    RETENCIONES_SUFRIDAS: fmtMoney(roundFor(withholding, "RETENCIONES", rounding.RETENCIONES)),
    PERCEPCIONES_SUFRIDAS: fmtMoney(roundFor(perception, "PERCEPCIONES", rounding.PERCEPCIONES)),
    RESTITUCIONES: fmtMoney(roundFor(restitution, "RESTITUCIONES", rounding.RESTITUCIONES)),
    COMPENSACIONES: fmtMoney(roundFor(compensation, "COMPENSACIONES", rounding.COMPENSACIONES)),
    SALDO_TECNICO_ANTERIOR: fmtMoney(roundFor(technicalPrevious, "SALDOS", rounding.SALDOS)),
    SALDO_LIBRE_ANTERIOR: fmtMoney(roundFor(freeAvailabilityPrevious, "SALDOS", rounding.SALDOS)),
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
      isCreditNote: c.isCreditNote,
      activityCode: c.activityCode ?? null,
    })),
    rules: input.rules.map((r) => ({ concept: r.concept, rate: r.rate?.toString() ?? null })),
    decree814: input.decree814
      ? { netRemuneration: input.decree814.netRemuneration.toString(), rate: input.decree814.rate.toString() }
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