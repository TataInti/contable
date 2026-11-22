import { describe, expect, it } from "vitest";
import { etiquetaRegimen, nombreRegimen, ordenarRegimenes } from "./etiquetaRegimen";

const completos = [
  { name: "IIBB Contribuyente Local Tucumán", taxType: { name: "Ingresos Brutos" }, jurisdiction: { name: "Provincia de Tucumán" } },
  { name: "Monotributo", taxType: { name: "Monotributo" }, jurisdiction: { name: "Argentina" } },
  { name: "Responsable Inscripto", taxType: { name: "IVA" }, jurisdiction: { name: "Argentina" } },
  { name: "TEM San Miguel de Tucumán", taxType: { name: "Tasa de Actividades Económicas (TEM)" }, jurisdiction: { name: "San Miguel de Tucumán" } },
];

describe("etiquetaRegimen", () => {
  it.each(completos)("arma una etiqueta completa: $name", (regimen) => {
    expect(etiquetaRegimen(regimen)).toBe(`${regimen.name} — ${regimen.taxType.name} · ${regimen.jurisdiction.name}`);
  });
  it("omite jurisdicción o impuesto si falta y no agrega separadores vacíos", () => {
    expect(etiquetaRegimen({ name: "Régimen", taxType: { name: "Impuesto" } })).toBe("Régimen — Impuesto");
    expect(etiquetaRegimen({ name: "Régimen", jurisdiction: { name: "Jurisdicción" } })).toBe("Régimen — Jurisdicción");
    expect(etiquetaRegimen({ name: "Régimen" })).toBe("Régimen");
    expect(etiquetaRegimen({ name: "Régimen", taxType: { name: " " }, jurisdiction: { name: undefined } })).toBe("Régimen");
  });
});

describe("nombreRegimen", () => {
  it("recorta espacios del nombre", () => {
    expect(nombreRegimen({ name: "  Régimen general  " })).toBe("Régimen general");
  });
  it("devuelve vacío cuando no hay nombre", () => {
    expect(nombreRegimen({ name: "   " })).toBe("");
    expect(nombreRegimen({})).toBe("");
  });
});

describe("ordenarRegimenes", () => {
  it("agrupa en orden nacional, provincial y municipal, y ordena los nombres dentro del nivel", () => {
    const entrada = [
      { ...completos[3]!, jurisdiction: { ...completos[3]!.jurisdiction, kind: "MUNICIPAL" } },
      { ...completos[0]!, jurisdiction: { ...completos[0]!.jurisdiction, kind: "PROVINCIAL" } },
      { ...completos[1]!, jurisdiction: { ...completos[1]!.jurisdiction, kind: "NATIONAL" } },
    ];
    const resultado = ordenarRegimenes(entrada);
    expect(resultado.agrupados).toBe(true);
    expect(resultado.grupos.map(({ nombre }) => nombre)).toEqual(["Nacional", "Provincial", "Municipal"]);
    expect(resultado.regimenes.map(({ name }) => name)).toEqual([completos[1]!.name, completos[0]!.name, completos[3]!.name]);
  });
  it("sin nivel jurisdiccional, ordena por jurisdicción y nombre", () => {
    const entrada = [completos[3]!, completos[0]!, completos[1]!];
    const resultado = ordenarRegimenes(entrada);
    expect(resultado.agrupados).toBe(false);
    expect(resultado.regimenes.map(({ name }) => name)).toEqual([completos[1]!.name, completos[0]!.name, completos[3]!.name]);
  });
});
