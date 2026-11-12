export interface TaxEngineDeclaration {
  readonly engineKey: string;
  readonly engineVersion: string;
  readonly label: string;
}

export const TAX_ENGINE_DECLARATIONS = [
  { engineKey: "vat-ri", engineVersion: "ar-vat-ri-v2.1.0", label: "IVA RI por alícuota" },
  { engineKey: "vat-ri-legacy", engineVersion: "ar-vat-ri-v1.0.0", label: "IVA RI legacy" },
  { engineKey: "iibb-local-tuc", engineVersion: "ar-iibb-tuc-local-v1.1.0", label: "IIBB local Tucumán" },
  { engineKey: "iibb-local-tuc-legacy", engineVersion: "ar-iibb-tuc-local-v1.0.0", label: "IIBB local Tucumán legacy" },
  { engineKey: "iibb-cm-art2", engineVersion: "ar-iibb-cm-art2-v1.1.0", label: "IIBB CM03 artículo 2" },
  { engineKey: "iibb-cm-art2-legacy", engineVersion: "ar-iibb-cm-art2-v1.0.0", label: "IIBB CM03 artículo 2 legacy" },
  { engineKey: "tem-smt", engineVersion: "ar-tem-smt-v1.1.0", label: "TEM San Miguel de Tucumán" },
  { engineKey: "tem-smt-legacy", engineVersion: "ar-tem-smt-v1.0.0", label: "TEM San Miguel de Tucumán legacy" },
  { engineKey: "monotributo", engineVersion: "ar-monotributo-v1.0.0", label: "Monotributo" },
] as const satisfies readonly TaxEngineDeclaration[];

export type TaxEngineKey = (typeof TAX_ENGINE_DECLARATIONS)[number]["engineKey"];

export interface TaxEngineCatalogRow {
  engineKey: string;
  engineVersion: string;
  isActive: boolean;
}

export class TaxEngineRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxEngineRegistryError";
  }
}

export function taxEngineDeclaration(engineKey: string): TaxEngineDeclaration | undefined {
  return TAX_ENGINE_DECLARATIONS.find((declaration) => declaration.engineKey === engineKey);
}

/** Guarda de tipo para claves leídas de la base (por ejemplo `TaxEngine.engineKey`). */
export function isTaxEngineKey(value: string): value is TaxEngineKey {
  return TAX_ENGINE_DECLARATIONS.some((declaration) => declaration.engineKey === value);
}

/**
 * Respaldo de lectura (R4): versiones históricas sin `engineId` se despachan
 * por el texto `engineVersion`, que identifica un motor único del registro.
 * Devuelve `undefined` si el texto no pertenece a ningún motor implementado;
 * el llamador decide el error.
 */
export function taxEngineKeyForVersion(engineVersion: string): TaxEngineKey | undefined {
  const declaration = TAX_ENGINE_DECLARATIONS.find(
    (candidate) => candidate.engineVersion === engineVersion,
  );
  return declaration?.engineKey;
}

export function assertTaxEngineCatalogMatchesRegistry(
  rows: readonly TaxEngineCatalogRow[],
): void {
  const activeRows = rows.filter((row) => row.isActive);
  const unknown = activeRows
    .filter((row) => !taxEngineDeclaration(row.engineKey))
    .map((row) => row.engineKey);
  const missing = TAX_ENGINE_DECLARATIONS
    .filter((declaration) => !activeRows.some((row) => row.engineKey === declaration.engineKey))
    .map((declaration) => declaration.engineKey);
  const misaligned = activeRows.flatMap((row) => {
    const declaration = taxEngineDeclaration(row.engineKey);
    return declaration && row.engineVersion !== declaration.engineVersion
      ? [`${row.engineKey}: catálogo ${row.engineVersion}, código ${declaration.engineVersion}`]
      : [];
  });
  const counts = new Map<string, number>();
  for (const row of activeRows) counts.set(row.engineKey, (counts.get(row.engineKey) ?? 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1).map(([engineKey]) => engineKey);

  const issues = [
    ...(unknown.length ? [`sin calculador [${unknown.join(", ")}]`] : []),
    ...(missing.length ? [`sin fila activa [${missing.join(", ")}]`] : []),
    ...(misaligned.length ? [`versión desalineada [${misaligned.join("; ")}]`] : []),
    ...(duplicates.length ? [`engineKey duplicado [${duplicates.join(", ")}]`] : []),
  ];
  if (issues.length) {
    throw new TaxEngineRegistryError(`Catálogo de motores inconsistente: ${issues.join("; ")}.`);
  }
}
