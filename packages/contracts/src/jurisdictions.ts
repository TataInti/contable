/**
 * Matching de jurisdicciones IIBB contra el catálogo fiscal existente.
 *
 * Función pura compartida por backend y frontend (fuente única de las reglas):
 * - La API la usa para limitar los valores de `iibbJurisdictions` al catálogo
 *   (tabla `jurisdictions`) antes de guardar: valores sin match → 422, nunca
 *   se inventan códigos ni se eliminan datos existentes.
 * - El frontend la usa para preseleccionar checkboxes a partir de lo guardado
 *   y detectar valores guardados "fuera de catálogo" para avisar al usuario.
 *
 * Reglas (auditoría de catálogos):
 * - Match por código o por nombre del catálogo, insensible a mayúsculas,
 *   espacios y tildes ("Tucuman" matchea "Provincia de Tucumán").
 * - Un valor matcheado se canonicaliza al código del catálogo.
 * - Un valor sin match se devuelve tal cual en `unknown`: reportar la
 *   decisión necesaria es responsabilidad de quien consume el resultado,
 *   nunca se inventa un código.
 */
export interface CatalogJurisdiction {
  code: string;
  name: string;
}

export interface JurisdictionMatch {
  /** Códigos canónicos del catálogo, en orden de aparición y sin duplicados. */
  canonical: string[];
  /** Valores crudos sin match en el catálogo (sin alterar, para reportar). */
  unknown: string[];
}

function normalizeJurisdiction(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("es-AR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function matchIibbJurisdictions(
  catalog: readonly CatalogJurisdiction[],
  values: readonly string[],
): JurisdictionMatch {
  const byCode = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const entry of catalog) {
    const codeKey = normalizeJurisdiction(entry.code);
    if (codeKey && !byCode.has(codeKey)) byCode.set(codeKey, entry.code);
    const nameKey = normalizeJurisdiction(entry.name);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, entry.code);
  }

  const canonical: string[] = [];
  const unknown: string[] = [];
  for (const raw of values) {
    const key = normalizeJurisdiction(raw);
    if (!key) continue;
    const code = byCode.get(key) ?? byName.get(key);
    if (code) {
      if (!canonical.includes(code)) canonical.push(code);
    } else {
      unknown.push(raw.trim());
    }
  }
  return { canonical, unknown };
}
