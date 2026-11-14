import { describe, expect, it } from "vitest";
import { cuit } from "./primitives.js";
import { cuitEnding } from "./cuit-ending.js";

// CUIT sintéticos que valida `cuit`, uno por terminación (índice = dígito).
const VALID_BY_ENDING = [
  "20000000060",
  "20000000001",
  "20000000052",
  "20000000133",
  "20000000044",
  "20000000095",
  "20000000036",
  "20000000087",
  "20000000028",
  "20000000079",
];

describe("cuitEnding (terminación de CUIT)", () => {
  it("devuelve el último dígito con o sin guiones", () => {
    expect(cuitEnding("20-12345678-9")).toBe("9");
    expect(cuitEnding("30123456789")).toBe("9");
  });

  it("acepta CUIT válidos de cada terminación", () => {
    VALID_BY_ENDING.forEach((value, digit) => {
      expect(cuit.safeParse(value).success).toBe(true);
      expect(cuitEnding(value)).toBe(String(digit));
    });
  });

  it("coincide con el último carácter del CUIT que valida el contrato (paridad con el motor)", () => {
    for (const value of VALID_BY_ENDING) {
      expect(cuitEnding(value)).toBe(value.slice(-1));
    }
  });

  it("devuelve null cuando no hay CUIT", () => {
    expect(cuitEnding(null)).toBeNull();
    expect(cuitEnding(undefined)).toBeNull();
    expect(cuitEnding("")).toBeNull();
    expect(cuitEnding("   ")).toBeNull();
  });
});
