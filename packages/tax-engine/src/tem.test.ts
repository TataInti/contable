import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  calculateTemSmt,
  TEM_SMT_ENGINE_VERSION,
  TEM_SMT_LEGACY_ENGINE_VERSION,
} from "./tem.js";

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

  it("actividad sin alícuota bloquea el motor vigente", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { COMERCIO: "100000", OTRA: "50000" },
    });
    expect(result.blocks.some((block) => block.includes("OTRA"))).toBe(true);
    expect(result.subtotals["BASE_TOTAL"]).toBe("150000.00");
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("2000.00");
  });

  it("mantiene compatibilidad explícita con el motor legacy v1.0", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_LEGACY_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "COMERCIO", rate: "0.02" }]),
      incomeByActivity: { OTRA: "50000" },
    });
    expect(result.engineVersion).toBe(TEM_SMT_LEGACY_ENGINE_VERSION);
    expect(result.warnings.some((warning) => warning.includes("OTRA"))).toBe(true);
    expect(result.blocks).toHaveLength(0);
  });

  it("aplica mínimos por actividad", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([
        { concept: "TRANSPORTE", rate: "0.0125", minimum: "700" },
        { concept: "CANA", rate: "0.0125", minimum: "900" },
      ]),
      incomeByActivity: { TRANSPORTE: "10000", CANA: "10000" },
      minimumMode: "SUM_BY_ACTIVITY",
    });
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("250.00");
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("1600.00");
  });

  it("bloquea diferencias entre la fuente SMT y la regla versionada", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "TRANSPORTE", rate: "0.0125" }]),
      incomeByActivity: { TRANSPORTE: "100000" },
      minimum: new Decimal("61446"),
      declaredParameters: [
        { sourceId: "fila-1", activity: "TRANSPORTE", rate: "1.50", minimum: "60000" },
      ],
    });
    expect(result.blocks).toHaveLength(2);
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

/**
 * P2 4a-ii (C5/C9): en modo TYPED la alícuota se resuelve por `kind` RATE y
 * `activityId`; la etiqueta `concept` es solo traza. El mínimo por actividad y
 * los dos modos de mínimo se conservan.
 */
describe("TEM San Miguel de Tucumán — reglas tipadas", () => {
  const typedRules = [
    {
      id: "r-comercio",
      concept: "ALICUOTA_COMERCIO",
      code: "ALICUOTA_COMERCIO",
      kind: "RATE",
      activityId: "act-comercio",
      isDefault: false,
      rate: new Decimal("0.02"),
      minimum: new Decimal("500"),
      validFrom: "2026-01-01",
    },
    {
      id: "r-default",
      concept: "ALICUOTA_GENERAL",
      code: "ALICUOTA_GENERAL",
      kind: "RATE",
      activityId: null,
      isDefault: true,
      rate: new Decimal("0.03"),
      validFrom: "2026-01-01",
    },
  ];

  it("resuelve la alícuota por activityId aunque la etiqueta sea distinta", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      ruleMode: "TYPED",
      rules: typedRules,
      incomeByActivity: { "act-comercio": "100000" },
    });
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("2000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("2000.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("aplica el mínimo de la actividad tipada igual que el modo legacy", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      ruleMode: "TYPED",
      rules: typedRules,
      incomeByActivity: { "act-comercio": "10000" }, // 200 < mínimo 500
    });
    const legacy = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "act-comercio", rate: "0.02", minimum: "500" }]),
      incomeByActivity: { "act-comercio": "10000" },
    });
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("200.00");
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("500.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("500.00");
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe(
      legacy.subtotals["IMPUESTO_DETERMINADO"],
    );
  });

  it("usa la regla por defecto tipada para ingresos sin actividad", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      ruleMode: "TYPED",
      rules: typedRules,
      incomeByActivity: { "": "10000" }, // 3 % por defecto
    });
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("300.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("expresa el mínimo de mayor rendimiento fiscal y conserva la suma por actividad por defecto", () => {
    const rulesWithMinimums = [
      {
        id: "r-transporte",
        concept: "ALICUOTA_TRANSPORTE",
        code: "ALICUOTA_TRANSPORTE",
        kind: "RATE",
        activityId: "act-transporte",
        isDefault: false,
        rate: new Decimal("0.0125"),
        minimum: new Decimal("700"),
        validFrom: "2026-01-01",
      },
      {
        id: "r-cana",
        concept: "ALICUOTA_CANA",
        code: "ALICUOTA_CANA",
        kind: "RATE",
        activityId: "act-cana",
        isDefault: false,
        rate: new Decimal("0.0125"),
        minimum: new Decimal("900"),
        validFrom: "2026-01-01",
      },
    ];
    const incomeByActivity = { "act-transporte": "10000", "act-cana": "10000" };
    const byActivity = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      ruleMode: "TYPED",
      rules: rulesWithMinimums,
      incomeByActivity,
      minimumMode: "SUM_BY_ACTIVITY",
    });
    expect(byActivity.subtotals["IMPUESTO_DETERMINADO"]).toBe("1600.00"); // 700 + 900

    const highest = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      ruleMode: "TYPED",
      rules: rulesWithMinimums,
      incomeByActivity,
      minimumMode: "HIGHEST_YIELD",
    });
    expect(highest.subtotals["IMPUESTO_DETERMINADO"]).toBe("900.00"); // mayor mínimo
    expect(highest.subtotals["MINIMO_APLICADO"]).toBe("900.00");
    expect(highest.lines.some((line) => line.formula.includes("mayor rendimiento fiscal"))).toBe(true);
  });
});

/**
 * Ordenanza 4.536 (ar-tem-smt-v2.0.0): mayor rendimiento fiscal por defecto
 * (art. 139), mes sin ingresos paga el mínimo (art. 137) y base negativa sin
 * arrastre de saldo. La versión 1.1.0 conserva su comportamiento anterior.
 */
describe("TEM San Miguel de Tucumán — Ordenanza 4.536 (v2.0.0)", () => {
  const CAT_B = [
    { concept: "A1", rate: "0.01", minimum: "10028" },
    { concept: "A2", rate: "0.005", minimum: "10028" },
  ];

  it("usa el mínimo de mayor rendimiento fiscal por defecto (caso T3)", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules(CAT_B),
      incomeByActivity: { A1: "500000", A2: "300000" }, // 5.000 + 1.500 < 10.028
    });
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("10028.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("10028.00");
    expect(result.subtotals["MINIMO_APLICADO"]).toBe("10028.00");
  });

  it("suma los mínimos por actividad solo si se elige SUM_BY_ACTIVITY (caso T3c)", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules(CAT_B),
      incomeByActivity: { A1: "500000", A2: "300000" },
      minimumMode: "SUM_BY_ACTIVITY",
    });
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("20056.00");
  });

  it("un mes sin ingresos declarados paga el mínimo del régimen (caso T4)", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "X", rate: "0.01", minimum: "6210" }]),
      incomeByActivity: {},
    });
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("6210.00");
    expect(result.subtotals["MINIMO_APLICADO"]).toBe("6210.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("sin ingresos y con mínimos distintos por actividad bloquea y dice qué falta", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([
        { concept: "TRANSPORTE", rate: "0.0125", minimum: "700" },
        { concept: "CANA", rate: "0.0125", minimum: "900" },
      ]),
      incomeByActivity: {},
    });
    expect(result.blocks.some((block) => block.includes("cargá los ingresos por actividad"))).toBe(
      true,
    );
  });

  it("base negativa con mínimo: tributo igual al mínimo y sin saldo a favor (caso T6)", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "X", rate: "0.01", minimum: "6210" }]),
      incomeByActivity: { X: "-2000" },
    });
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("6210.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("0.00");
    expect(result.warnings.some((w) => w.includes("Base negativa"))).toBe(true);
  });

  it("base negativa sin mínimo: tributo 0 y el excedente no se convierte en saldo a favor", () => {
    const result = calculateTemSmt({
      engineVersion: TEM_SMT_ENGINE_VERSION,
      period,
      facts: [],
      rules: rules([{ concept: "X", rate: "0.01" }]),
      incomeByActivity: { X: "-2000" },
    });
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("0.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("0.00");
    expect(result.warnings.some((w) => w.includes("Base negativa"))).toBe(true);
  });

  it("la versión 1.1.0 conserva la suma por defecto y el arrastre de base negativa", () => {
    const sum = calculateTemSmt({
      engineVersion: "ar-tem-smt-v1.1.0",
      period,
      facts: [],
      rules: rules(CAT_B),
      incomeByActivity: { A1: "500000", A2: "300000" },
    });
    expect(sum.subtotals["IMPUESTO_DETERMINADO"]).toBe("20056.00");

    const negative = calculateTemSmt({
      engineVersion: "ar-tem-smt-v1.1.0",
      period,
      facts: [],
      rules: rules([{ concept: "X", rate: "0.01", minimum: "6210" }]),
      incomeByActivity: { X: "-2000" },
    });
    expect(negative.subtotals["SALDO_A_FAVOR"]).toBe("20.00");
    expect(negative.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
  });
});
