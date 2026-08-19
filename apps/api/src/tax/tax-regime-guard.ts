import type { FeatureFlagService } from "../flags/feature-flag-service.js";
import { taxRegimeFlagCode } from "../flags/feature-flag-service.js";
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

/**
 * Verifica que el régimen esté habilitado para el contexto.
 * - Si TAX está deshabilitado → lanza TaxRegimeDisabledError.
 * - Si el régimen no tiene flag asociado → se permite (compatibilidad).
 * - Si el flag del régimen está deshabilitado → lanza TaxRegimeDisabledError.
 */
export async function requireTaxRegimeEnabled(
  flags: FeatureFlagService,
  ctx: TenantContext,
  regimeCode: string,
): Promise<boolean> {
  const taxEnabled = await flags.isEnabled(ctx, "TAX", ctx.clientId ?? undefined);
  if (!taxEnabled) throw new TaxRegimeDisabledError(regimeCode);

  const flagCode = taxRegimeFlagCode(regimeCode);
  if (!flagCode) return true; // régimen sin flag dedicado → se rige por TAX

  const enabled = await flags.isEnabled(ctx, flagCode, ctx.clientId ?? undefined);
  if (!enabled) throw new TaxRegimeDisabledError(regimeCode);
  return true;
}
