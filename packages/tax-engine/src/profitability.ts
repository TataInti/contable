import {
  dec,
  fmtMoney,
  roundFor,
  taxHash,
  type RoundingConfig,
} from "./core.js";

/**
 * Motor de rentabilidad gerencial (Puerta 5).
 *
 * Determinista y puro: recibe ventas, gastos (con respaldo fiscal y de
 * gestión), impuestos del período y pagos; devuelve dos vistas separadas:
 * DEVENGADO (resultado gerencial luego de impuestos) y CAJA (flujo neto
 * luego de impuestos). Nunca mezcla devengado con caja (PLAN §5.7, §7.7).
 *
 * Definiciones:
 * - Gasto con respaldo fiscal: afecta la base fiscal según regla aprobada.
 * - Gasto de gestión sin respaldo: afecta rentabilidad, nunca impuestos
 *   por defecto (MANAGEMENT_ONLY). Un ajuste fiscal aprobado lo convierte
 *   en FISCAL_COMPUTABLE y se suma a los impuestos económicos vía
 *   TaxAdjustment, no como gasto directo.
 * - Impuestos económicos: pagos de impuestos del período (efecto caja y
 *   costo del período en devengado cuando constituyen costo).
 * - IVA trasladado/computable es posición fiscal, no gasto económico:
 *   se informa por separado (vatPosition) y sólo su efecto de caja entra
 *   en la vista de caja.
 */

export const PROFITABILITY_ENGINE_VERSION = "ar-profitability-v1.0.0";

export const PROFITABILITY_BASES = ["DEVENGADO", "CAJA"] as const;
export type ProfitabilityBasis = (typeof PROFITABILITY_BASES)[number];

/** Entrada consolidada del período para la vista. */
export interface ProfitabilityInput {
  engineVersion: string;
  /** Período fiscal [start, end] con cutoff de hechos. */
  period: { startDate: string; endDate: string; cutoff: string };
  /** Redondeos por concepto (global por defecto). */
  rounding?: Partial<Record<string, RoundingConfig>>;
  /** Base de cálculo: DEVENGADO (resultado) o CAJA (flujo). */
  basis?: ProfitabilityBasis;
  /** Ventas netas del período (base imponible de ventas). */
  sales: string;
  /** Ventas exentas / no gravadas (informativo, no forman resultado). */
  exemptSales?: string;
  /** Gastos con respaldo fiscal (netos de compras aprobadas). */
  fiscalExpenses: string;
  /** Gastos de gestión sin respaldo fiscal. */
  managementExpenses: string;
  /** Pagos de impuestos del período (caja) — no incluye IVA trasladado. */
  taxPayments: string;
  /** Efecto de caja del IVA (débito−crédito−retenciones/percepciones cobradas). */
  vatCashEffect?: string;
  /** Posición IVA informativa (no es gasto económico). */
  vatPosition?: {
    debit: string;
    credit: string;
    withholding: string;
    perception: string;
  };
  /** Fecha y estado de publicación si es un snapshot publicado. */
  publishedAt?: string | null;
}

export interface ProfitabilityResult {
  engineVersion: string;
  basis: ProfitabilityBasis;
  lines: Array<{ concept: string; formula: string; inputs: Record<string, string>; result: string }>;
  subtotals: Record<string, string>;
  total: string;
  warnings: string[];
  blocks: string[];
  inputHash: string;
  outputHash: string;
}

const FISCAL_TREATMENTS = new Set([
  "FISCAL_COMPUTABLE",
  "FISCAL_NON_COMPUTABLE",
  "PENDING_PROFESSIONAL_DECISION",
]);

/**
 * Clasifica gastos: con respaldo fiscal (compras aprobadas o gastos con
 * tratamiento profesional que los vuelve computables) vs. gestión pura.
 * Un gasto MANAGEMENT_ONLY nunca es fiscal por defecto.
 */
export function isFiscalExpense(taxTreatment: string, hasFiscalSupport: boolean): boolean {
  return hasFiscalSupport || FISCAL_TREATMENTS.has(taxTreatment);
}

export function calculateProfitability(input: ProfitabilityInput): ProfitabilityResult {
  const rounding = input.rounding ?? {};
  const warnings: string[] = [];
  const blocks: string[] = [];

  if (!input.period.cutoff) {
    blocks.push("Se requiere un cutoff explícito para calcular rentabilidad");
  }

  const sales = dec(input.sales);
  const exempt = input.exemptSales !== undefined ? dec(input.exemptSales) : dec(0);
  const fiscal = dec(input.fiscalExpenses);
  const management = dec(input.managementExpenses);
  const taxPayments = dec(input.taxPayments);
  const vatCash = input.vatCashEffect !== undefined ? dec(input.vatCashEffect) : dec(0);

  const basis: ProfitabilityBasis = input.basis ?? "DEVENGADO";
  const lines: ProfitabilityResult["lines"] = [];
  const subtotals: Record<string, string> = {};

  // --- VENTAS netas del período (base imponible) ---
  subtotals["VENTAS"] = fmtMoney(roundFor(sales, "VENTAS", rounding.VENTAS));
  lines.push({
    concept: "VENTAS",
    formula: `ventas netas del período (${fmtMoney(sales)})`,
    inputs: { sales: fmtMoney(sales) },
    result: fmtMoney(sales),
  });
  if (!exempt.isZero()) {
    subtotals["VENTAS_EXENTAS"] = fmtMoney(roundFor(exempt, "VENTAS", rounding.VENTAS));
    lines.push({
      concept: "VENTAS_EXENTAS",
      formula: "ventas exentas / no gravadas (informativas, sin resultado)",
      inputs: { exempt: fmtMoney(exempt) },
      result: fmtMoney(exempt),
    });
  }

  // --- Gastos: fiscales y de gestión por separado ---
  subtotals["GASTO_FISCAL"] = fmtMoney(roundFor(fiscal, "GASTOS", rounding.GASTOS));
  lines.push({
    concept: "GASTO_FISCAL",
    formula: `compras con respaldo fiscal (${fmtMoney(fiscal)})`,
    inputs: { fiscal: fmtMoney(fiscal) },
    result: fmtMoney(fiscal),
  });
  subtotals["GASTO_GESTION"] = fmtMoney(roundFor(management, "GASTOS", rounding.GASTOS));
  lines.push({
    concept: "GASTO_GESTION",
    formula: "gastos de gestión sin respaldo fiscal (no reducen impuestos por defecto)",
    inputs: { management: fmtMoney(management) },
    result: fmtMoney(management),
  });

  // --- Impuestos que constituyen costo del período (caja, excluye IVA trasladado) ---
  subtotals["IMPUESTOS"] = fmtMoney(roundFor(taxPayments, "IMPUESTOS", rounding.IMPUESTOS));
  lines.push({
    concept: "IMPUESTOS",
    formula: `pagos de impuestos del período (${fmtMoney(taxPayments)})`,
    inputs: { taxPayments: fmtMoney(taxPayments) },
    result: fmtMoney(taxPayments),
  });

  // --- Posición IVA informativa (no es gasto económico) ---
  if (input.vatPosition) {
    const debit = dec(input.vatPosition.debit);
    const credit = dec(input.vatPosition.credit);
    const wh = dec(input.vatPosition.withholding);
    const perc = dec(input.vatPosition.perception);
    subtotals["IVA_DEBITO"] = fmtMoney(roundFor(debit, "IMPUESTOS", rounding.IMPUESTOS));
    subtotals["IVA_CREDITO"] = fmtMoney(roundFor(credit, "IMPUESTOS", rounding.IMPUESTOS));
    subtotals["IVA_RETENCIONES"] = fmtMoney(roundFor(wh, "IMPUESTOS", rounding.IMPUESTOS));
    subtotals["IVA_PERCEPCIONES"] = fmtMoney(roundFor(perc, "IMPUESTOS", rounding.IMPUESTOS));
    subtotals["POSICION_IVA"] = fmtMoney(
      roundFor(debit.minus(credit).minus(wh).minus(perc), "IMPUESTOS", rounding.IMPUESTOS),
    );
    lines.push({
      concept: "POSICION_IVA",
      formula: "posición fiscal del IVA — no constituye gasto económico",
      inputs: { debit: fmtMoney(debit), credit: fmtMoney(credit), withholding: fmtMoney(wh), perception: fmtMoney(perc) },
      result: fmtMoney(debit.minus(credit).minus(wh).minus(perc)),
    });
  }

  // --- Resultado antes de impuestos ---
  const preTax = sales.minus(fiscal).minus(management);
  subtotals["RESULTADO_ANTES_IMPUESTOS"] = fmtMoney(roundFor(preTax, "RESULTADO", rounding.RESULTADO));
  lines.push({
    concept: "RESULTADO_ANTES_IMPUESTOS",
    formula: `ventas − gastos fiscales − gastos de gestión (${fmtMoney(preTax)})`,
    inputs: { preTax: fmtMoney(preTax) },
    result: fmtMoney(preTax),
  });

  // --- Resultado gerencial luego de impuestos (devengado: caja impositiva como costo) ---
  const postTax = preTax.minus(taxPayments);
  subtotals["RESULTADO_POST_IMPUESTOS"] = fmtMoney(roundFor(postTax, "RESULTADO", rounding.RESULTADO));
  lines.push({
    concept: "RESULTADO_POST_IMPUESTOS",
    formula: `resultado antes de impuestos − impuestos del período (${fmtMoney(postTax)})`,
    inputs: { postTax: fmtMoney(postTax) },
    result: fmtMoney(postTax),
  });

  // --- Vista de caja: flujo neto luego de impuestos ---
  // CAJA nunca se mezcla con DEVENGADO (PLAN §5.7): se calcula con el mismo
  // juego de entradas pero como flujo (cobros vs pagos efectivos).
  const receipts = sales;
  const paidFiscal = fiscal;
  const paidManagement = management;
  const paidTaxes = taxPayments.plus(vatCash);
  const netCash = receipts.minus(paidFiscal).minus(paidManagement).minus(paidTaxes);
  subtotals["COBROS"] = fmtMoney(roundFor(receipts, "CAJA", rounding.CAJA));
  subtotals["PAGOS_FISCALES"] = fmtMoney(roundFor(paidFiscal, "CAJA", rounding.CAJA));
  subtotals["PAGOS_GESTION"] = fmtMoney(roundFor(paidManagement, "CAJA", rounding.CAJA));
  subtotals["PAGOS_IMPUESTOS"] = fmtMoney(roundFor(paidTaxes, "CAJA", rounding.CAJA));
  subtotals["FLUJO_NETO"] = fmtMoney(roundFor(netCash, "CAJA", rounding.CAJA));

  const total = input.basis === "CAJA" ? netCash : postTax;

  const inputHash = taxHash({
    engineVersion: PROFITABILITY_ENGINE_VERSION,
    period: input.period,
    sales: input.sales,
    exemptSales: input.exemptSales ?? null,
    fiscalExpenses: input.fiscalExpenses,
    managementExpenses: input.managementExpenses,
    taxPayments: input.taxPayments,
    vatCashEffect: input.vatCashEffect ?? null,
    vatPosition: input.vatPosition ?? null,
  });
  const outputHash = taxHash({
    inputHash,
    subtotals,
    total: fmtMoney(roundFor(total, "RESULTADO", rounding.RESULTADO)),
    warnings,
    blocks,
  });

  return {
    engineVersion: PROFITABILITY_ENGINE_VERSION,
    basis,
    lines,
    subtotals,
    total: fmtMoney(roundFor(total, "RESULTADO", rounding.RESULTADO)),
    warnings,
    blocks,
    inputHash,
    outputHash,
  };
}
