import { describe, expect, it } from "vitest";
import {
  calculateProfitability,
  isFiscalExpense,
  PROFITABILITY_ENGINE_VERSION,
} from "./profitability.js";

/**
 * Golden tests del motor de rentabilidad gerencial (Puerta 5).
 *
 * G5-01/02: DEVENGADO y CAJA separados, con drill-down a cada subtotal.
 * G5-03: la gestión sin respaldo fiscal no reduce impuestos por defecto.
 * G5-04: los impuestos del período son costo; el IVA trasladado es posición
 *        informativa y sólo su efecto de caja entra en la vista de caja.
 * G5-05: publicación versionada (determinismo: mismo input → mismo hash).
 */

const basePeriod = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  cutoff: "2026-01-31",
};

function baseInput(overrides: Partial<Parameters<typeof calculateProfitability>[0]> = {}) {
  return {
    engineVersion: PROFITABILITY_ENGINE_VERSION,
    period: basePeriod,
    sales: "1000000.00",
    fiscalExpenses: "400000.00",
    managementExpenses: "50000.00",
    taxPayments: "30000.00",
    ...overrides,
  };
}

describe("G5-1 vista devengado", () => {
  it("resultado antes de impuestos = ventas − gastos fiscales − gestión", () => {
    const result = calculateProfitability(baseInput());
    expect(result.subtotals["VENTAS"]).toBe("1000000.00");
    expect(result.subtotals["GASTO_FISCAL"]).toBe("400000.00");
    expect(result.subtotals["GASTO_GESTION"]).toBe("50000.00");
    expect(result.subtotals["RESULTADO_ANTES_IMPUESTOS"]).toBe("550000.00");
  });

  it("resultado post impuestos = antes de impuestos − impuestos del período", () => {
    const result = calculateProfitability(baseInput());
    expect(result.subtotals["RESULTADO_POST_IMPUESTOS"]).toBe("520000.00");
    expect(result.total).toBe("520000.00");
  });

  it("ventas exentas son informativas y no forman el resultado", () => {
    const result = calculateProfitability(
      baseInput({ exemptSales: "200000.00" }),
    );
    expect(result.subtotals["VENTAS_EXENTAS"]).toBe("200000.00");
    expect(result.subtotals["VENTAS"]).toBe("1000000.00");
    expect(result.subtotals["RESULTADO_ANTES_IMPUESTOS"]).toBe("550000.00");
  });

  it("G5-04: el IVA trasladado es posición informativa, no gasto", () => {
    const result = calculateProfitability(
      baseInput({
        vatPosition: {
          debit: "210000.00",
          credit: "84000.00",
          withholding: "5000.00",
          perception: "3000.00",
        },
      }),
    );
    expect(result.subtotals["POSICION_IVA"]).toBe("118000.00");
    // El resultado NO incorpora el IVA como gasto.
    expect(result.subtotals["RESULTADO_ANTES_IMPUESTOS"]).toBe("550000.00");
  });
});

describe("G5-2 vista caja", () => {
  it("flujo neto = cobros − pagos fiscales − gestión − impuestos (con efecto IVA)", () => {
    const result = calculateProfitability(
      baseInput({
        basis: "CAJA",
        vatCashEffect: "118000.00",
      }),
    );
    expect(result.subtotals["COBROS"]).toBe("1000000.00");
    expect(result.subtotals["PAGOS_FISCALES"]).toBe("400000.00");
    expect(result.subtotals["PAGOS_GESTION"]).toBe("50000.00");
    expect(result.subtotals["PAGOS_IMPUESTOS"]).toBe("148000.00");
    expect(result.subtotals["FLUJO_NETO"]).toBe("402000.00");
    expect(result.total).toBe("402000.00");
  });

  it("caja sin efecto IVA no lo inventa", () => {
    const result = calculateProfitability(baseInput({ basis: "CAJA" }));
    expect(result.subtotals["PAGOS_IMPUESTOS"]).toBe("30000.00");
    expect(result.subtotals["FLUJO_NETO"]).toBe("520000.00");
  });

  it("devengado y caja nunca se mezclan: totales distintos con el mismo input", () => {
    const devengado = calculateProfitability(baseInput());
    const caja = calculateProfitability(baseInput({ basis: "CAJA", vatCashEffect: "118000.00" }));
    expect(devengado.total).toBe("520000.00");
    expect(caja.total).toBe("402000.00");
    expect(devengado.basis).toBe("DEVENGADO");
    expect(caja.basis).toBe("CAJA");
  });
});

describe("G5-3 gastos de gestión", () => {
  it("G5-03: gestión sin respaldo no reduce impuestos (MANAGEMENT_ONLY)", () => {
    expect(isFiscalExpense("MANAGEMENT_ONLY", false)).toBe(false);
  });

  it("gasto con respaldo fiscal es fiscal", () => {
    expect(isFiscalExpense("MANAGEMENT_ONLY", true)).toBe(true);
  });

  it("un tratamiento profesional FISCAL_COMPUTABLE vuelve computable el gasto", () => {
    expect(isFiscalExpense("FISCAL_COMPUTABLE", false)).toBe(true);
  });
});

describe("G5-4 determinismo y publicación", () => {
  it("G5-05: mismo input → mismo hash (snapshot reproducible)", () => {
    const a = calculateProfitability(baseInput({ basis: "CAJA", vatCashEffect: "118000.00" }));
    const b = calculateProfitability(baseInput({ basis: "CAJA", vatCashEffect: "118000.00" }));
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
  });

  it("cambiar una entrada cambia el hash (nueva versión, no reescribe la anterior)", () => {
    const a = calculateProfitability(baseInput());
    const b = calculateProfitability(baseInput({ managementExpenses: "60000.00" }));
    expect(a.outputHash).not.toBe(b.outputHash);
    expect(b.subtotals["RESULTADO_POST_IMPUESTOS"]).toBe("510000.00");
  });

  it("toda línea tiene fórmula e inputs (drill-down)", () => {
    const result = calculateProfitability(baseInput());
    for (const line of result.lines) {
      expect(line.formula.length).toBeGreaterThan(0);
      expect(typeof line.result).toBe("string");
    }
  });

  it("exige cutoff explícito", () => {
    const result = calculateProfitability(
      baseInput({ period: { ...basePeriod, cutoff: "" } }),
    );
    expect(result.blocks).toContain("Se requiere un cutoff explícito para calcular rentabilidad");
  });
});
