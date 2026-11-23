import { describe, expect, it } from "vitest";
import type { ClientProfile } from "./tipos";
import { profileGaps } from "./etiquetas";

// Norma contable opcional (decisión de Inti, A57, 23-nov-2026): no suma ni resta a la completitud de la ficha.
const DATOS_BASE = {
  vatCondition: "RESPONSABLE_INSCRIPTO",
  province: "Tucumán",
  activity: "Comercio",
} as unknown as ClientProfile;

describe("profileGaps — la norma contable es opcional (A57)", () => {
  it("una ficha con condición IVA, provincia y actividad, sin norma contable, no tiene faltantes", () => {
    expect(profileGaps({ profile: { ...DATOS_BASE, accountingStandard: null } })).toEqual([]);
  });

  it("cargar o no cargar una norma no cambia los faltantes", () => {
    expect(profileGaps({ profile: { ...DATOS_BASE, accountingStandard: "RTIC" } })).toEqual([]);
  });

  it("el único faltante que se nombra es el dato obligatorio que falta, nunca la norma", () => {
    expect(profileGaps({ profile: { ...DATOS_BASE, vatCondition: null, accountingStandard: null } })).toEqual([
      "condición IVA",
    ]);
  });
});
