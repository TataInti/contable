import { describe, expect, it } from "vitest";
import {
  isValidManualExtractionIsoDate,
  manualExtractionFieldError,
  normalizeManualExtractionAmount,
} from "./manual-extraction.js";

describe("formatos de carga manual", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["1234,56", "1234.56"],
    ["1234.56", "1234.56"],
    ["1234", "1234.00"],
    ["12.3", "12.30"],
    ["1.234", "1234.00"],
    ["-1.234,5", "-1234.50"],
  ])("normaliza el importe %s a %s", (input, expected) => {
    expect(normalizeManualExtractionAmount(input)).toBe(expected);
  });

  it.each(["texto", "1.234.56", "1234.567", "1,234.56", "-", "1,"])(
    "rechaza el importe ambiguo o no numérico %s",
    (input) => {
      expect(normalizeManualExtractionAmount(input)).toBeNull();
    },
  );

  it("valida la fecha ISO por calendario sin imponer un rango razonable", () => {
    expect(isValidManualExtractionIsoDate("0000-02-29")).toBe(true);
    expect(isValidManualExtractionIsoDate("2024-02-29")).toBe(true);
    expect(isValidManualExtractionIsoDate("2026-02-29")).toBe(false);
    expect(isValidManualExtractionIsoDate("2026-02-30")).toBe(false);
    expect(isValidManualExtractionIsoDate("12/11/2026")).toBe(false);
  });

  it("comprueba cantidad y caracteres del CUIT, sin verificar el dígito", () => {
    expect(manualExtractionFieldError("issuerTaxId", "00000000000")).toBeNull();
    expect(manualExtractionFieldError("receiverTaxId", "0000000000")).toContain("11 dígitos");
    expect(manualExtractionFieldError("issuerTaxId", "20-123456789")).toContain("11 dígitos");
  });
});
