import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  calculateIIbbTuc,
  IIBB_TUC_ENGINE_VERSION,
  IIBB_TUC_PREVIOUS_ENGINE_VERSION,
} from "./iibb.js";

const period = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  cutoff: "2026-01-31",
};

const rules = [
  {
    id: "X",
    concept: "X",
    code: "X",
    rate: new Decimal("0.01"),
    validFrom: "2026-01-01",
  },
];

/**
 * Regla 3 del brief 4E (base negativa): en IIBB el tributo determinado es 0,
 * con aviso y sin arrastre de saldo a favor. La versión 1.1.0 conserva su
 * comportamiento anterior (no altera liquidaciones ya calculadas).
 */
describe("IIBB local Tucumán — base negativa (v1.2.0)", () => {
  it("base negativa: tributo 0, sin saldo a favor y con aviso", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period,
      facts: [],
      rules,
      incomeByActivity: { X: "-2000" },
    });
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("0.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("0.00");
    expect(result.warnings.some((w) => w.includes("Base negativa"))).toBe(true);
  });

  it("base negativa con mínimo global: no se aplica el mínimo en IIBB", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period,
      facts: [],
      rules,
      incomeByActivity: { X: "-2000" },
      minimum: new Decimal("400"),
    });
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("0.00");
  });

  it("la versión 1.1.0 conserva el arrastre de saldo a favor por base negativa", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_PREVIOUS_ENGINE_VERSION,
      period,
      facts: [],
      rules,
      incomeByActivity: { X: "-2000" },
    });
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("-20.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("20.00");
  });
});
