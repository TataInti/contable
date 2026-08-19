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
  // G6-10: activación progresiva por régimen fiscal (PLAN §15.1).
  // El flag TAX habilita el módulo fiscal; los flags TAX_<REGIME_CODE>
  // permiten activar cada impuesto de forma independiente por firma/cliente.
  | "TAX_RI"
  | "TAX_IIBB_LOCAL_TUC"
  | "TAX_TEM_SMT"
  | "TAX_CM_ART2"
  | "TAX_MONOTRIBUTO";

export const FEATURE_FLAGS: FeatureFlagCode[] = [
  "DOCUMENTS",
  "LEDGER",
  "BANKING",
  "TAX",
  "REPORTING",
  "PORTAL",
  "ASSISTANT",
  "BI",
  "TAX_RI",
  "TAX_IIBB_LOCAL_TUC",
  "TAX_TEM_SMT",
  "TAX_CM_ART2",
  "TAX_MONOTRIBUTO",
];

/** Mapea un código de régimen fiscal a su flag de activación progresiva. */
export function taxRegimeFlagCode(regimeCode: string): FeatureFlagCode | null {
  switch (regimeCode) {
    case "RI":
      return "TAX_RI";
    case "IIBB_LOCAL_TUC":
      return "TAX_IIBB_LOCAL_TUC";
    case "TEM_SMT":
      return "TAX_TEM_SMT";
    case "CM_ART2":
      return "TAX_CM_ART2";
    case "MONOTRIBUTO":
      return "TAX_MONOTRIBUTO";
    default:
      return null;
  }
}

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