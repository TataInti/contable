import { describe, expect, it } from "vitest";
import { dec } from "./core.js";
import { calculateIIbbTuc, IIBB_TUC_ENGINE_VERSION } from "./iibb.js";

/**
 * Mínimo no imponible (corte 4C, «Probar» de Ingresos Brutos): monto que se
 * resta de la base antes de aplicar la alícuota. Si la base queda en cero o
 * negativa, el impuesto es cero. Es opcional y sin valor por defecto: sin
 * informarlo, el cálculo es el de siempre.
 */

const PERIOD = { startDate: "2026-09-01", endDate: "2026-09-30", cutoff: "2026-09-30" };
const RULES = [
  { id: "r1", code: "620100", concept: "620100", rate: dec("0.035"), validFrom: "2026-01-01" },
  { id: "r2", code: "DEFAULT", concept: "DEFAULT", rate: dec("0.035"), validFrom: "2026-01-01" },
];
const BASE = { engineVersion: IIBB_TUC_ENGINE_VERSION, period: PERIOD, facts: [], rules: RULES };

describe("IIBB Tucumán: mínimo no imponible (opcional)", () => {
  it("base menor que el mínimo no imponible: impuesto y total en cero", () => {
    const result = calculateIIbbTuc({
      ...BASE,
      incomeByActivity: { "620100": "3000.00" },
      nonTaxableMinimum: dec("5000"),
    });
    expect(result.subtotals["BASE_IMPONIBLE"]).toBe("0.00");
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("0.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(result.totalDue).toBe("0.00");
  });

  it("base mayor que el mínimo no imponible: se resta antes de aplicar la alícuota", () => {
    const result = calculateIIbbTuc({
      ...BASE,
      incomeByActivity: { "620100": "115000.00" },
      nonTaxableMinimum: dec("15000"),
    });
    expect(result.subtotals["MINIMO_NO_IMPONIBLE"]).toBe("15000.00");
    expect(result.subtotals["BASE_IMPONIBLE"]).toBe("100000.00");
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("3500.00");
    expect(result.totalDue).toBe("3500.00");
    const actividad = result.lines.find((line) => line.concept === "ACTIVIDAD_620100");
    expect(actividad?.formula).toContain("15000");
    expect(actividad?.result).toBe("3500.00");
  });

  it("el mínimo no imponible reparte la resta en orden de actividad hasta agotarse", () => {
    const result = calculateIIbbTuc({
      ...BASE,
      rules: [
        { id: "a", code: "A", concept: "A", rate: dec("0.01"), validFrom: "2026-01-01" },
        { id: "b", code: "B", concept: "B", rate: dec("0.05"), validFrom: "2026-01-01" },
      ],
      incomeByActivity: { A: "60000.00", B: "40000.00" },
      nonTaxableMinimum: dec("70000"),
    });
    // A absorbe 60.000 (queda en 0); B absorbe los 10.000 restantes: 30.000 × 5 %.
    expect(result.subtotals["BASE_IMPONIBLE"]).toBe("30000.00");
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("1500.00");
    expect(result.totalDue).toBe("1500.00");
  });

  it("con impuesto mínimo cargado, se compara el impuesto ya calculado sobre la base imponible", () => {
    const result = calculateIIbbTuc({
      ...BASE,
      incomeByActivity: { "620100": "115000.00" },
      nonTaxableMinimum: dec("15000"),
      minimum: dec("5000"),
    });
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("3500.00");
    expect(result.subtotals["MINIMO_APLICADO"]).toBe("5000.00");
    expect(result.totalDue).toBe("5000.00");
  });

  it("sin mínimo no imponible, el cálculo y los subtotales no cambian", () => {
    const sinCampo = calculateIIbbTuc({ ...BASE, incomeByActivity: { "620100": "115000.00" } });
    expect(sinCampo.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("4025.00");
    expect(sinCampo.totalDue).toBe("4025.00");
    expect(sinCampo.subtotals["MINIMO_NO_IMPONIBLE"]).toBeUndefined();
    expect(sinCampo.subtotals["BASE_IMPONIBLE"]).toBeUndefined();
    expect(sinCampo.lines.some((line) => line.concept === "MINIMO_NO_IMPONIBLE")).toBe(false);
  });
});
