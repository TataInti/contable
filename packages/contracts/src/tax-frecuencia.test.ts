import { describe, expect, it } from "vitest";
import { createDueDateRuleSchema } from "./tax.js";

const base = {
  jurisdictionId: "55555555-6666-4777-8888-bbbbbbbbbbbb",
  dueDay: 20,
  validFrom: "2026-01-01",
};

describe("contrato de vencimientos: frecuencia (D-R3-A)", () => {
  it("acepta MONTHLY y también omitir la frecuencia", () => {
    expect(createDueDateRuleSchema.safeParse({ ...base, frequency: "MONTHLY" }).success).toBe(true);
    expect(createDueDateRuleSchema.safeParse(base).success).toBe(true);
  });

  // Lista cerrada sin alias: «MENSUAL» no es un valor válido.
  it("rechaza MENSUAL", () => {
    expect(createDueDateRuleSchema.safeParse({ ...base, frequency: "MENSUAL" }).success).toBe(
      false,
    );
  });
});
