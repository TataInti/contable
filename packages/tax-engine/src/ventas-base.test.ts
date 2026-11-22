import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { arcaTipoLetter, ARCA_NOTA_CREDITO_CODES, ARCA_NOTA_DEBITO_CODES } from "./arca-columnas.js";
import { mapArcaCsvRow, normalizeArcaVoucherRow } from "./importers.js";
import { parseSifereWorkbook } from "./xlsx.js";

/**
 * Corte 2C: las ventas de «Mis Comprobantes Emitidos» alimentan IVA, Ingresos Brutos y TEM.
 * Base por comprobante = neto gravado + no gravado + exentas, sin IVA ni otros tributos;
 * la Factura C sin neto discriminado aporta su importe total; las notas de crédito restan.
 * Los casos espejan caso-testigo/calculadora.py (modo A): test_01, 03, 04, 05, 06, 20 y 33.
 * Datos inventados.
 */

const BASE_FILA = {
  "Fecha": "04/10/2026",
  "Punto de Venta": "3",
  "Número Desde": "461",
  "Número Hasta": "461",
  "Tipo Doc. Receptor": "CUIT",
  "Nro. Doc. Receptor": "30111111119",
  "Denominación Receptor": "CLIENTE FICTICIO 001",
  "Tipo Cambio": "1",
  "Moneda": "$",
};

function venta(extra: Record<string, string>) {
  return normalizeArcaVoucherRow(mapArcaCsvRow({ ...BASE_FILA, ...extra }, "SALE"));
}

describe("base por comprobante (ventas)", () => {
  it("Factura A: neto + no gravado + exentas, sin IVA ni otros tributos (calculadora test_01)", () => {
    const result = venta({
      "Tipo": "1 - Factura A",
      "Neto Grav. IVA 21%": "50000",
      "IVA 21%": "10500",
      "Neto Gravado Total": "50000",
      "Neto No Gravado": "10000",
      "Op. Exentas": "5000",
      "Otros Tributos": "1500",
      "Total IVA": "10500",
      "Imp. Total": "77000",
    });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({
      letter: "A",
      net: "50000.0000",
      nonTaxed: "10000.0000",
      exempt: "5000.0000",
      base: "65000.0000",
      total: "77000.0000",
    });
  });

  it("Factura B: la base es el neto, sin el IVA", () => {
    const result = venta({
      "Tipo": "6 - Factura B",
      "Neto Grav. IVA 21%": "1000",
      "IVA 21%": "210",
      "Neto Gravado Total": "1000",
      "Neto No Gravado": "0",
      "Op. Exentas": "0",
      "Otros Tributos": "0",
      "Total IVA": "210",
      "Imp. Total": "1210",
    });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ letter: "B", base: "1000.0000", total: "1210.0000" });
  });

  it("Factura C con solo «Imp. Total» es válida y su base es el total (calculadora test_06)", () => {
    const result = venta({ "Tipo": "11 - Factura C", "Imp. Total": "55000" });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ letter: "C", net: "55000.0000", base: "55000.0000", total: "55000.0000" });
  });

  it("Factura C con los importes en cero y el total lleno: sigue siendo solo total", () => {
    const result = venta({
      "Tipo": "11 - Factura C",
      "Neto Gravado Total": "0",
      "Neto No Gravado": "0",
      "Op. Exentas": "0",
      "Otros Tributos": "0",
      "Total IVA": "0",
      "Imp. Total": "20000",
    });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ base: "20000.0000" });
  });

  it("en una fila de solo total, los otros tributos no integran la base", () => {
    const result = venta({ "Tipo": "11 - Factura C", "Otros Tributos": "500", "Imp. Total": "10500" });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ base: "10000.0000", total: "10500.0000" });
  });

  it("Nota de crédito C de solo total resta (calculadora test_20)", () => {
    const result = venta({ "Tipo": "13 - Nota de Crédito C", "Imp. Total": "5000" });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ letter: "NC", base: "-5000.0000" });
  });

  it("una nota de crédito que el archivo trae con signo negativo resta una sola vez (calculadora test_05)", () => {
    const result = venta({ "Tipo": "13 - Nota de Crédito C", "Imp. Total": "-300" });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ letter: "NC", base: "-300.0000" });
  });

  it("Nota de débito suma", () => {
    const result = venta({
      "Tipo": "12 - Nota de Débito C",
      "Imp. Total": "800",
    });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ letter: "ND", base: "800.0000" });
  });

  it("el código 203 (nota de crédito electrónica MiPyME A) es nota de crédito y resta", () => {
    const result = venta({
      "Tipo": "203 - Nota de Crédito Electrónica MiPyMEs (FCE) A",
      "Neto Grav. IVA 21%": "1000",
      "IVA 21%": "210",
      "Neto Gravado Total": "1000",
      "Imp. Total": "1210",
    });
    expect(result.status).toBe("VALID");
    expect(result.data).toMatchObject({ letter: "NC", base: "-1000.0000" });
  });

  it("una fila sin importes se rechaza con el motivo en palabras del contador", () => {
    const result = venta({ "Tipo": "11 - Factura C" });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toEqual(["AMOUNTS_MISSING"]);
  });

  it("una fila con todos los importes en cero también se rechaza", () => {
    const result = venta({
      "Tipo": "1 - Factura A",
      "Neto Gravado Total": "0",
      "Neto No Gravado": "0",
      "Op. Exentas": "0",
      "Imp. Total": "0",
    });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toEqual(["AMOUNTS_MISSING"]);
  });

  it("un importe que no es un número se rechaza y no se toma como cero", () => {
    const result = venta({ "Tipo": "1 - Factura A", "Neto Gravado Total": "1000", "Op. Exentas": "abc", "Imp. Total": "1000" });
    expect(result.status).toBe("ERROR");
    expect(result.errors).toEqual(["AMOUNT_INVALID"]);
  });

  it("una compra sin neto sigue rechazada: el cambio vale para las ventas", () => {
    const result = normalizeArcaVoucherRow(
      mapArcaCsvRow({ ...BASE_FILA, "Tipo": "11 - Factura C", "Imp. Total": "100" }, "PURCHASE"),
    );
    expect(result.status).toBe("ERROR");
    expect(result.errors).toContain("NET_INVALID");
  });
});

describe("tabla oficial de tipos de comprobante de ARCA", () => {
  const OFICIALES_NC = [3, 8, 13, 21, 38, 43, 44, 48, 53, 90, 110, 112, 113, 114, 119, 197, 203, 208, 213];
  const OFICIALES_ND = [2, 7, 12, 20, 37, 45, 46, 47, 52, 115, 116, 117, 120, 196, 202, 207, 212];

  it("reconoce los 19 códigos de nota de crédito", () => {
    expect([...ARCA_NOTA_CREDITO_CODES].sort((a, b) => a - b)).toEqual(OFICIALES_NC);
    for (const code of OFICIALES_NC) expect(arcaTipoLetter(String(code))).toBe("NC");
  });

  it("reconoce los 17 códigos de nota de débito", () => {
    expect([...ARCA_NOTA_DEBITO_CODES].sort((a, b) => a - b)).toEqual(OFICIALES_ND);
    for (const code of OFICIALES_ND) expect(arcaTipoLetter(String(code))).toBe("ND");
  });

  it("las 19 notas de crédito juntas restan 19.000 (calculadora test_04)", () => {
    const total = OFICIALES_NC.map((code) =>
      venta({ "Tipo": `${code} - Nota de crédito`, "Neto Gravado Total": "1000", "Imp. Total": "1000" }),
    ).reduce((sum, row) => sum + Number(row.data?.base ?? "NaN"), 0);
    expect(total).toBe(-19000);
  });

  it("la Factura B (código 6) no es nota de crédito", () => {
    expect(arcaTipoLetter("6")).toBe("B");
    expect(arcaTipoLetter("6 - Factura B")).toBe("B");
    expect(arcaTipoLetter("011 - Factura C")).toBe("C");
  });

  it("las facturas de crédito electrónica MiPyME entran con su letra", () => {
    expect(arcaTipoLetter("201")).toBe("A");
    expect(arcaTipoLetter("206")).toBe("B");
    expect(arcaTipoLetter("211")).toBe("C");
  });

  it("un código fuera de la tabla sigue sin letra", () => {
    expect(arcaTipoLetter("99 - Tipo sin catálogo")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// El mismo caso, con el Excel real: título en la fila 1, encabezados en la fila 2, datos desde la fila 3.
// ---------------------------------------------------------------------------

type Celda = string | number;

function columna(indice: number): string {
  return String.fromCharCode(65 + indice);
}

function libroEmitidos(encabezados: string[], filas: Array<Record<string, Celda>>): Uint8Array {
  const celda = (ref: string, valor: Celda) =>
    typeof valor === "number"
      ? `<c r="${ref}"><v>${valor}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${valor}</t></is></c>`;
  const matriz: Celda[][] = [
    ["Mis Comprobantes Emitidos - CUIT 20000000001"],
    encabezados,
    ...filas.map((fila) => encabezados.map((h) => fila[h] ?? "")),
  ];
  const datos = matriz
    .map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => (v === "" ? "" : celda(`${columna(c)}${r + 1}`, v))).join("")}</row>`)
    .join("");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${datos}</sheetData></worksheet>`,
    ),
  });
}

const ENCABEZADOS = [
  "Fecha", "Tipo", "Punto de Venta", "Número Desde", "Número Hasta",
  "Tipo Doc. Receptor", "Nro. Doc. Receptor", "Denominación Receptor", "Tipo Cambio", "Moneda",
  "Neto Gravado Total", "Neto No Gravado", "Op. Exentas", "Otros Tributos", "Total IVA", "Imp. Total",
];

const CLIENTE = { "Tipo Doc. Receptor": "CUIT", "Nro. Doc. Receptor": 30111111119, "Denominación Receptor": "CLIENTE FICTICIO", "Tipo Cambio": 1, "Moneda": "$" };

describe("Excel «Mis Comprobantes Emitidos» con Factura C y nota de crédito", () => {
  const libro = libroEmitidos(ENCABEZADOS, [
    { ...CLIENTE, "Fecha": "03/10/2026", "Tipo": "1 - Factura A", "Punto de Venta": 1, "Número Desde": 1, "Número Hasta": 1, "Neto Gravado Total": 50000, "Neto No Gravado": 10000, "Op. Exentas": 5000, "Otros Tributos": 1500, "Total IVA": 10500, "Imp. Total": 77000 },
    { ...CLIENTE, "Fecha": "10/10/2026", "Tipo": "11 - Factura C", "Punto de Venta": 2, "Número Desde": 1, "Número Hasta": 1, "Imp. Total": 55000 },
    { ...CLIENTE, "Fecha": "24/10/2026", "Tipo": "13 - Nota de Crédito C", "Punto de Venta": 2, "Número Desde": 2, "Número Hasta": 2, "Imp. Total": 5000 },
    { ...CLIENTE, "Fecha": "25/10/2026", "Tipo": "11 - Factura C", "Punto de Venta": 2, "Número Desde": 3, "Número Hasta": 3 },
  ]);

  it("las tres filas con importes quedan válidas y la fila vacía queda con su motivo", () => {
    const result = parseSifereWorkbook(libro, "SALE");
    expect(result.detailRows).toBe(4);
    expect(result.validRows).toBe(3);
    expect(result.errorRows).toBe(1);
    expect(result.rows[3]!.errors).toEqual(["AMOUNTS_MISSING"]);
  });

  it("la base del mes (A + C − NC) es la de la calculadora: 115.000", () => {
    const result = parseSifereWorkbook(libro, "SALE");
    const base = result.rows
      .filter((row) => row.errors.length === 0)
      .map((row) => normalizeArcaVoucherRow(row.input).data!.base)
      .reduce((sum, value) => sum + Number(value), 0);
    // calculadora.py, base_ventas(modo A): A 65.000 + C 55.000 − NC C 5.000 = 115.000
    expect(base).toBe(115000);
  });
});
