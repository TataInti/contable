import { describe, expect, it } from "vitest";
import {
  assertTaxEngineCatalogMatchesRegistry,
  TAX_ENGINE_DECLARATIONS,
  TaxEngineRegistryError,
  type TaxEngineCatalogRow,
} from "./engine-registry.js";

const catalogRows: TaxEngineCatalogRow[] = TAX_ENGINE_DECLARATIONS.map((engine) => ({
  engineKey: engine.engineKey,
  engineVersion: engine.engineVersion,
  isActive: true,
}));

describe("registro de motores fiscales", () => {
  it("acepta el catálogo sembrado con las nueve declaraciones vigentes", () => {
    expect(() => assertTaxEngineCatalogMatchesRegistry(catalogRows)).not.toThrow();
  });

  it("acumula motores desconocidos, ausentes, desalineados y claves duplicadas", () => {
    const rows = [
      ...catalogRows.filter((row) => row.engineKey !== "vat-ri-legacy"),
      { engineKey: "vat-ri", engineVersion: "versión-inesperada", isActive: true },
      { engineKey: "motor-sin-registro", engineVersion: "v1", isActive: true },
    ];

    let thrown: unknown;
    try {
      assertTaxEngineCatalogMatchesRegistry(rows);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TaxEngineRegistryError);
    expect((thrown as Error).message).toContain("motor-sin-registro");
    expect((thrown as Error).message).toContain("sin fila activa [vat-ri-legacy]");
    expect((thrown as Error).message).toContain("versión desalineada [vat-ri: catálogo versión-inesperada");
    expect((thrown as Error).message).toContain("engineKey duplicado [vat-ri]");
  });

  it("cuenta una declaración inactiva como sin fila activa", () => {
    const rows = catalogRows.map((row) => row.engineKey === "tem-smt"
      ? { ...row, isActive: false }
      : row);

    expect(() => assertTaxEngineCatalogMatchesRegistry(rows)).toThrow(/sin fila activa \[tem-smt\]/);
  });
});
