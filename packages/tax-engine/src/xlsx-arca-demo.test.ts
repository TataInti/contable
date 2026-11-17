import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { arcaTipoLetter } from "./arca-columnas.js";
import { parseSifereWorkbook, SifereParseError } from "./xlsx.js";

// A27-1 · E2E del parser con los dos libros de demo de ARCA (ver fixtures/arca/LEEME.txt).
// Los nombres son sintéticos y los importes inventados: el repositorio es público.
// Las cifras salen del parser real y coinciden con la suma directa de las columnas del .xlsx
// (zipfile y xml, sin pasar por el parser).
const libro = (nombre: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/arca/${nombre}`, import.meta.url)));
const EMITIDOS = libro("mis-comprobantes-emitidos.xlsx");
const RECIBIDOS = libro("mis-comprobantes-recibidos.xlsx");

function codigoDeError(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof SifereParseError) return error.code;
    throw error;
  }
}

describe("A27-1 · libros de demo de ARCA (fixtures anonimizados)", () => {
  it("Emitidos cargado en Ventas: 384 comprobantes válidos, sin errores y con el IVA del libro", () => {
    const r = parseSifereWorkbook(EMITIDOS, "SALE");
    expect(r.sheetName).toBe("Sheet1");
    expect(r.detectedDirection).toBe("SALE");
    expect({ filas: r.detailRows, validas: r.validRows, conError: r.errorRows }).toEqual({
      filas: 384,
      validas: 384,
      conError: 0,
    });
    expect(r.totals.iva).toBe("7318548.81");
  });

  it("Recibidos cargado en Compras: 29 filas válidas, incluida la liquidación A (código 63), y el IVA del libro", () => {
    const r = parseSifereWorkbook(RECIBIDOS, "PURCHASE");
    expect(r.detectedDirection).toBe("PURCHASE");
    expect({ filas: r.detailRows, validas: r.validRows, conError: r.errorRows }).toEqual({
      filas: 29,
      validas: 29,
      conError: 0,
    });
    // Los totales ya sumaban todas las filas (incluida la 63): aceptarla no los mueve.
    expect(r.totals).toMatchObject({
      netoGravado: "27878874.24",
      iva: "4273727.40",
      importeTotal: "35296123.87",
    });
  });

  it("el código 63 es liquidación A y el 64 es liquidación B", () => {
    expect(arcaTipoLetter("63 - Liquidaciónes A")).toBe("A");
    expect(arcaTipoLetter("64 - Liquidación B")).toBe("B");
  });

  it("Emitidos cargado en Compras se rechaza con SHEET_DIRECTION_MISMATCH", () => {
    expect(codigoDeError(() => parseSifereWorkbook(EMITIDOS, "PURCHASE"))).toBe(
      "SHEET_DIRECTION_MISMATCH",
    );
  });

  it("Recibidos cargado en Ventas se rechaza con SHEET_DIRECTION_MISMATCH", () => {
    expect(codigoDeError(() => parseSifereWorkbook(RECIBIDOS, "SALE"))).toBe(
      "SHEET_DIRECTION_MISMATCH",
    );
  });
});
