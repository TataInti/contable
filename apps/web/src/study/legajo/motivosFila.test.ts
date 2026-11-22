import { describe, expect, it } from "vitest";
import { motivoDeFila } from "./motivosFila";

describe("motivos por fila del libro de ventas (corte 2C)", () => {
  it("una fila sin importes dice qué falta, en palabras del contador", () => {
    expect(motivoDeFila("AMOUNTS_MISSING")).toBe(
      "La fila no trae importes: el neto, el no gravado, las exentas y el total están vacíos o en cero.",
    );
  });

  it("un importe que no es un número se informa sin tomarlo como cero", () => {
    expect(motivoDeFila("AMOUNT_INVALID")).toBe(
      "Un importe de la fila (no gravado, exentas o total) no es un número válido.",
    );
  });
});
