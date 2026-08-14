import { describe, expect, it } from "vitest";
import { requireTaxEnabled, TaxLegacyDisabledError } from "./tax-flag-guard.js";
import type { FeatureFlagService } from "../flags/feature-flag-service.js";

/**
 * G0-01: el IVA legacy queda bloqueado por feature flag server-side.
 * Test de la lógica pura del guard, sin montar sesión HTTP ni DB.
 */

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorKind: "USER" as const,
};

function mockFlags(enabled: boolean): Pick<FeatureFlagService, "isEnabled"> {
  return {
    isEnabled: async (_ctx, code, _clientId) => {
      expect(code).toBe("TAX");
      return enabled;
    },
  };
}

describe("requireTaxEnabled (G0-01)", () => {
  it("lanza TaxLegacyDisabledError (410) cuando TAX está deshabilitado", async () => {
    await expect(requireTaxEnabled(mockFlags(false) as FeatureFlagService, ctx)).rejects.toBeInstanceOf(
      TaxLegacyDisabledError,
    );
  });

  it("resuelve true cuando TAX está habilitado", async () => {
    await expect(requireTaxEnabled(mockFlags(true) as FeatureFlagService, ctx)).resolves.toBe(true);
  });

  it("TaxLegacyDisabledError expone code y statusCode 410", () => {
    const err = new TaxLegacyDisabledError();
    expect(err.code).toBe("TAX_LEGACY_DISABLED");
    expect(err.statusCode).toBe(410);
  });
});
