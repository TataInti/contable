import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CODE_PATTERN,
  createEconomicActivitySchema,
  normalizeActivityCode,
  updateEconomicActivitySchema,
} from "./economic-activities.js";

describe("contrato del catálogo de actividades económicas", () => {
  it("normaliza el código a mayúsculas y sin espacios al crear", () => {
    const parsed = createEconomicActivitySchema.parse({
      code: "  comercio  ",
      name: "Comercio de bienes",
      jurisdictionId: "11111111-2222-4333-8444-555555555555",
      validFrom: "2026-01-01",
    });
    expect(parsed.code).toBe("COMERCIO");
    expect(ACTIVITY_CODE_PATTERN.test(parsed.code)).toBe(true);
  });

  it("rechaza códigos vacíos, con símbolos o que excedan 40 caracteres", () => {
    for (const code of ["", "   ", "IVA;21", "a".repeat(41)]) {
      expect(
        createEconomicActivitySchema.safeParse({
          code,
          name: "X",
          jurisdictionId: "11111111-2222-4333-8444-555555555555",
          validFrom: "2026-01-01",
        }).success,
      ).toBe(false);
    }
  });

  it("acepta códigos con punto, guion, guion bajo y barra (estilo DGR/ARCA)", () => {
    for (const code of ["6201.01", "COMERCIO-MAYOR", "SERV_PROF", "IIBB/TUC"]) {
      expect(ACTIVITY_CODE_PATTERN.test(normalizeActivityCode(code))).toBe(true);
    }
  });

  it("la edición no admite code ni jurisdictionId (vínculo con reglas)", () => {
    const result = updateEconomicActivitySchema.safeParse({
      code: "OTRO",
      jurisdictionId: "11111111-2222-4333-8444-555555555555",
    });
    expect(result.success).toBe(false);
    expect(updateEconomicActivitySchema.safeParse({ name: "Nuevo nombre" }).success).toBe(true);
  });
});
