/** Motor implementado y elegible para una versión de reglas fiscales. */
export interface TaxEngineOption {
  engineVersion: string;
  label: string;
}

const IVA_RI_ENGINES: readonly TaxEngineOption[] = [
  {
    engineVersion: "ar-vat-ri-v2.1.0",
    label: "IVA RI por alícuota (ar-vat-ri-v2.1.0)",
  },
  {
    engineVersion: "ar-vat-ri-v1.0.0",
    label: "IVA RI legacy (ar-vat-ri-v1.0.0)",
  },
];

const IIBB_TUC_ENGINES: readonly TaxEngineOption[] = [
  {
    engineVersion: "ar-iibb-tuc-local-v1.1.0",
    label: "IIBB local Tucumán (ar-iibb-tuc-local-v1.1.0)",
  },
  {
    engineVersion: "ar-iibb-tuc-local-v1.0.0",
    label: "IIBB local Tucumán legacy (ar-iibb-tuc-local-v1.0.0)",
  },
];

const CM03_ENGINES: readonly TaxEngineOption[] = [
  {
    engineVersion: "ar-iibb-cm-art2-v1.1.0",
    label: "IIBB CM03 artículo 2 (ar-iibb-cm-art2-v1.1.0)",
  },
  {
    engineVersion: "ar-iibb-cm-art2-v1.0.0",
    label: "IIBB CM03 artículo 2 legacy (ar-iibb-cm-art2-v1.0.0)",
  },
];

const TEM_SMT_ENGINES: readonly TaxEngineOption[] = [
  {
    engineVersion: "ar-tem-smt-v1.1.0",
    label: "TEM San Miguel de Tucumán (ar-tem-smt-v1.1.0)",
  },
  {
    engineVersion: "ar-tem-smt-v1.0.0",
    label: "TEM San Miguel de Tucumán legacy (ar-tem-smt-v1.0.0)",
  },
];

const MONOTRIBUTO_ENGINES: readonly TaxEngineOption[] = [
  {
    engineVersion: "ar-monotributo-v1.0.0",
    label: "Monotributo (ar-monotributo-v1.0.0)",
  },
];

const ENGINES_BY_REGIME_CODE: Record<string, readonly TaxEngineOption[]> = {
  RI: IVA_RI_ENGINES,
  IIBB_LOCAL_TUC: IIBB_TUC_ENGINES,
  CM_ART2: CM03_ENGINES,
  TEM_SMT: TEM_SMT_ENGINES,
  MONOTRIBUTO: MONOTRIBUTO_ENGINES,
};

const REGIME_CODES_LONGEST_FIRST = Object.keys(ENGINES_BY_REGIME_CODE).sort(
  (left, right) => right.length - left.length,
);

function mappedRegimeCode(regimeCode: string): string | undefined {
  return REGIME_CODES_LONGEST_FIRST.find(
    (knownCode) =>
      regimeCode === knownCode ||
      regimeCode.startsWith(`${knownCode}-`) ||
      regimeCode.startsWith(`${knownCode}_`),
  );
}

/** Devuelve sólo motores implementados y compatibles con el régimen indicado. */
export function compatibleTaxEnginesForRegime(
  regimeCode: string,
  jurisdictionCode?: string,
): readonly TaxEngineOption[] {
  const key = mappedRegimeCode(regimeCode);
  if (key) return ENGINES_BY_REGIME_CODE[key] ?? [];
  const isIibbLocalTestAlias =
    (regimeCode === "IIBB_LOCAL" ||
      regimeCode.startsWith("IIBB_LOCAL-") ||
      regimeCode.startsWith("IIBB_LOCAL_")) &&
    jurisdictionCode?.startsWith("AR-T");
  return isIibbLocalTestAlias ? IIBB_TUC_ENGINES : [];
}

/** Mensaje accionable para versiones que no tienen un despacho compatible. */
export function taxEngineVersionCompatibilityError(
  regimeCode: string,
  engineVersion: string,
  jurisdictionCode?: string,
): string | null {
  const options = compatibleTaxEnginesForRegime(regimeCode, jurisdictionCode);
  if (options.some((option) => option.engineVersion === engineVersion)) return null;
  if (options.length === 0) {
    return `No hay motores fiscales soportados para el régimen "${regimeCode}".`;
  }
  return `El motor fiscal "${engineVersion}" no está soportado para el régimen "${regimeCode}". Motores compatibles: ${options
    .map((option) => option.engineVersion)
    .join(", ")}.`;
}
