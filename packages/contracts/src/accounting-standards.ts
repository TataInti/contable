import { z } from "zod";

/**
 * Catálogo de normas contables por estudio (decisión de producto TataInti).
 *
 * Cada estudio define su propio catálogo de normas contables desde la sección
 * de Administración, como cualquier otro parámetro estandarizado. La ficha del
 * cliente deja de aceptar texto libre: `accountingStandard` se selecciona del
 * catálogo del estudio.
 *
 * No existen normas precargadas: el catálogo arranca vacío y el estudio da de
 * alta sus propios valores. Desactivar una norma NO invalida a los clientes que
 * la tienen asignada (se conserva su dato); sólo deja de ofrecerse en el
 * selector. Un valor que no pertenece al catálogo del estudio se rechaza al
 * guardar (422) — nunca se inventa ni se borra información existente.
 */

/** Alta de norma contable en el catálogo del estudio. */
export const createAccountingStandardSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
  })
  .strict();
export type CreateAccountingStandard = z.infer<typeof createAccountingStandardSchema>;

/** Edición de norma contable (nombre y/o estado de activación). */
export const updateAccountingStandardSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateAccountingStandard = z.infer<typeof updateAccountingStandardSchema>;

export interface CatalogAccountingStandard {
  name: string;
  isActive: boolean;
}

export interface AccountingStandardMatch {
  /** Nombres canónicos del catálogo, en orden de aparición y sin duplicados. */
  canonical: string[];
  /** Valores crudos sin match en el catálogo (sin alterar, para reportar). */
  unknown: string[];
}

function normalizeAccountingStandard(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Matching de normas contables contra el catálogo del estudio.
 *
 * Función pura compartida por backend y frontend (fuente única de las reglas):
 * - La API la usa para limitar `accountingStandard` al catálogo del estudio
 *   antes de guardar: valores sin match → 422; los matcheados se canonicalizan
 *   al nombre guardado en el catálogo. Valida contra TODAS las entradas del
 *   catálogo (activas e inactivas): una norma desactivada sigue siendo válida
 *   para los clientes que ya la tenían, así desactivar no rompe fichas.
 * - El frontend la usa para detectar el valor guardado fuera de catálogo y
 *   avisar antes de guardar (sin pérdida silenciosa).
 */
export function matchAccountingStandards(
  catalog: readonly CatalogAccountingStandard[],
  values: readonly string[],
): AccountingStandardMatch {
  const byName = new Map<string, string>();
  for (const entry of catalog) {
    const key = normalizeAccountingStandard(entry.name);
    if (key && !byName.has(key)) byName.set(key, entry.name);
  }

  const canonical: string[] = [];
  const unknown: string[] = [];
  for (const raw of values) {
    const key = normalizeAccountingStandard(raw);
    if (!key) continue;
    const name = byName.get(key);
    if (name) {
      if (!canonical.includes(name)) canonical.push(name);
    } else {
      unknown.push(raw.trim());
    }
  }
  return { canonical, unknown };
}
