/** Motor implementado y elegible para una versión de reglas fiscales. */
export interface TaxEngineOption {
  engineVersion: string;
  label: string;
}

/**
 * Identidad fiscal mínima para resolver motores. El código de régimen es
 * configurable por estudio, por lo que la familia se decide con el impuesto y
 * la jurisdicción del maestro fiscal, nunca con prefijos del código libre.
 */
export interface TaxRegimeEngineScope {
  regimeCode: string;
  taxTypeCode: string;
  jurisdictionCode: string;
}

type TaxEngineFamily =
  | "VAT_RI"
  | "IIBB_LOCAL_TUC"
  | "IIBB_CM03"
  | "TEM_SMT"
  | "MONOTRIBUTO";

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

const ENGINES_BY_FAMILY: Record<TaxEngineFamily, readonly TaxEngineOption[]> = {
  VAT_RI: IVA_RI_ENGINES,
  IIBB_LOCAL_TUC: IIBB_TUC_ENGINES,
  IIBB_CM03: CM03_ENGINES,
  TEM_SMT: TEM_SMT_ENGINES,
  MONOTRIBUTO: MONOTRIBUTO_ENGINES,
};

/** Jurisdicciones cubiertas por el motor local de IIBB (Tucumán). */
const IIBB_LOCAL_TUC_JURISDICTIONS = new Set(["AR-T"]);
/** Jurisdicciones cubiertas por el motor CM03 (Convenio Multilateral). */
const IIBB_CM03_JURISDICTIONS = new Set(["AR"]);
/** Jurisdicciones cubiertas por el motor TEM de San Miguel de Tucumán. */
const TEM_SMT_JURISDICTIONS = new Set(["AR-T", "AR-SMT"]);

/**
 * Resuelve la familia de motores a partir de datos estructurados del maestro
 * fiscal. Devuelve null (sin motores) cuando el impuesto o la jurisdicción no
 * tienen un motor implementado; nunca infiere por coincidencias parciales.
 */
export function taxEngineFamilyForRegime(scope: TaxRegimeEngineScope): TaxEngineFamily | null {
  // El maestro canónico histórico asoció el régimen MONOTRIBUTO al impuesto
  // IIBB. Se corrige por igualdad exacta del código canónico (no por prefijo)
  // para no derivar ese régimen al motor de Convenio Multilateral.
  if (scope.regimeCode === "MONOTRIBUTO" && scope.taxTypeCode === "IIBB") {
    return "MONOTRIBUTO";
  }

  switch (scope.taxTypeCode) {
    case "IVA":
      return "VAT_RI";
    case "IIBB":
      if (IIBB_LOCAL_TUC_JURISDICTIONS.has(scope.jurisdictionCode)) return "IIBB_LOCAL_TUC";
      if (IIBB_CM03_JURISDICTIONS.has(scope.jurisdictionCode)) return "IIBB_CM03";
      return null;
    case "TEM":
      return TEM_SMT_JURISDICTIONS.has(scope.jurisdictionCode) ? "TEM_SMT" : null;
    case "MONOTRIBUTO":
      return "MONOTRIBUTO";
    default:
      return null;
  }
}

/** Devuelve sólo motores implementados y compatibles con el régimen indicado. */
export function compatibleTaxEnginesForRegime(
  scope: TaxRegimeEngineScope,
): readonly TaxEngineOption[] {
  const family = taxEngineFamilyForRegime(scope);
  return family ? ENGINES_BY_FAMILY[family] : [];
}

/** Mensaje accionable para versiones que no tienen un despacho compatible. */
export function taxEngineVersionCompatibilityError(
  scope: TaxRegimeEngineScope,
  engineVersion: string,
): string | null {
  const options = compatibleTaxEnginesForRegime(scope);
  if (options.some((option) => option.engineVersion === engineVersion)) return null;
  const identity = `régimen "${scope.regimeCode}" (impuesto ${scope.taxTypeCode}, jurisdicción ${scope.jurisdictionCode})`;
  if (options.length === 0) {
    return `No hay motores fiscales soportados para el ${identity}.`;
  }
  return `El motor fiscal "${engineVersion}" no está soportado para el ${identity}. Motores compatibles: ${options
    .map((option) => option.engineVersion)
    .join(", ")}.`;
}
