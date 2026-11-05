import { describe, expect, it } from "vitest";
import {
  CM03_ENGINE_VERSION,
  CM03_LEGACY_ENGINE_VERSION,
  IIBB_TUC_ENGINE_VERSION,
  IIBB_TUC_LEGACY_ENGINE_VERSION,
  MONOTRIBUTO_ENGINE_VERSION,
  TEM_SMT_ENGINE_VERSION,
  TEM_SMT_LEGACY_ENGINE_VERSION,
  VAT_ENGINE_VERSION,
  VAT_RI_ENGINE_VERSION,
} from "@contable/tax-engine";
import {
  compatibleTaxEnginesForRegime,
  taxEngineVersionCompatibilityError,
  type TaxRegimeEngineScope,
} from "@contable/contracts";

function scope(
  regimeCode: string,
  taxTypeCode: string,
  jurisdictionCode: string,
): TaxRegimeEngineScope {
  return { regimeCode, taxTypeCode, jurisdictionCode };
}

const CANONICAL_SCOPES: Array<[string, TaxRegimeEngineScope, string[]]> = [
  ["IVA RI", scope("RI", "IVA", "AR"), [VAT_RI_ENGINE_VERSION, VAT_ENGINE_VERSION]],
  [
    "IIBB local Tucumán",
    scope("IIBB_LOCAL_TUC", "IIBB", "AR-T"),
    [IIBB_TUC_ENGINE_VERSION, IIBB_TUC_LEGACY_ENGINE_VERSION],
  ],
  [
    "CM03 artículo 2",
    scope("CM_ART2", "IIBB", "AR"),
    [CM03_ENGINE_VERSION, CM03_LEGACY_ENGINE_VERSION],
  ],
  [
    "TEM San Miguel de Tucumán",
    scope("TEM_SMT", "TEM", "AR-T"),
    [TEM_SMT_ENGINE_VERSION, TEM_SMT_LEGACY_ENGINE_VERSION],
  ],
  [
    "Monotributo",
    scope("MONOTRIBUTO", "MONOTRIBUTO", "AR"),
    [MONOTRIBUTO_ENGINE_VERSION],
  ],
];

describe("compatibilidad de motores fiscales", () => {
  it("enumera las versiones implementadas por familia, incluidas las legacy", () => {
    for (const [, regimeScope, versions] of CANONICAL_SCOPES) {
      expect(
        compatibleTaxEnginesForRegime(regimeScope).map((option) => option.engineVersion),
      ).toEqual(versions);
      for (const version of versions) {
        expect(taxEngineVersionCompatibilityError(regimeScope, version)).toBeNull();
      }
    }
  });

  it("resuelve regímenes con código propio del estudio usando impuesto y jurisdicción", () => {
    const configurableScopes: Array<[TaxRegimeEngineScope, string]> = [
      [scope("RI_ESTUDIO_2026", "IVA", "AR"), VAT_RI_ENGINE_VERSION],
      [scope("IIBB_TUC_PROPIO", "IIBB", "AR-T"), IIBB_TUC_ENGINE_VERSION],
      [scope("CONVENIO_MULTILATERAL_ESTUDIO", "IIBB", "AR"), CM03_ENGINE_VERSION],
      [scope("TEM_PROPIO", "TEM", "AR-SMT"), TEM_SMT_ENGINE_VERSION],
      [scope("MONO_ESTUDIO", "MONOTRIBUTO", "AR"), MONOTRIBUTO_ENGINE_VERSION],
    ];

    for (const [regimeScope, expected] of configurableScopes) {
      expect(compatibleTaxEnginesForRegime(regimeScope)[0]?.engineVersion).toBe(expected);
    }
  });

  it("rechaza la versión ficticia tax-engine-v1 en todas las familias", () => {
    for (const [, regimeScope] of CANONICAL_SCOPES) {
      expect(taxEngineVersionCompatibilityError(regimeScope, "tax-engine-v1")).toContain(
        "no está soportado",
      );
      expect(taxEngineVersionCompatibilityError(regimeScope, "tax-engine-v1")).toContain(
        "Motores compatibles",
      );
    }
    expect(compatibleTaxEnginesForRegime(scope("DESCONOCIDO", "OTRO", "AR"))).toEqual([]);
  });

  it("no permite cruces entre familias aunque el motor exista", () => {
    const crosses: Array<[TaxRegimeEngineScope, string]> = [
      [scope("RI", "IVA", "AR"), CM03_ENGINE_VERSION],
      [scope("RI", "IVA", "AR"), MONOTRIBUTO_ENGINE_VERSION],
      [scope("IIBB_LOCAL_TUC", "IIBB", "AR-T"), CM03_ENGINE_VERSION],
      [scope("CM_ART2", "IIBB", "AR"), IIBB_TUC_ENGINE_VERSION],
      [scope("TEM_SMT", "TEM", "AR-T"), IIBB_TUC_ENGINE_VERSION],
      [scope("MONOTRIBUTO", "MONOTRIBUTO", "AR"), CM03_ENGINE_VERSION],
    ];

    for (const [regimeScope, crossedEngine] of crosses) {
      expect(taxEngineVersionCompatibilityError(regimeScope, crossedEngine)).toContain(
        "no está soportado",
      );
    }
  });

  it("no infiere la familia por prefijos ni coincidencias parciales del código de régimen", () => {
    // El código dice RI, pero el impuesto es IIBB: manda el impuesto.
    expect(
      compatibleTaxEnginesForRegime(scope("RI-FALSO", "IIBB", "AR"))[0]?.engineVersion,
    ).toBe(CM03_ENGINE_VERSION);
    expect(
      compatibleTaxEnginesForRegime(scope("IIBB_LOCAL_TUC-FALSO", "IIBB", "AR"))[0]?.engineVersion,
    ).toBe(CM03_ENGINE_VERSION);
    expect(compatibleTaxEnginesForRegime(scope("TEM_SMT", "TEM", "CBA"))).toEqual([]);
  });

  it("no ofrece motores para impuestos o jurisdicciones sin implementación", () => {
    const unsupported = [
      scope("RI", "OTRO", "AR"),
      scope("IIBB_CBA", "IIBB", "CBA"),
      scope("TEM_CBA", "TEM", "CBA"),
      scope("REGIMEN_SIN_MOTOR", "SIN_IMPUESTO", "AR"),
    ];
    for (const regimeScope of unsupported) {
      expect(compatibleTaxEnginesForRegime(regimeScope)).toEqual([]);
      expect(taxEngineVersionCompatibilityError(regimeScope, "ar-vat-ri-v2.1.0")).toContain(
        "No hay motores fiscales soportados",
      );
    }
  });

  it("corrige el maestro canónico histórico que asoció Monotributo al impuesto IIBB", () => {
    const legacyMono = scope("MONOTRIBUTO", "IIBB", "AR");
    expect(compatibleTaxEnginesForRegime(legacyMono).map((option) => option.engineVersion)).toEqual(
      [MONOTRIBUTO_ENGINE_VERSION],
    );
    expect(taxEngineVersionCompatibilityError(legacyMono, CM03_ENGINE_VERSION)).toContain(
      "no está soportado",
    );
  });
});
