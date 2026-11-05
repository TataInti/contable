import { z } from "zod";

/**
 * Catálogo de actividades económicas (maestro fiscal por jurisdicción).
 *
 * Un único catálogo alimenta tres consumidores que hoy viven en pantallas
 * distintas: la ficha del cliente (client_activities → activityId),
 * la configuración fiscal (onboarding/onboarding fiscal) y las reglas de
 * los rule packs (tax_rate_rules.activityCode, texto).
 *
 * Invariantes que este contrato fija para TODOS los consumidores:
 * - El `code` es la clave de vínculo con las reglas: se normaliza
 *   (trim + mayúsculas) y no se edita una vez creado (PATCH lo rechaza),
 *   porque las reglas vigentes lo referencian como texto.
 * - La jurisdicción tampoco se edita: la unicidad es (code, jurisdiction).
 * - Desactivar (isActive=false) NO borra ni invalida valores históricos:
 *   los vínculos de cliente y las reglas existentes siguen resolviendo.
 *   Sólo deja de ofrecerse en los selectores y se rechaza en vínculos nuevos.
 */

/** Patrón de códigos aceptados: alfanumérico con punto, guion, guion bajo y barra. */
export const ACTIVITY_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]{0,39}$/;

/** Normaliza el código de actividad igual que el importador CM03/IIBB. */
export function normalizeActivityCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Alta de actividad económica en el catálogo. */
export const createEconomicActivitySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .transform(normalizeActivityCode)
      .refine((code) => ACTIVITY_CODE_PATTERN.test(code), {
        message:
          "El código debe empezar con alfanumérico y sólo contener letras, números, punto, guion, guion bajo o barra",
      }),
    name: z.string().trim().min(1).max(200),
    jurisdictionId: z.string().uuid(),
    source: z.string().trim().min(1).max(200).optional(),
    validFrom: z.string().date(),
    validTo: z.string().date().optional(),
  })
  .strict();
export type CreateEconomicActivity = z.infer<typeof createEconomicActivitySchema>;

/**
 * Edición de actividad económica. `code` y `jurisdictionId` NO son editables:
 * el código es el vínculo textual de las reglas y la jurisdicción es parte de
 * la clave de unicidad; cambiarlos rompería reglas vigentes e historial.
 */
export const updateEconomicActivitySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    source: z.string().trim().min(1).max(200).nullable().optional(),
    validFrom: z.string().date().optional(),
    validTo: z.string().date().nullable().optional(),
  })
  .strict();
export type UpdateEconomicActivity = z.infer<typeof updateEconomicActivitySchema>;

/** Contrato de lectura del catálogo (GET /api/v1/tax/activities). */
export interface CatalogEconomicActivity {
  id: string;
  code: string;
  name: string;
  jurisdictionId: string;
  source: string | null;
  validFrom: string;
  validTo: string | null;
  isActive: boolean;
}
