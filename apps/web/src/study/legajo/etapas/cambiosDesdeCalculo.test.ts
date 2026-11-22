import { describe, expect, it } from "vitest";
import { cambiosDesdeCalculo } from "./seleccionCalculo";

// 4K: el resultado queda desactualizado cuando cambian el mínimo o los impuestos elegidos
// respecto del último cálculo aplicado. Datos inventados.
describe("cambiosDesdeCalculo (4K)", () => {
  it("sin cálculo aplicado no hay cambios que señalar", () => {
    expect(cambiosDesdeCalculo({ obligationIds: ["ob-iibb"], minimums: {} }, null)).toEqual({
      hayCambios: false,
      minimo: false,
      impuestos: false,
    });
  });

  it("el mismo cuerpo que se aplicó no marca desactualizado", () => {
    const cuerpo = { obligationIds: ["ob-iibb", "ob-tem"], minimums: { "ob-iibb": "11180" } };
    expect(cambiosDesdeCalculo(cuerpo, cuerpo).hayCambios).toBe(false);
  });

  it("cambiar el mínimo después de calcular marca desactualizado el mínimo", () => {
    const aplicado = { obligationIds: ["ob-iibb"], minimums: {} };
    const actual = { obligationIds: ["ob-iibb"], minimums: { "ob-iibb": "11180" } };
    expect(cambiosDesdeCalculo(actual, aplicado)).toEqual({ hayCambios: true, minimo: true, impuestos: false });
  });

  it("quitar el mínimo que se aplicó también marca desactualizado", () => {
    const aplicado = { obligationIds: ["ob-iibb"], minimums: { "ob-iibb": "11180" } };
    const actual = { obligationIds: ["ob-iibb"], minimums: {} };
    expect(cambiosDesdeCalculo(actual, aplicado)).toEqual({ hayCambios: true, minimo: true, impuestos: false });
  });

  it("el mismo importe escrito con decimales no es un cambio", () => {
    const aplicado = { obligationIds: ["ob-iibb"], minimums: { "ob-iibb": "11180" } };
    const actual = { obligationIds: ["ob-iibb"], minimums: { "ob-iibb": "11180.00" } };
    expect(cambiosDesdeCalculo(actual, aplicado).hayCambios).toBe(false);
  });

  it("marcar o desmarcar un impuesto después de calcular marca desactualizados los impuestos", () => {
    const aplicado = { obligationIds: ["ob-iibb"], minimums: {} };
    const actual = { obligationIds: ["ob-iibb", "ob-tem"], minimums: {} };
    expect(cambiosDesdeCalculo(actual, aplicado)).toEqual({ hayCambios: true, minimo: false, impuestos: true });
  });

  it("el orden de los impuestos marcados no cuenta como cambio", () => {
    const aplicado = { obligationIds: ["ob-iibb", "ob-tem"], minimums: {} };
    const actual = { obligationIds: ["ob-tem", "ob-iibb"], minimums: {} };
    expect(cambiosDesdeCalculo(actual, aplicado).hayCambios).toBe(false);
  });
});
