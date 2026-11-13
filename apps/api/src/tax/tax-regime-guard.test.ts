import { describe, expect, it, vi } from "vitest";
import {
  requireTaxRegimeEnabled,
  TaxRegimeDisabledError,
  TaxRegimeModuleRequiredError,
  type TaxRegimeModuleForGuard,
} from "./tax-regime-guard.js";
import type { FeatureFlagService } from "../flags/feature-flag-service.js";

const ctx = {
  userId: "11111111-1111-4111-8111-111111111111",
  firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  actorKind: "USER" as const,
};

function mockFlags(enabled: Record<string, boolean>) {
  return {
    isEnabled: vi.fn(async (_ctx, code: string) => enabled[code] ?? false),
  } as unknown as FeatureFlagService & { isEnabled: ReturnType<typeof vi.fn> };
}

const iibbModule: TaxRegimeModuleForGuard = {
  key: "TAX_IIBB_LOCAL_TUC",
  flagCode: "TAX_IIBB_LOCAL_TUC",
  isActive: true,
};
const alwaysEnabledModule: TaxRegimeModuleForGuard = {
  key: "ALWAYS_ENABLED",
  flagCode: null,
  isActive: true,
};

describe("requireTaxRegimeEnabled", () => {
  it("usa el módulo elegido aunque se renombre el régimen", async () => {
    const flags = mockFlags({ TAX: true, TAX_IIBB_LOCAL_TUC: true });

    await expect(
      requireTaxRegimeEnabled(flags, ctx, "CODIGO_RENOMBRADO", iibbModule),
    ).resolves.toBe(true);

    expect(flags.isEnabled).toHaveBeenNthCalledWith(1, ctx, "TAX", undefined);
    expect(flags.isEnabled).toHaveBeenNthCalledWith(2, ctx, "TAX_IIBB_LOCAL_TUC", undefined);
  });

  it("bloquea cuando el flag del módulo elegido está apagado", async () => {
    await expect(
      requireTaxRegimeEnabled(
        mockFlags({ TAX: true, TAX_IIBB_LOCAL_TUC: false }),
        ctx,
        "IIBB_LOCAL_TUC",
        iibbModule,
      ),
    ).rejects.toBeInstanceOf(TaxRegimeDisabledError);
  });

  it("siempre habilitado omite el flag particular, no el flag global TAX", async () => {
    const enabled = mockFlags({ TAX: true });
    await expect(
      requireTaxRegimeEnabled(enabled, ctx, "REGIMEN_LIBRE", alwaysEnabledModule),
    ).resolves.toBe(true);
    expect(enabled.isEnabled).toHaveBeenCalledTimes(1);

    const disabled = mockFlags({ TAX: false });
    await expect(
      requireTaxRegimeEnabled(disabled, ctx, "REGIMEN_LIBRE", alwaysEnabledModule),
    ).rejects.toBeInstanceOf(TaxRegimeDisabledError);
    expect(disabled.isEnabled).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["inactivo", { key: "TAX_RI", flagCode: "TAX_RI", isActive: false }],
    ["flag desconocido", { key: "TAX_RI", flagCode: "TAX_NOT_ALLOWED", isActive: true }],
    ["ALWAYS_ENABLED con flag", { key: "ALWAYS_ENABLED", flagCode: "TAX_RI", isActive: true }],
  ] as Array<[string, TaxRegimeModuleForGuard]>)(
    "falla cerrado con guía si el módulo es %s",
    async (_label, module) => {
      await expect(
        requireTaxRegimeEnabled(mockFlags({ TAX: true, TAX_RI: true }), ctx, "REGIMEN", module),
      ).rejects.toMatchObject({
        code: "REGIME_MODULE_REQUIRED",
        statusCode: 409,
        message: "Elegí el módulo que habilita este régimen",
        details: { path: ["moduleId"] },
      });
    },
  );

  it("TaxRegimeDisabledError expone el código y el estado 409", () => {
    const error = new TaxRegimeDisabledError("RI");
    expect(error.code).toBe("TAX_REGIME_DISABLED");
    expect(error.statusCode).toBe(409);
  });
});
