import type { FeatureFlagService } from "../flags/feature-flag-service.js";
import { isTaxRegimeFeatureFlagCode } from "../flags/feature-flag-service.js";
import type { TenantContext } from "../auth/tenant.js";

/**
 * G6-10: activación progresiva por régimen fiscal (PLAN §15.1, §15.2).
 *
 * El flag TAX habilita el módulo fiscal en general; cada régimen se activa
 * de forma independiente mediante TAX_<REGIME_CODE> (por firma o cliente).
 * El backend es la autoridad: la UI sólo refleja la decisión.
 *
 * Un impuesto puede apagarse sin ocultar resultados finalizados ni evidencia
 * (la lectura histórica no depende del flag; sólo las mutaciones de cálculo).
 */
export class TaxRegimeDisabledError extends Error {
  readonly code = "TAX_REGIME_DISABLED" as const;
  readonly statusCode = 409 as const;
  constructor(regimeCode: string) {
    super(`El régimen fiscal ${regimeCode} no está habilitado para este contexto.`);
    this.name = "TaxRegimeDisabledError";
  }
}

export class TaxRegimeModuleRequiredError extends Error {
  readonly code = "REGIME_MODULE_REQUIRED" as const;
  readonly statusCode = 409 as const;
  readonly details = { path: ["moduleId"] } as const;

  constructor() {
    super("Elegí el módulo que habilita este régimen");
    this.name = "TaxRegimeModuleRequiredError";
  }
}

export type TaxRegimeModuleForGuard = {
  key: string;
  flagCode: string | null;
  isActive: boolean;
} | null | undefined;

/**
 * Verifica que el régimen esté habilitado para el contexto.
 * - Si TAX está deshabilitado → lanza TaxRegimeDisabledError.
 * - La selección debe existir y estar activa; el catálogo decide el flag.
 * - ALWAYS_ENABLED omite solo el flag particular, nunca el flag global TAX.
 */
export async function requireTaxRegimeEnabled(
  flags: FeatureFlagService,
  ctx: TenantContext,
  regimeCode: string,
  module: TaxRegimeModuleForGuard,
): Promise<boolean> {
  const taxEnabled = await flags.isEnabled(ctx, "TAX", ctx.clientId ?? undefined);
  if (!taxEnabled) throw new TaxRegimeDisabledError(regimeCode);

  if (!module || module.isActive !== true) throw new TaxRegimeModuleRequiredError();
  if (module.key === "ALWAYS_ENABLED") {
    if (module.flagCode !== null) throw new TaxRegimeModuleRequiredError();
    return true;
  }

  if (!module.flagCode || !isTaxRegimeFeatureFlagCode(module.flagCode)) {
    throw new TaxRegimeModuleRequiredError();
  }

  const enabled = await flags.isEnabled(ctx, module.flagCode, ctx.clientId ?? undefined);
  if (!enabled) throw new TaxRegimeDisabledError(regimeCode);
  return true;
}
