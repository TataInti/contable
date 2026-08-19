import { describe, expect, it } from "vitest";
import { requireTaxRegimeEnabled, TaxRegimeDisabledError } from "./tax-regime-guard.js";
import { taxRegimeFlagCode } from "../flags/feature-flag-service.js";
import type { FeatureFlagService } from "../flags/feature-flag-service.js";

/**
 * G6-10: activación progresiva por régimen fiscal.
 * Test de la lógica pura del guard, sin montar sesión HTTP ni DB.
 */

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorKind: "USER" as const,
};

function mockFlags(enabled: Record<string, boolean>): Pick<FeatureFlagService, "isEnabled"> {
  return {
    isEnabled: async (_ctx, code, _clientId) => enabled[code] ?? false,
  };
}

describe("taxRegimeFlagCode (G6-10)", () => {
  it("mapea cada régimen a su flag", () => {
    expect(taxRegimeFlagCode("RI")).toBe("TAX_RI");
    expect(taxRegimeFlagCode("IIBB_LOCAL_TUC")).toBe("TAX_IIBB_LOCAL_TUC");
    expect(taxRegimeFlagCode("TEM_SMT")).toBe("TAX_TEM_SMT");
    expect(taxRegimeFlagCode("CM_ART2")).toBe("TAX_CM_ART2");
    expect(taxRegimeFlagCode("MONOTRIBUTO")).toBe("TAX_MONOTRIBUTO");
  });

  it("devuelve null para régimen sin flag dedicado", () => {
    expect(taxRegimeFlagCode("DESCONOCIDO")).toBeNull();
  });
});

describe("requireTaxRegimeEnabled (G6-10)", () => {
  it("lanza TaxRegimeDisabledError si TAX está deshabilitado", async () => {
    await expect(
      requireTaxRegimeEnabled(mockFlags({ TAX: false }) as FeatureFlagService, ctx, "RI"),
    ).rejects.toBeInstanceOf(TaxRegimeDisabledError);
  });

  it("lanza TaxRegimeDisabledError si el flag del régimen está deshabilitado", async () => {
    await expect(
      requireTaxRegimeEnabled(mockFlags({ TAX: true, TAX_RI: false }) as FeatureFlagService, ctx, "RI"),
    ).rejects.toBeInstanceOf(TaxRegimeDisabledError);
  });

  it("resuelve true cuando TAX y el flag del régimen están habilitados", async () => {
    await expect(
      requireTaxRegimeEnabled(mockFlags({ TAX: true, TAX_RI: true }) as FeatureFlagService, ctx, "RI"),
    ).resolves.toBe(true);
  });

  it("permite régimen sin flag dedicado cuando TAX está habilitado", async () => {
    await expect(
      requireTaxRegimeEnabled(mockFlags({ TAX: true }) as FeatureFlagService, ctx, "DESCONOCIDO"),
    ).resolves.toBe(true);
  });

  it("TaxRegimeDisabledError expone code y statusCode 409", () => {
    const err = new TaxRegimeDisabledError("RI");
    expect(err.code).toBe("TAX_REGIME_DISABLED");
    expect(err.statusCode).toBe(409);
  });
});
