import type { FeatureFlagService } from "../flags/feature-flag-service.js";
import type { TenantContext } from "../auth/tenant.js";

/**
 * G0-01: guard de feature flag para el IVA legacy.
 *
 * El IVA legacy queda bloqueado por flag server-side. Si TAX no está
 * habilitado, la ruta debe responder 410 TAX_LEGACY_DISABLED y no ejecutar
 * cálculo, finalización ni rectificación.
 *
 * Se extrae como función pura para poder testear la lógica de bloqueo sin
 * montar una sesión HTTP completa.
 */
export class TaxLegacyDisabledError extends Error {
  readonly code = "TAX_LEGACY_DISABLED" as const;
  readonly statusCode = 410 as const;
  constructor() {
    super("El IVA legacy está deshabilitado por flag. Use el nuevo flujo fiscal.");
    this.name = "TaxLegacyDisabledError";
  }
}

/**
 * Devuelve true si el IVA legacy está habilitado para el contexto.
 * Si está deshabilitado, lanza TaxLegacyDisabledError (410).
 */
export async function requireTaxEnabled(
  flags: FeatureFlagService,
  ctx: TenantContext,
): Promise<boolean> {
  const enabled = await flags.isEnabled(ctx, "TAX", ctx.clientId ?? undefined);
  if (!enabled) throw new TaxLegacyDisabledError();
  return true;
}
