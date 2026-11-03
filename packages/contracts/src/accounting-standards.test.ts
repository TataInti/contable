import { describe, expect, it } from "vitest";
import {
  createAccountingStandardSchema,
  matchAccountingStandards,
  updateAccountingStandardSchema,
} from "./accounting-standards.js";

const catalog = [
  { name: "RTIC", isActive: true },
  { name: "VENCER", isActive: true },
  { name: "NCPP 2019", isActive: false },
];

describe("matchAccountingStandards", () => {
  it("canonicaliza al nombre del catálogo sin importar mayúsculas, espacios ni tildes", () => {
    const { canonical, unknown } = matchAccountingStandards(catalog, [
      " rtic ",
      "VENCER",
      "ncpp 2019",
    ]);
    expect(canonical).toEqual(["RTIC", "VENCER", "NCPP 2019"]);
    expect(unknown).toEqual([]);
  });

  it("matchea contra entradas inactivas: desactivar no invalida lo ya asignado", () => {
    const { canonical, unknown } = matchAccountingStandards(catalog, ["NCPP 2019"]);
    expect(canonical).toEqual(["NCPP 2019"]);
    expect(unknown).toEqual([]);
  });

  it("reporta los valores sin match tal cual, sin inventar nombres", () => {
    const { canonical, unknown } = matchAccountingStandards(catalog, ["NIIF 41", "RTIC"]);
    expect(canonical).toEqual(["RTIC"]);
    expect(unknown).toEqual(["NIIF 41"]);
  });

  it("deduplica y descarta vacíos", () => {
    const { canonical, unknown } = matchAccountingStandards(catalog, [
      "RTIC",
      "rtic",
      "   ",
      "",
    ]);
    expect(canonical).toEqual(["RTIC"]);
    expect(unknown).toEqual([]);
  });

  it("con catálogo vacío todo valor es unknown (sin texto libre implícito)", () => {
    const { canonical, unknown } = matchAccountingStandards([], ["RTIC"]);
    expect(canonical).toEqual([]);
    expect(unknown).toEqual(["RTIC"]);
  });
});

describe("esquemas de administración del catálogo", () => {
  it("alta exige nombre no vacío dentro del límite", () => {
    expect(createAccountingStandardSchema.parse({ name: "RTIC" }).name).toBe("RTIC");
    expect(() => createAccountingStandardSchema.parse({ name: "   " })).toThrow();
    expect(() =>
      createAccountingStandardSchema.parse({ name: "x".repeat(101) }),
    ).toThrow();
  });

  it("alta rechaza campos no declarados", () => {
    expect(() =>
      createAccountingStandardSchema.parse({ name: "RTIC", isActive: true }),
    ).toThrow();
  });

  it("edición acepta nombre y/o estado, y rechaza payload vacío", () => {
    expect(updateAccountingStandardSchema.parse({ isActive: false })).toEqual({
      isActive: false,
    });
    expect(updateAccountingStandardSchema.parse({ name: "Nueva" })).toEqual({
      name: "Nueva",
    });
    expect(() => updateAccountingStandardSchema.parse({ isActive: "sí" })).toThrow();
  });
});
