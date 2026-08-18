import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { calculateTemSmt, TEM_SMT_ENGINE_VERSION } from "./tem.js";

const period = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  cutoff: "2026-01-31",
};

function rules(overrides: Array<{ concept: string; rate?: string; minimum?: string }> = []) {
  return overrides.map((r) => ({
    id: r.concept,
    concept: r.concept,
    code: r.concept,
    ...(r.rate !== undefined ? { rate: new Decimal(r.rate) } : {}),
    ...(r.minimum !== undefined ? { minimum: new Decimal(r.minimum) } : {}),
    validFrom: "2026-01-01",
  }));
}

describe("TEM San Miguel de Tucumán (AR_TEM_SMT_V1)", () => {
  it("calcula impuesto por actividad × alícuota", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([
        { concept: "COMERCIO", rate: "0.02" },
        { concept: "SERVICIOS", rate: "0.03" },
      ]),
      incomeByActivity: { COMERCIO: "100000", SERVICIOS: "50000" },
    });
    expect(result.subtotals["BASE_TOTAL"]).toBe("150000.00");
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("3500.00"); // 2000 + 1500
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("3500.00");
    expect(result.engineVersion).toBe(TEM_SMT_ENGINE_VERSION);
  });

  it("aplica mínimo si el cálculo por alícuota es menor", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { COMERCIO: "10000" }, // 200 < mínimo 500
      minimum: new Decimal("500"),
    });
    expect(result.subtotals["MINIMO_APLICADO"]).toBe("500.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("500.00");
  });

  it("deduce retenciones y percepciones", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { COMERCIO: "100000" }, // 2000
      credits: { withholding: new Decimal("500"), perception: new Decimal("200") },
    });
    expect(result.subtotals["RETENCIONES"]).toBe("500.00");
    expect(result.subtotals["PERCEPCIONES"]).toBe("200.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("1300.00");
  });

  it("aplica saldo a favor anterior", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { COMERCIO: "100000" }, // 2000
      balances: { previousCredit: "2500" },
    });
    expect(result.subtotals["SALDO_ANTERIOR"]).toBe("2500.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("500.00");
  });

  it("actividad sin alícuota se omite con advertencia", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { COMERCIO: "100000", OTRA: "50000" },
    });
    expect(result.warnings.some((w) => w.includes("OTRA"))).toBe(true);
    expect(result.subtotals["BASE_TOTAL"]).toBe("150000.00");
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("2000.00");
  });

  it("sin ingresos emite advertencia y total 0", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: {},
    });
    expect(result.warnings.some((w) => w.includes("No se declararon"))).toBe(true);
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
  });

  it("bloquea sin cutoff", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period: { ...period, cutoff: "" },
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { COMERCIO: "100000" },
    });
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it("V-004: mismo input produce mismo hash", () => {
    const base = {
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { COMERCIO: "100000" },
    };
    const a = calculateTemSmt(base);
    const b = calculateTemSmt(base);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
  });
});