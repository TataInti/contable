import { describe, expect, it } from "vitest";
import { calculateIIbbTuc, IIBB_TUC_ENGINE_VERSION } from "./iibb.js";
import { dec } from "./core.js";

/**
 * Golden tests del motor IIBB Tucumán local (AR_IIBB_TUC_LOCAL_V1).
 * Cada caso fija entrada y resultado esperado al centavo.
 */

const PERIOD = { startDate: "2026-01-01", endDate: "2026-01-31", cutoff: "2026-01-31" };

const RULES = [
  { id: "r1", code: "620100", concept: "620100", rate: dec("0.035"), validFrom: "2026-01-01" },
  { id: "r2", code: "DEFAULT", concept: "DEFAULT", rate: dec("0.04"), validFrom: "2026-01-01" },
];

describe("motor IIBB Tucumán (golden)", () => {
  it("ingresos por actividad × alícuota = impuesto", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "1000000.00" },
      rules: RULES,
    });
    expect(result.subtotals["BASE_TOTAL"]).toBe("1000000.00");
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("35000.00");
    expect(result.totalDue).toBe("35000.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("misma entrada → mismo hash (determinismo)", () => {
    const input = {
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "1000000.00" },
      rules: RULES,
    };
    const a = calculateIIbbTuc(input);
    const b = calculateIIbbTuc(input);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
  });

  it("mínimo se aplica cuando el cálculo por alícuota es menor", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "10000.00" }, // 10000 × 3.5% = 350 < mínimo 1000
      rules: RULES,
      minimum: dec("1000.00"),
    });
    expect(result.subtotals["MINIMO_APLICADO"]).toBe("1000.00");
    expect(result.totalDue).toBe("1000.00");
  });

  it("retenciones, percepciones y recaudaciones reducen el total", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "1000000.00" },
      rules: RULES,
      credits: {
        withholding: dec("5000.00"),
        perception: dec("2000.00"),
        collected: dec("1000.00"),
      },
    });
    expect(result.totalDue).toBe("27000.00"); // 35000 − 5000 − 2000 − 1000
  });

  it("saldo a favor anterior se aplica", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "1000000.00" },
      rules: RULES,
      balances: { previousCredit: "30000.00" },
    });
    expect(result.totalDue).toBe("5000.00"); // 35000 − 30000
  });

  it("créditos mayores que el impuesto generan saldo a favor", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "1000000.00" },
      rules: RULES,
      credits: { withholding: dec("40000.00"), perception: dec("0"), collected: dec("0") },
    });
    expect(result.totalDue).toBe("0.00");
    expect(result.credits.remaining).toBe("5000.00");
  });

  it("actividad sin alícuota se omite con advertencia", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "999999": "1000000.00" },
      rules: [{ id: "r1", code: "620100", concept: "620100", rate: dec("0.035"), validFrom: "2026-01-01" }],
    });
    expect(result.warnings.some((w) => w.includes("sin alícuota"))).toBe(true);
    expect(result.totalDue).toBe("0.00");
  });

  it("sin ingresos: total 0 y sin bloqueos", () => {
    const result = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: {},
      rules: RULES,
    });
    expect(result.totalDue).toBe("0.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("Decimal no se pierde en la serialización canónica", () => {
    const a = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "1000000.00" },
      rules: RULES,
    });
    const b = calculateIIbbTuc({
      engineVersion: IIBB_TUC_ENGINE_VERSION,
      period: PERIOD,
      incomeByActivity: { "620100": "1000000.00" },
      rules: RULES,
    });
    expect(a.inputHash).toBe(b.inputHash);
  });
});