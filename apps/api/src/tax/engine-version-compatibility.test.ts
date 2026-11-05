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
} from "@contable/contracts";

describe("compatibilidad de motores fiscales", () => {
  it("enumera versiones implementadas por régimen, incluidas las legacy", () => {
    const implementedVersions: Record<string, string[]> = {
      RI: [VAT_RI_ENGINE_VERSION, VAT_ENGINE_VERSION],
      IIBB_LOCAL_TUC: [IIBB_TUC_ENGINE_VERSION, IIBB_TUC_LEGACY_ENGINE_VERSION],
      CM_ART2: [CM03_ENGINE_VERSION, CM03_LEGACY_ENGINE_VERSION],
      TEM_SMT: [TEM_SMT_ENGINE_VERSION, TEM_SMT_LEGACY_ENGINE_VERSION],
      MONOTRIBUTO: [MONOTRIBUTO_ENGINE_VERSION],
    };

    for (const [regimeCode, versions] of Object.entries(implementedVersions)) {
      expect(
        compatibleTaxEnginesForRegime(regimeCode).map((option) => option.engineVersion),
      ).toEqual(versions);
      for (const version of versions) {
        expect(taxEngineVersionCompatibilityError(regimeCode, version)).toBeNull();
      }
    }
  });

  it("rechaza la versión ficticia y los motores reales incompatibles con el régimen", () => {
    expect(taxEngineVersionCompatibilityError("RI", "tax-engine-v1")).toContain(
      "no está soportado",
    );
    expect(taxEngineVersionCompatibilityError("RI", CM03_ENGINE_VERSION)).toContain(
      "Motores compatibles",
    );
    expect(compatibleTaxEnginesForRegime("REGIMEN_SIN_MOTOR")).toEqual([]);
    expect(taxEngineVersionCompatibilityError("REGIMEN_SIN_MOTOR", "tax-engine-v1")).toContain(
      "No hay motores fiscales soportados",
    );
  });

  it("resuelve los códigos de régimen usados por los packs de prueba", () => {
    expect(compatibleTaxEnginesForRegime("RI-SET")[0]?.engineVersion).toBe(VAT_RI_ENGINE_VERSION);
    expect(compatibleTaxEnginesForRegime("IIBB_LOCAL-IIBB", "AR-T-IIBB")[0]?.engineVersion).toBe(
      IIBB_TUC_ENGINE_VERSION,
    );
    expect(compatibleTaxEnginesForRegime("CM_ART2-CM")[0]?.engineVersion).toBe(CM03_ENGINE_VERSION);
    expect(compatibleTaxEnginesForRegime("TEM_SMT-TEM")[0]?.engineVersion).toBe(TEM_SMT_ENGINE_VERSION);
    expect(compatibleTaxEnginesForRegime("MONOTRIBUTO-MONO")[0]?.engineVersion).toBe(
      MONOTRIBUTO_ENGINE_VERSION,
    );
  });
});
