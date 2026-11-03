import { describe, expect, it } from "vitest";
import {
  BACKED_CURRENCIES,
  clientProfileSchema,
  functionalCurrency,
  matchIibbJurisdictions,
  type CatalogJurisdiction,
} from "./index.js";

describe("catálogo de monedas funcionales (auditoría de catálogos)", () => {
  it("limita valores: solo las monedas respaldadas pasan", () => {
    expect(BACKED_CURRENCIES).toEqual(["ARS", "USD"]);
    for (const code of BACKED_CURRENCIES) {
      expect(functionalCurrency.parse(code)).toBe(code);
    }
  });

  it("rechaza códigos de 3 letras que no son monedas respaldadas (no se asume ISO 4217)", () => {
    // "PES" es alias del importador del libro IVA, no una moneda guardable.
    // "XXX" es código ISO reservado (sin transacciones) y no está respaldado.
    for (const rejected of ["EUR", "BRL", "PES", "XXX", "ABC"]) {
      expect(functionalCurrency.safeParse(rejected).success).toBe(false);
    }
  });

  it("normaliza mayúsculas y espacios para compatibilidad con datos previos", () => {
    expect(functionalCurrency.parse(" ars ")).toBe("ARS");
    expect(functionalCurrency.parse("usd")).toBe("USD");
  });

  it("rechaza longitudes incorrectas y no-strings", () => {
    expect(functionalCurrency.safeParse("AR").success).toBe(false);
    expect(functionalCurrency.safeParse("ARSS").success).toBe(false);
    expect(functionalCurrency.safeParse(3).success).toBe(false);
  });

  it("aplica el default ARS en el schema del perfil (alta)", () => {
    expect(clientProfileSchema.parse({}).functionalCurrency).toBe("ARS");
  });

  it("en PATCH parcial no inyecta el default si el campo no viene", () => {
    const parsed = clientProfileSchema.partial().parse({ vatCondition: "Responsable inscripto" });
    expect(parsed.functionalCurrency).toBeUndefined();
    expect(parsed.vatCondition).toBe("Responsable inscripto");
  });

  it("el schema del perfil rechaza una moneda fuera del catálogo", () => {
    expect(clientProfileSchema.partial().safeParse({ functionalCurrency: "EUR" }).success).toBe(false);
  });
});

describe("matching de jurisdicciones IIBB contra el catálogo", () => {
  const catalog: CatalogJurisdiction[] = [
    { code: "AR", name: "Argentina (Nación)" },
    { code: "AR-T", name: "Provincia de Tucumán" },
    { code: "AR-SMT", name: "San Miguel de Tucumán" },
    { code: "TUC", name: "Tucumán — Convenio Multilateral" },
  ];

  it("matchea por código y canonicaliza", () => {
    const { canonical, unknown } = matchIibbJurisdictions(catalog, ["AR-T"]);
    expect(canonical).toEqual(["AR-T"]);
    expect(unknown).toEqual([]);
  });

  it("matchea por nombre con mayúsculas, espacios y tildes distintos", () => {
    const { canonical, unknown } = matchIibbJurisdictions(catalog, [
      "  provincia de tucuman  ",
      "TUCUMAN — CONVENIO MULTILATERAL",
    ]);
    expect(canonical).toEqual(["AR-T", "TUC"]);
    expect(unknown).toEqual([]);
  });

  it("colapsa duplicados que apuntan a la misma jurisdicción", () => {
    const { canonical } = matchIibbJurisdictions(catalog, ["AR-T", "Provincia de Tucumán", "ar-t"]);
    expect(canonical).toEqual(["AR-T"]);
  });

  it("reporta valores sin match tal cual (no inventa códigos)", () => {
    const { canonical, unknown } = matchIibbJurisdictions(catalog, ["Sin match", "AR-T"]);
    expect(canonical).toEqual(["AR-T"]);
    expect(unknown).toEqual(["Sin match"]);
  });

  it("ignora vacíos y filtra espacios", () => {
    const { canonical, unknown } = matchIibbJurisdictions(catalog, ["", "   ", " AR-T "]);
    expect(canonical).toEqual(["AR-T"]);
    expect(unknown).toEqual([]);
  });

  it("con catálogo vacío, todo valor es desconocido", () => {
    const { canonical, unknown } = matchIibbJurisdictions([], ["AR-T"]);
    expect(canonical).toEqual([]);
    expect(unknown).toEqual(["AR-T"]);
  });

  it("mantiene el orden de aparición del primer match", () => {
    const { canonical } = matchIibbJurisdictions(catalog, ["TUC", "AR-T"]);
    expect(canonical).toEqual(["TUC", "AR-T"]);
  });
});
