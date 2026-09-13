import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  calculateCm03,
  CM03_ENGINE_VERSION,
  CM03_LEGACY_ENGINE_VERSION,
} from "./cm03.js";

const period = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  cutoff: "2026-01-31",
};

function rules(overrides: Array<{ concept: string; rate?: string }> = []) {
  return overrides.map((r) => ({
    id: r.concept,
    concept: r.concept,
    code: r.concept,
    ...(r.rate !== undefined ? { rate: new Decimal(r.rate) } : {}),
    validFrom: "2026-01-01",
  }));
}

describe("CM03 artículo 2 (AR_IIBB_CM_ART2_V1)", () => {
  it("distribuye base país por coeficiente y aplica alícuota por jurisdicción", () => {
    const result = calculateCm03({
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([
        { concept: "TUC", rate: "0.04" },
        { concept: "CBA", rate: "0.035" },
      ]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "0.6", CBA: "0.4" },
    });
    expect(result.subtotals["BASE_PAIS"]).toBe("1000000.00");
    // TUC: 600000 × 0.04 = 24000; CBA: 400000 × 0.035 = 14000
    expect(result.subtotals["IMPUESTO_POR_JURISDICCION"]).toBe("38000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("38000.00");
    expect(result.engineVersion).toBe(CM03_ENGINE_VERSION);
  });

  it("bloquea si la suma de coeficientes no es 1", () => {
    const result = calculateCm03({
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "TUC", rate: "0.04" }]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "0.5" }, // suma 0.5
    });
    expect(result.blocks.some((b) => b.includes("suma de coeficientes"))).toBe(true);
  });

  it("bloquea sin coeficientes", () => {
    const result = calculateCm03({
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "TUC", rate: "0.04" }]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: {},
    });
    expect(result.blocks.some((b) => b.includes("coeficientes"))).toBe(true);
  });

  it("deduce retenciones y percepciones por jurisdicción", () => {
    const result = calculateCm03({
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([
        { concept: "TUC", rate: "0.04" },
        { concept: "CBA", rate: "0.035" },
      ]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "0.6", CBA: "0.4" },
      credits: {
        withholdingByJurisdiction: { TUC: new Decimal("5000"), CBA: new Decimal("2000") },
        perceptionByJurisdiction: { TUC: new Decimal("1000") },
      },
    });
    expect(result.subtotals["RETENCIONES"]).toBe("7000.00");
    expect(result.subtotals["PERCEPCIONES"]).toBe("1000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("30000.00"); // 38000 - 8000
  });

  it("aplica saldo a favor anterior por jurisdicción", () => {
    const result = calculateCm03({
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "TUC", rate: "0.04" }]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "1" },
      cmBalances: { previousCreditByJurisdiction: { TUC: "50000" } },
    });
    expect(result.subtotals["SALDO_ANTERIOR"]).toBe("50000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("10000.00"); // 40000 - 50000
  });

  it("no compensa un saldo a favor de una jurisdicción contra deuda de otra", () => {
    const result = calculateCm03({
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([
        { concept: "TUC", rate: "0.04" },
        { concept: "CBA", rate: "0.035" },
      ]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "0.6", CBA: "0.4" },
      cmBalances: { previousCreditByJurisdiction: { TUC: "30000" } },
    });
    expect(result.subtotals["SALDO_A_FAVOR_TUC"]).toBe("6000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR_CBA"]).toBe("14000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("14000.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("6000.00");
  });

  it("jurisdicción sin alícuota bloquea el motor vigente", () => {
    const result = calculateCm03({
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "TUC", rate: "0.04" }]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "0.6", CBA: "0.4" },
    });
    expect(result.blocks.some((block) => block.includes("CBA"))).toBe(true);
    expect(result.subtotals["IMPUESTO_POR_JURISDICCION"]).toBe("24000.00");
  });

  it("conserva la advertencia para el motor legacy v1.0", () => {
    const result = calculateCm03({
      engineVersion: CM03_LEGACY_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "TUC", rate: "0.04" }]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "0.6", CBA: "0.4" },
    });
    expect(result.engineVersion).toBe(CM03_LEGACY_ENGINE_VERSION);
    expect(result.warnings.some((warning) => warning.includes("CBA"))).toBe(true);
  });

  it("V-004: mismo input produce mismo hash", () => {
    const base = {
      engineVersion: CM03_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "TUC", rate: "0.04" }]),
      incomeByActivity: { COMERCIO: "1000000" },
      coefficients: { TUC: "1" },
    };
    const a = calculateCm03(base);
    const b = calculateCm03(base);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
  });
});
