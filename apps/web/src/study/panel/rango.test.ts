import { describe, expect, it } from "vitest";
import { MENSAJE_RANGO_INVERTIDO, esRangoValido } from "./filtros";

// Hallazgo 58: el rango de vencimiento se valida en el cliente. Vacío = sin tope (válido).
describe("rango de vencimiento del panel (hallazgo 58)", () => {
  it("acepta rangos vacíos, de un solo extremo y con desde igual o anterior a hasta", () => {
    expect(esRangoValido("", "")).toBe(true);
    expect(esRangoValido("2026-10-16", "")).toBe(true);
    expect(esRangoValido("", "2026-10-16")).toBe(true);
    expect(esRangoValido("2026-10-16", "2026-10-16")).toBe(true);
    expect(esRangoValido("2026-10-01", "2026-11-30")).toBe(true);
  });

  it("rechaza «hasta» anterior a «desde»", () => {
    expect(esRangoValido("2026-12-31", "2026-01-01")).toBe(false);
    expect(esRangoValido("2026-10-16", "2026-10-01")).toBe(false);
  });

  it("el mensaje indica qué fecha corregir", () => {
    expect(MENSAJE_RANGO_INVERTIDO).toBe(
      "La fecha hasta tiene que ser igual o posterior a la fecha desde",
    );
  });
});
