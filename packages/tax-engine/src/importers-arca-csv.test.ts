import { describe, expect, it } from "vitest";
import { mapArcaCsvRow, normalizeArcaVoucherRow } from "./importers.js";

/**
 * A27-1: CSV o JSON con encabezados de ARCA. Datos ficticios.
 */

const VENTA = {
  "Fecha": "04/10/2026",
  "Tipo": "6 - Factura B",
  "Punto de Venta": "3",
  "Número Desde": "461",
  "Número Hasta": "461",
  "Cód. Autorización": "1234",
  "Tipo Doc. Receptor": "DNI",
  "Nro. Doc. Receptor": "12345678",
  "Denominación Receptor": "CLIENTE FICTICIO 001",
  "Tipo Cambio": "1",
  "Moneda": "$",
  "Neto Grav. IVA 21%": "1000",
  "IVA 21%": "210",
  "Neto Gravado Total": "1000",
  "Neto No Gravado": "0",
  "Op. Exentas": "0",
  "Otros Tributos": "0",
  "Total IVA": "210",
  "Imp. Total": "1210",
};

const COMPRA = {
  "Fecha": "10/10/2026",
  "Tipo": "1 - Factura A",
  "Punto de Venta": "12",
  "Número Desde": "345",
  "Número Hasta": "345",
  "Cód. Autorización": "5678",
  "Tipo Doc. Emisor": "CUIT",
  "Nro. Doc. Emisor": "30111111119",
  "Denominación Emisor": "PROVEEDOR FICTICIO 001",
  "Tipo Doc. Receptor": "CUIT",
  "Nro. Doc. Receptor": "30222222223",
  "Tipo Cambio": "1",
  "Moneda": "$",
  "Neto Grav. IVA 10,5%": "2000",
  "IVA 10,5%": "210",
  "Neto Gravado Total": "2000",
  "Neto No Gravado": "0",
  "Op. Exentas": "0",
  "Otros Tributos": "0",
  "Total IVA": "210",
  "Imp. Total": "2210",
};

describe("CSV con encabezados de ARCA", () => {
  it("una venta se mapea y queda válida, con la contraparte en el receptor", () => {
    const normalized = normalizeArcaVoucherRow(mapArcaCsvRow(VENTA, "SALE"));
    expect(normalized.status).toBe("VALID");
    expect(normalized.data).toMatchObject({
      direction: "SALE",
      letter: "B",
      pointOfSale: 3,
      numberFrom: 461,
      counterpartyCuit: "00012345678",
      issuedOn: "2026-10-04",
      net: "1000.0000",
      iva21: "210.0000",
      currency: "ARS",
    });
  });

  it("una compra toma la contraparte del emisor, aunque la fila traiga también el receptor", () => {
    const normalized = normalizeArcaVoucherRow(mapArcaCsvRow(COMPRA, "PURCHASE"));
    expect(normalized.status).toBe("VALID");
    expect(normalized.data).toMatchObject({ direction: "PURCHASE", letter: "A", counterpartyCuit: "30111111119", iva105: "210.0000" });
  });

  it("una fila ya canónica se devuelve tal cual", () => {
    const canonica = { direction: "SALE", letter: "A", pointOfSale: "1", numberFrom: "1", cuit: "20111111111", issuedOn: "2026-10-01", net: "100" };
    expect(mapArcaCsvRow(canonica, "PURCHASE")).toBe(canonica);
  });

  it("un tipo sin letra en el catálogo queda con LETTER_INVALID", () => {
    const normalized = normalizeArcaVoucherRow(mapArcaCsvRow({ ...VENTA, Tipo: "99 - Tipo sin catálogo" }, "SALE"));
    expect(normalized.status).toBe("ERROR");
    expect(normalized.errors).toContain("LETTER_INVALID");
  });

  it("un IVA a 5% con importe queda con ALICUOTA_NO_SOPORTADA", () => {
    const normalized = normalizeArcaVoucherRow(mapArcaCsvRow({ ...VENTA, "IVA 5%": "50", "Neto Grav. IVA 5%": "1000" }, "SALE"));
    expect(normalized.status).toBe("ERROR");
    expect(normalized.errors).toContain("ALICUOTA_NO_SOPORTADA");
  });

  it("una fecha inexistente queda con DATE_INVALID", () => {
    const normalized = normalizeArcaVoucherRow(mapArcaCsvRow({ ...VENTA, Fecha: "31/02/2026" }, "SALE"));
    expect(normalized.errors).toContain("DATE_INVALID");
  });

  it("acepta importes con coma decimal y separador de miles", () => {
    const normalized = normalizeArcaVoucherRow(
      mapArcaCsvRow({ ...VENTA, "Neto Gravado Total": "1.000,50", "IVA 21%": "210,50" }, "SALE"),
    );
    expect(normalized.status).toBe("VALID");
    expect(normalized.data).toMatchObject({ net: "1000.5000", iva21: "210.5000" });
  });

  it("sin columna de contraparte en el archivo, el CUIT queda inválido (no se asume consumidor final)", () => {
    const sinDocumento: Record<string, unknown> = { ...VENTA };
    delete sinDocumento["Nro. Doc. Receptor"];
    const normalized = normalizeArcaVoucherRow(mapArcaCsvRow(sinDocumento, "SALE"));
    expect(normalized.errors).toContain("CUIT_INVALID");
  });
});
