import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { calculateMonotributo, MONOTRIBUTO_ENGINE_VERSION } from "./monotributo.js";

const period = {
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  cutoff: "2026-01-31",
};

describe("Monotributo (AR_MONOTRIBUTO_V1)", () => {
  it("calcula cuota por categoría desde parámetros", () => {
    const result = calculateMonotributo({
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      period,
      facts: [],
      rules: [],
      category: "B",
      parameters: { monthlyFeeByCategory: { B: "30000" } },
    });
    expect(result.subtotals["CATEGORIA"]).toBe("B");
    expect(result.subtotals["CUOTA_MENSUAL"]).toBe("30000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("30000.00");
    expect(result.engineVersion).toBe(MONOTRIBUTO_ENGINE_VERSION);
  });

  it("deduce pagos del período", () => {
    const result = calculateMonotributo({
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      period,
      facts: [],
      rules: [],
      category: "B",
      parameters: { monthlyFeeByCategory: { B: "30000" } },
      payments: { paid: new Decimal("12000") },
    });
    expect(result.subtotals["PAGOS"]).toBe("12000.00");
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("18000.00");
  });

  it("genera saldo a favor si el pago supera la cuota", () => {
    const result = calculateMonotributo({
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      period,
      facts: [],
      rules: [],
      category: "B",
      parameters: { monthlyFeeByCategory: { B: "30000" } },
      payments: { paid: new Decimal("35000") },
    });
    expect(result.subtotals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(result.subtotals["SALDO_A_FAVOR"]).toBe("5000.00");
  });

  it("usa regla con concept = categoría como fallback de cuota", () => {
    const result = calculateMonotributo({
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      period,
      facts: [],
      rules: [{ id: "B", concept: "B", code: "B", minimum: new Decimal("28000"), validFrom: "2026-01-01" }],
      category: "B",
    });
    expect(result.subtotals["CUOTA_MENSUAL"]).toBe("28000.00");
  });

  it("en reglas tipadas no toma la cuota desde el concept legacy", () => {
    const result = calculateMonotributo({
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      ruleMode: "TYPED",
      period,
      facts: [],
      rules: [{
        id: "legacy-B",
        concept: "B",
        code: "B",
        minimum: new Decimal("28000"),
        validFrom: "2026-01-01",
      }],
      category: "B",
    });

    expect(result.blocks).toContain("No hay cuota configurada para la categoría B");
    expect(result.totalDue).toBe("0.00");
  });

  it("bloquea sin cuota configurada para la categoría", () => {
    const result = calculateMonotributo({
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      period,
      facts: [],
      rules: [],
      category: "Z",
    });
    expect(result.blocks.some((b) => b.includes("categoría Z"))).toBe(true);
  });

  it("emite advertencia de recategorización pendiente (nunca automática)", () => {
    const result = calculateMonotributo({
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      period,
      facts: [],
      rules: [],
      category: "B",
      parameters: { monthlyFeeByCategory: { B: "30000" } },
    });
    expect(result.warnings.some((w) => w.includes("recategorización"))).toBe(true);
  });

  it("V-004: mismo input produce mismo hash", () => {
    const base = {
      engineVersion: MONOTRIBUTO_ENGINE_VERSION,
      period,
      facts: [],
      rules: [],
      category: "B",
      parameters: { monthlyFeeByCategory: { B: "30000" } },
    };
    const a = calculateMonotributo(base);
    const b = calculateMonotributo(base);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
  });
});