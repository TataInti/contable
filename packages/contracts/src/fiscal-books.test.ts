import { describe, expect, it } from "vitest";
import { FISCAL_BOOK_COLUMNS, fiscalBookExportQuerySchema, fiscalBookSummaryQuerySchema } from "./fiscal-books.js";

const PERIOD_ID = "0198f2a4-1b2c-7d3e-8f40-123456789abc";

describe("libros fiscales: columnas del libro (golden)", () => {
  it("fija el orden y los encabezados de las columnas", () => {
    expect(FISCAL_BOOK_COLUMNS.map((column) => [column.key, column.header])).toEqual([
      ["issuedOn", "Fecha de emisión"],
      ["accountingOn", "Fecha contable"],
      ["type", "Tipo"],
      ["letter", "Letra"],
      ["pointOfSale", "Punto de venta"],
      ["number", "Número"],
      ["issuerCuit", "CUIT emisor"],
      ["receiverCuit", "CUIT receptor"],
      ["currency", "Moneda"],
      ["exchangeRate", "Tipo de cambio"],
      ["neto", "Neto"],
      ["iva21", "IVA 21 %"],
      ["iva105", "IVA 10,5 %"],
      ["iva27", "IVA 27 %"],
      ["exento", "Exento"],
      ["otrosTributos", "Otros tributos"],
      ["total", "Total"],
    ]);
  });
});

describe("libros fiscales: parámetros de la solicitud", () => {
  it("usa xlsx, todas las columnas y orden por fecha de emisión por defecto", () => {
    const parsed = fiscalBookExportQuerySchema.parse({ periodId: PERIOD_ID, book: "purchases" });
    expect(parsed.format).toBe("xlsx");
    expect(parsed.columns).toEqual(FISCAL_BOOK_COLUMNS.map((column) => column.key));
    expect(parsed.sortBy).toBe("issuedOn");
    expect(parsed.sortDir).toBe("asc");
  });

  it("respeta el orden de columnas pedido y recorta los espacios", () => {
    const parsed = fiscalBookExportQuerySchema.parse({
      periodId: PERIOD_ID,
      book: "sales",
      format: "csv",
      columns: " total, issuedOn ,neto ",
    });
    expect(parsed.columns).toEqual(["total", "issuedOn", "neto"]);
    expect(parsed.format).toBe("csv");
  });

  it("indica el campo y el motivo cuando el libro no es válido", () => {
    const result = fiscalBookExportQuerySchema.safeParse({ periodId: PERIOD_ID, book: "compras" });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["book"]);
    expect(result.error.issues[0]?.message).toContain("«purchases»");
  });

  it("nombra la columna desconocida y el campo columns", () => {
    const result = fiscalBookExportQuerySchema.safeParse({
      periodId: PERIOD_ID,
      book: "purchases",
      columns: "neto,cuit",
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["columns"]);
    expect(result.error.issues[0]?.message).toContain("«cuit»");
  });

  it("rechaza columnas repetidas y listas sin columnas", () => {
    expect(
      fiscalBookExportQuerySchema.safeParse({ periodId: PERIOD_ID, book: "purchases", columns: "neto,neto" }).success,
    ).toBe(false);
    expect(
      fiscalBookExportQuerySchema.safeParse({ periodId: PERIOD_ID, book: "purchases", columns: " , " }).success,
    ).toBe(false);
  });

  it("valida el período y el formato con su campo", () => {
    const badPeriod = fiscalBookSummaryQuerySchema.safeParse({ periodId: "abc" });
    expect(badPeriod.success).toBe(false);
    expect(badPeriod.success ? undefined : badPeriod.error.issues[0]?.path).toEqual(["periodId"]);
    expect(
      fiscalBookExportQuerySchema.safeParse({ periodId: PERIOD_ID, book: "sales", format: "pdf" }).success,
    ).toBe(false);
  });
});
