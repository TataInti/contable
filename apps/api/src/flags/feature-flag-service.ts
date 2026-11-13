import { Prisma } from "@prisma/client";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Feature flags (Fase 13).
 * Cada flag habilitada apunta a capacidad real, no mock.
 */

export type FeatureFlagCode =
  | "DOCUMENTS"
  | "LEDGER"
  | "BANKING"
  | "TAX"
  | "REPORTING"
  | "PORTAL"
  | "ASSISTANT"
  | "BI"
  | "TAX_RI"
  | "TAX_IIBB_LOCAL_TUC"
  | "TAX_TEM_SMT"
  | "TAX_CM_ART2"
  | "TAX_MONOTRIBUTO";

export const TAX_REGIME_FEATURE_FLAGS = [
  "TAX_RI",
  "TAX_IIBB_LOCAL_TUC",
  "TAX_TEM_SMT",
  "TAX_CM_ART2",
  "TAX_MONOTRIBUTO",
] as const;

export type TaxRegimeFeatureFlagCode = (typeof TAX_REGIME_FEATURE_FLAGS)[number];

export function isTaxRegimeFeatureFlagCode(code: string): code is TaxRegimeFeatureFlagCode {
  return TAX_REGIME_FEATURE_FLAGS.includes(code as TaxRegimeFeatureFlagCode);
}

export const FEATURE_FLAGS: FeatureFlagCode[] = [
  "DOCUMENTS",
  "LEDGER",
  "BANKING",
  "TAX",
  "REPORTING",
  "PORTAL",
  "ASSISTANT",
  "BI",
  ...TAX_REGIME_FEATURE_FLAGS,
];

export class FeatureFlagService {
  /** Habilita/deshabilita un flag para una firma (o cliente). */
  async set(
    ctx: TenantContext,
    input: { code: FeatureFlagCode; enabled: boolean; clientId?: string },
  ) {
    return withTenantContext(ctx, async (tx) => {
      const clientId = input.clientId ?? null;
      const existing = await tx.featureFlag.findFirst({
        where: { firmId: ctx.firmId, clientId, code: input.code },
      });

      if (existing) {
        return tx.featureFlag.update({
          where: { id: existing.id },
          data: { enabled: input.enabled },
        });
      }

      const data: Prisma.FeatureFlagUncheckedCreateInput = {
        firmId: ctx.firmId,
        code: input.code,
        enabled: input.enabled,
      };
      if (clientId !== null) data.clientId = clientId;
      return tx.featureFlag.create({ data });
    });
  }

  /** Consulta si un flag está habilitado (default: false). */
  async isEnabled(ctx: TenantContext, code: FeatureFlagCode, clientId?: string): Promise<boolean> {
    return withTenantContext(ctx, async (tx) => {
      // Flag específico de cliente primero, luego flag de firma
      if (clientId) {
        const clientFlag = await tx.featureFlag.findFirst({
          where: { firmId: ctx.firmId, clientId, code },
        });
        if (clientFlag) return clientFlag.enabled;
      }
      const firmFlag = await tx.featureFlag.findFirst({
        where: { firmId: ctx.firmId, clientId: null, code },
      });
      return firmFlag?.enabled ?? false;
    });
  }

  /** Lista flags de una firma. */
  async list(ctx: TenantContext) {
    return withTenantContext(ctx, async (tx) => {
      return tx.featureFlag.findMany({ where: { firmId: ctx.firmId } });
    });
  }
}