import { describe, expect, it } from "vitest";
import { calculateIIbbTuc, IIBB_TUC_ENGINE_VERSION } from "./iibb.js";
import { dec } from "./core.js";

/**
 * Mínimo libre de IIBB Tucumán (decisión de Inti, 22-11-2026): el contador
 * ingresa el mínimo del mes; el motor lo aplica tal cual y el control de
 * parámetros declarados compara contra el mínimo versionado, no contra el libre.
 * Caso testigo: Facturas 65.000 + 55.000 − NC 5.000 = base 115.000; alícuota 3,5 %.
 */

const PERIOD = { startDate: "2026-09-01", endDate: "2026-09-30", cutoff: "2026-09-30" };
const RULES = [
  { id: "r1", code: "620100", concept: "620100", rate: dec("0.035"), validFrom: "2026-01-01" },
  { id: "r2", code: "DEFAULT", concept: "DEFAULT", rate: dec("0.035"), validFrom: "2026-01-01" },
];
const BASE = { engineVersion: IIBB_TUC_ENGINE_VERSION, period: PERIOD, incomeByActivity: { "620100": "115000.00" } };

describe("IIBB Tucumán: mínimo declarado por el contador", () => {
  it("el mínimo ingresado se aplica cuando es mayor que el impuesto por actividad", () => {
    const result = calculateIIbbTuc({ ...BASE, rules: RULES, minimum: dec("5000") });
    expect(result.subtotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("4025.00");
    expect(result.subtotals["MINIMO_APLICADO"]).toBe("5000.00");
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("5000.00");
    expect(result.totalDue).toBe("5000.00");
  });

  it("el mínimo ingresado no se aplica cuando el impuesto por actividad es mayor", () => {
    const result = calculateIIbbTuc({ ...BASE, rules: RULES, minimum: dec("1600") });
    expect(result.subtotals["MINIMO_APLICADO"]).toBeUndefined();
    expect(result.subtotals["IMPUESTO_DETERMINADO"]).toBe("4025.00");
    expect(result.totalDue).toBe("4025.00");
  });

  it("sin mínimo ingresado no se aplica ninguno", () => {
    const result = calculateIIbbTuc({ ...BASE, rules: RULES });
    expect(result.subtotals["MINIMO_APLICADO"]).toBeUndefined();
    expect(result.totalDue).toBe("4025.00");
  });

  it("el control de parámetros declarados compara con el mínimo versionado, no con el libre", () => {
    // El mínimo libre (1600) no coincide con el declarado por la fuente (5000), pero el versionado sí.
    const result = calculateIIbbTuc({
      ...BASE,
      rules: RULES,
      minimum: dec("1600"),
      controlMinimum: dec("5000"),
      declaredParameters: [{ sourceId: "fila-1", activity: "620100", minimum: "5000" }],
    });
    expect(result.blocks).toHaveLength(0);
  });

  it("el control sigue bloqueando cuando el mínimo declarado no coincide con el versionado", () => {
    const result = calculateIIbbTuc({
      ...BASE,
      rules: RULES,
      minimum: dec("5000"),
      controlMinimum: dec("4000"),
      declaredParameters: [{ sourceId: "fila-1", activity: "620100", minimum: "5000" }],
    });
    expect(result.blocks.some((b) => b.includes("no coincide con la regla versionada"))).toBe(true);
  });
});
