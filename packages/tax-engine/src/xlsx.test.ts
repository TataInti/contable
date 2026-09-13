import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseSifereWorkbook, buildSifereTemplate, SifereParseError } from "./xlsx.js";

/**
 * Golden tests del parser XLSX del libro IVA digital (SIFERE).
 * Usa el workbook real `demo-liquidacion-manual.xlsx` (período 2026-06).
 */

const fixture = () =>
  new Uint8Array(readFileSync(new URL("../fixtures/demo-liquidacion-manual.xlsx", import.meta.url)));

describe("parser XLSX libro IVA digital", () => {
  it("parsea la hoja de Ventas y clasifica por alícuota", () => {
    const result = parseSifereWorkbook(fixture(), "SALE");
    expect(result.sheetName.toLowerCase()).toContain("venta");
    expect(result.detailRows).toBeGreaterThan(0);
    expect(result.errorRows).toBe(0);

    const rate21 = result.rates.find((r) => r.rate === "21");
    expect(rate21).toBeDefined();
    expect(rate21!.count).toBeGreaterThan(0);
    // El demo no tiene ventas al 10,5% ni al 27%.
    expect(result.rates.find((r) => r.rate === "10.5")).toBeUndefined();
    expect(result.rates.find((r) => r.rate === "27")).toBeUndefined();

    // Total IVA del libro: 1.181.007,02 (AG16 del demo).
    expect(Number(result.totals.iva)).toBeCloseTo(1181007.02, 1);

    // Primera venta: factura A, CUIT 30658650242, 2026-06-04.
    const first = result.rows[0]!;
    expect(first.input.letter).toBe("A");
    expect(first.input.cuit).toBe("30658650242");
    expect(first.input.issuedOn).toBe("2026-06-04");
    expect(first.input.direction).toBe("SALE");
  });

  it("parsea la hoja de Compras y captura el rubro del proveedor", () => {
    const result = parseSifereWorkbook(fixture(), "PURCHASE");
    expect(result.sheetName.toLowerCase()).toContain("compra");
    expect(result.detailRows).toBeGreaterThan(0);
    expect(result.errorRows).toBe(0);

    // Hay proveedores SUPER y TRANSPORTE en el maestro.
    const rubros = new Set(result.rows.map((r) => r.rubro).filter(Boolean));
    expect(rubros.has("SUPER")).toBe(true);
    expect(rubros.has("TRANSPORTE")).toBe(true);

    // Primera compra: CUIT 30702388356, Chase/Hermanos (SUPER).
    const first = result.rows[0]!;
    expect(first.input.cuit).toBe("30702388356");
    expect(first.rubro).toBe("SUPER");
    expect(first.input.direction).toBe("PURCHASE");
    expect(first.input.letter).toBe("A");
  });

  it("informa los tributos asociados (percepciones IIBB y de IVA)", () => {
    const result = parseSifereWorkbook(fixture(), "PURCHASE");
    const codes = result.taxes.map((t) => t.code);
    // Las compras del demo tienen percepción de IVA (Crédito Fiscal Computable).
    expect(codes).toContain("PERCEPCION_IVA");
    expect(codes).toContain("PERCEPCIONES_IIBB");
  });

  it("rechaza bytes que no son un .xlsx", () => {
    expect(() => parseSifereWorkbook(new Uint8Array([1, 2, 3, 4]), "SALE")).toThrow(SifereParseError);
  });

  it("no depende del orden de hojas para ubicar el libro", () => {
    const sale = parseSifereWorkbook(fixture(), "SALE");
    const purchase = parseSifereWorkbook(fixture(), "PURCHASE");
    expect(sale.sheetName).not.toBe(purchase.sheetName);
  });

  it("genera plantilla .xlsx parseable (round-trip compras y ventas)", () => {
    for (const direction of ["SALE", "PURCHASE"] as const) {
      const template = buildSifereTemplate(direction);
      const result = parseSifereWorkbook(template, direction);
      expect(result.detailRows).toBe(1);
      expect(result.errorRows).toBe(0);
      expect(result.rates).toHaveLength(1);
      expect(result.rates[0]!.rate).toBe("21");
      expect(result.rows[0]!.input.cuit).toBe(
        direction === "SALE" ? "30658650242" : "30702388356",
      );
    }
  });
});