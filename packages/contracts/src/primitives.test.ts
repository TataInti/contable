import { describe, expect, it } from "vitest";
import { cuit, money } from "./primitives.js";

describe("cuit", () => {
  it("acepta CUIT válido", () => {
    expect(cuit.safeParse("20123456700").success).toBe(true);
  });

  it("rechaza menos de 11 dígitos", () => {
    expect(cuit.safeParse("2012345670").success).toBe(false);
  });

  it("rechaza dígito verificador inválido", () => {
    expect(cuit.safeParse("20123456789").success).toBe(false);
  });

  it("rechaza caracteres no numéricos", () => {
    expect(cuit.safeParse("20-12345678-9").success).toBe(false);
  });
});

describe("money", () => {
  it("acepta entero", () => {
    expect(money.safeParse("100000").success).toBe(true);
  });

  it("acepta decimal con hasta 4 posiciones", () => {
    expect(money.safeParse("100000.1234").success).toBe(true);
  });

  it("acepta negativo", () => {
    expect(money.safeParse("-100000.50").success).toBe(true);
  });

  it("rechaza más de 4 decimales", () => {
    expect(money.safeParse("100000.12345").success).toBe(false);
  });

  it("rechaza texto", () => {
    expect(money.safeParse("abc").success).toBe(false);
  });
});