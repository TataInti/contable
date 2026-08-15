import { Decimal } from "decimal.js";
import {
  applyRate,
  dec,
  fmtMoney,
  roundFor,
  taxHash,
  type TaxEngineInput,
  type TaxEngineResult,
  type TaxFact,
} from "./core.js";

/**
 * Motor IVA — Responsable Inscripto (AR_VAT_RI_V1).
 *
 * Determinista y puro: recibe hechos aprobados, reglas y saldos; devuelve
 * renglones, subtotales, total, créditos, advertencias y bloqueos.
 *
 * Nada de esto consulta Prisma, HTTP o el reloj: el contexto se pasa como
 * argumento (período + cutoff + facts + rules).
 */

export const VAT_ENGINE_VERSION = "ar-vat-ri-v1.0.0";

const VALID_CONCEPTS = new Set(["VENTAS", "COMPRAS", "EXENTO", "NO_GRAVADO"]);

export interface VatInput extends TaxEngineInput {
  /** Detalle de créditos: retenciones, percepciones, saldo técnico, etc. */
  credits?: {
    /** Retenciones sufridas. */
    withholding: Decimal;
    /** Percepciones sufridas. */
    perception: Decimal;
    /** Saldo a favor técnico anterior. */
    technicalPrevious: Decimal;
    /** Saldo a favor de libre disponibilidad anterior. */
    freeAvailabilityPrevious: Decimal;
  };
}

export function calculateVat(input: VatInput): TaxEngineResult {
  const rules = new Map(input.rules.map((r) => [r.concept, r]));
  const rounding = input.rounding ?? {};

  const lines: TaxEngineResult["lines"] = [];
  const warnings: string[] = [];
  const blocks: string[] = [];

  // --- Bloqueos de entrada ---
  if (!input.period.cutoff) {
    blocks.push("Se requiere un cutoff explícito para calcular IVA");
  }
  const factsInPeriod = input.facts.filter((f) => {
    if (f.date < input.period.startDate || f.date > input.period.endDate) return false;
    if (f.date > input.period.cutoff) return false;
    return true;
  });
  const outOfPeriod = input.facts.length - factsInPeriod.length;
  if (outOfPeriod > 0) {
    warnings.push(`${outOfPeriod} hecho(s) quedaron fuera del período o del cutoff y no se incluyeron`);
  }

  // --- Cálculo por concepto ---
  const byConcept = new Map<string, { base: Decimal; tax: Decimal }>();
  for (const f of factsInPeriod) {
    if (!VALID_CONCEPTS.has(f.concept)) {
      warnings.push(`Concepto desconocido ${f.concept} en hecho ${f.id}; se omitió`);
      continue;
    }
    const entry = byConcept.get(f.concept) ?? { base: dec(0), tax: dec(0) };
    const base = f.base;
    entry.base = entry.base.plus(base);
    const rule = rules.get(f.concept);
    const rate = rule?.rate;
    if (rate !== undefined) {
      entry.tax = entry.tax.plus(applyRate(base, rate));
    }
    byConcept.set(f.concept, entry);
  }

  // --- Renglones ---
  const conceptOrder = ["VENTAS", "COMPRAS", "EXENTO", "NO_GRAVADO"];
  for (const concept of conceptOrder) {
    const entry = byConcept.get(concept);
    if (!entry) continue;
    const base = roundFor(entry.base, concept, rounding[concept]);
    const tax = roundFor(entry.tax, concept, rounding[concept]);
    const rule = rules.get(concept);
    const formula = rule?.rate
      ? `base(${fmtMoney(base)}) × tasa(${rule.rate})`
      : `base(${fmtMoney(base)}) (sin tasa)`;
    lines.push({
      concept,
      formula,
      inputs: {
        base: fmtMoney(base),
        rate: rule?.rate?.toString() ?? "—",
        tax: fmtMoney(tax),
      },
      result: fmtMoney(tax),
    });
  }

  // --- Subtotales ---
  const sales = byConcept.get("VENTAS");
  const purchases = byConcept.get("COMPRAS");
  const debit = sales ? roundFor(sales.tax, "VENTAS", rounding.VENTAS) : dec(0);
  const credit = purchases ? roundFor(purchases.tax, "COMPRAS", rounding.COMPRAS) : dec(0);
  const subtotals: Record<string, string> = {
    DEBITO_FISCAL: fmtMoney(debit),
    CREDITO_FISCAL: fmtMoney(credit),
  };

  const credits = input.credits;
  const withholding = credits?.withholding ?? dec(0);
  const perception = credits?.perception ?? dec(0);
  const technicalPrevious = credits?.technicalPrevious ?? dec(0);
  const freeAvailabilityPrevious = credits?.freeAvailabilityPrevious ?? dec(0);

  subtotals["RETENCIONES_SUFRIDAS"] = fmtMoney(roundFor(withholding, "RETENCIONES", rounding.RETENCIONES));
  subtotals["PERCEPCIONES_SUFRIDAS"] = fmtMoney(roundFor(perception, "PERCEPCIONES", rounding.PERCEPCIONES));
  subtotals["SALDO_TECNICO_ANTERIOR"] = fmtMoney(roundFor(technicalPrevious, "SALDOS", rounding.SALDOS));
  subtotals["SALDO_LIBRE_ANTERIOR"] = fmtMoney(roundFor(freeAvailabilityPrevious, "SALDOS", rounding.SALDOS));

  // Débito − crédito − retenciones − percepciones
  const net = debit.minus(credit).minus(withholding).minus(perception);

  const creditTotal = credit.plus(withholding).plus(perception);
  const technical = creditTotal.minus(debit);

  // --- Determinación de resultado ---
  let totalDue: Decimal;
  let technicalAfter: Decimal;
  let freeAfter: Decimal;

  if (net.isZero() || net.isPositive()) {
    // Saldo a ingresar; aplica saldo libre disponible anterior si existe.
    const freeConsumption = Decimal.min(net, freeAvailabilityPrevious);
    totalDue = net.minus(freeConsumption);
    technicalAfter = technical.isPositive() ? technical : dec(0);
    freeAfter = freeAvailabilityPrevious.minus(freeConsumption);
  } else {
    // Crédito a favor: no hay nada a ingresar; el excedente se aplica
    // contra saldo técnico y libre disponible anterior.
    const excess = net.abs();
    const technicalConsumption = Decimal.min(excess, technicalPrevious);
    let remaining = excess.minus(technicalConsumption);
    const freeConsumption = Decimal.min(remaining, freeAvailabilityPrevious);
    remaining = remaining.minus(freeConsumption);
    totalDue = dec(0);
    technicalAfter = technicalPrevious.minus(technicalConsumption).plus(technical.isPositive() ? technical : dec(0));
    freeAfter = freeAvailabilityPrevious.minus(freeConsumption);
  }

  subtotals["TOTAL_A_INGRESAR"] = fmtMoney(roundFor(totalDue, "TOTAL", rounding.TOTAL));
  subtotals["SALDO_TECNICO_AFTER"] = fmtMoney(roundFor(technicalAfter, "SALDOS", rounding.SALDOS));
  subtotals["SALDO_LIBRE_AFTER"] = fmtMoney(roundFor(freeAfter, "SALDOS", rounding.SALDOS));

  const inputHash = taxHash({
    engineVersion: VAT_ENGINE_VERSION,
    period: input.period,
    facts: factsInPeriod.map((f) => ({
      id: f.id,
      direction: f.direction,
      date: f.date,
      concept: f.concept,
      base: f.base.toString(),
      currency: f.currency,
    })),
    rules: input.rules.map((r) => ({
      concept: r.concept,
      rate: r.rate?.toString(),
      validFrom: r.validFrom,
      validTo: r.validTo ?? null,
    })),
    credits: input.credits
      ? {
          withholding: input.credits.withholding.toString(),
          perception: input.credits.perception.toString(),
          technicalPrevious: input.credits.technicalPrevious.toString(),
          freeAvailabilityPrevious: input.credits.freeAvailabilityPrevious.toString(),
        }
      : null,
    balances: input.balances ?? null,
  });

  const outputHash = taxHash({
    inputHash,
    lines: lines.map((l) => ({ concept: l.concept, result: l.result })),
    subtotals,
    totalDue: fmtMoney(roundFor(totalDue, "TOTAL", rounding.TOTAL)),
    credits: {
      technical: fmtMoney(technicalAfter),
      free: fmtMoney(freeAfter),
    },
    warnings,
    blocks,
  });

  return {
    engineVersion: VAT_ENGINE_VERSION,
    lines,
    subtotals,
    totalDue: fmtMoney(roundFor(totalDue, "TOTAL", rounding.TOTAL)),
    credits: {
      technical: fmtMoney(technicalAfter),
      free: fmtMoney(freeAfter),
    },
    warnings,
    blocks,
    inputHash,
    outputHash,
  };
}

/** Utilidad para hechos tipo voucher. */
export function fact(id: string, direction: TaxFact["direction"], date: string, concept: string, base: string): TaxFact {
  return { id, direction, date, concept, base: new Decimal(base), currency: "ARS" };
}