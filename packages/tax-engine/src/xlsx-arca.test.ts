import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { buildSifereTemplate, parseSifereWorkbook, SifereParseError } from "./xlsx.js";

/**
 * A27-1: libros «Mis Comprobantes» de ARCA. Datos ficticios (nombres, CUIT y
 * documentos inventados); el libro se arma en la propia prueba y no se guarda
 * ningún binario en el repositorio.
 */

type Celda = string | number;

function libroArca(opciones: {
  titulo: string;
  hoja?: string;
  encabezados: string[];
  filas: Array<Record<string, Celda>>;
}): Uint8Array {
  const celda = (ref: string, valor: Celda) =>
    typeof valor === "number"
      ? `<c r="${ref}"><v>${valor}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${valor.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</t></is></c>`;
  const columna = (indice: number) => String.fromCharCode(65 + indice);
  const matriz: Celda[][] = [
    [opciones.titulo],
    opciones.encabezados,
    ...opciones.filas.map((fila) => opciones.encabezados.map((h) => fila[h] ?? "")),
  ];
  const datos = matriz
    .map((fila, r) => `<row r="${r + 1}">${fila.map((v, c) => celda(`${columna(c)}${r + 1}`, v)).join("")}</row>`)
    .join("");
  const hoja = (opciones.hoja ?? "Sheet1").replaceAll('"', "&quot;");
  return zipSync({
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${datos}</sheetData></worksheet>`,
    ),
  });
}

const ENCABEZADOS_EMITIDOS = [
  "Fecha", "Tipo", "Punto de Venta", "Número Desde", "Número Hasta", "Cód. Autorización",
  "Tipo Doc. Receptor", "Nro. Doc. Receptor", "Denominación Receptor", "Tipo Cambio", "Moneda",
  "Neto Grav. IVA 0%", "IVA 2,5%", "Neto Grav. IVA 2,5%", "IVA 5%", "Neto Grav. IVA 5%",
  "IVA 10,5%", "Neto Grav. IVA 10,5%", "IVA 21%", "Neto Grav. IVA 21%", "IVA 27%", "Neto Grav. IVA 27%",
  "Neto Gravado Total", "Neto No Gravado", "Op. Exentas", "Otros Tributos", "Total IVA", "Imp. Total",
];

const ENCABEZADOS_RECIBIDOS = [
  "Fecha", "Tipo", "Punto de Venta", "Número Desde", "Número Hasta", "Cód. Autorización",
  "Tipo Doc. Emisor", "Nro. Doc. Emisor", "Denominación Emisor", "Tipo Doc. Receptor", "Nro. Doc. Receptor",
  "Tipo Cambio", "Moneda", "Neto Grav. IVA 21%", "IVA 21%", "Neto Grav. IVA 10,5%", "IVA 10,5%",
  "Neto Gravado Total", "Neto No Gravado", "Op. Exentas", "Otros Tributos", "Total IVA", "Imp. Total",
];

const VENTAS_FICTICIAS: Array<Record<string, Celda>> = [
  {
    "Fecha": "04/10/2026", "Tipo": "6 - Factura B", "Punto de Venta": 3, "Número Desde": 461, "Número Hasta": 461,
    "Tipo Doc. Receptor": "DNI", "Nro. Doc. Receptor": 12345678, "Denominación Receptor": "CLIENTE FICTICIO 001",
    "Tipo Cambio": 1, "Moneda": "$", "Neto Grav. IVA 21%": 1000, "IVA 21%": 210,
    "Neto Gravado Total": 1000, "Neto No Gravado": 0, "Op. Exentas": 0, "Otros Tributos": 0, "Total IVA": 210, "Imp. Total": 1210,
  },
  {
    "Fecha": "05/10/2026", "Tipo": "1 - Factura A", "Punto de Venta": 3, "Número Desde": 462, "Número Hasta": 462,
    "Tipo Doc. Receptor": "CUIT", "Nro. Doc. Receptor": 30111111119, "Denominación Receptor": "CLIENTE FICTICIO 002",
    "Tipo Cambio": 1, "Moneda": "$", "Neto Grav. IVA 10,5%": 2000, "IVA 10,5%": 210,
    "Neto Gravado Total": 2000, "Neto No Gravado": 0, "Op. Exentas": 0, "Otros Tributos": 0, "Total IVA": 210, "Imp. Total": 2210,
  },
  {
    "Fecha": "06/10/2026", "Tipo": "8 - Nota de Crédito B", "Punto de Venta": 3, "Número Desde": 463, "Número Hasta": 463,
    "Tipo Doc. Receptor": "Consumidor Final", "Nro. Doc. Receptor": "", "Denominación Receptor": "CONSUMIDOR FINAL",
    "Tipo Cambio": 1, "Moneda": "$", "Neto Grav. IVA 21%": 500, "IVA 21%": 105,
    "Neto Gravado Total": 500, "Neto No Gravado": 0, "Op. Exentas": 0, "Otros Tributos": 0, "Total IVA": 105, "Imp. Total": 605,
  },
];

const COMPRAS_FICTICIAS: Array<Record<string, Celda>> = [
  {
    "Fecha": "10/10/2026", "Tipo": "1 - Factura A", "Punto de Venta": 12, "Número Desde": 345, "Número Hasta": 345,
    "Tipo Doc. Emisor": "CUIT", "Nro. Doc. Emisor": 30111111119, "Denominación Emisor": "PROVEEDOR FICTICIO 001",
    "Tipo Doc. Receptor": "CUIT", "Nro. Doc. Receptor": 30222222223, "Tipo Cambio": 1, "Moneda": "$",
    "Neto Grav. IVA 21%": 2000, "IVA 21%": 420, "Neto Gravado Total": 2000, "Neto No Gravado": 0,
    "Op. Exentas": 0, "Otros Tributos": 0, "Total IVA": 420, "Imp. Total": 2420,
  },
  {
    "Fecha": "11/10/2026", "Tipo": "99 - Tipo sin catálogo", "Punto de Venta": 12, "Número Desde": 346, "Número Hasta": 346,
    "Tipo Doc. Emisor": "CUIT", "Nro. Doc. Emisor": 30444444441, "Denominación Emisor": "PROVEEDOR FICTICIO 002",
    "Tipo Doc. Receptor": "CUIT", "Nro. Doc. Receptor": 30222222223, "Tipo Cambio": 1, "Moneda": "$",
    "Neto Grav. IVA 21%": 0, "IVA 21%": 0, "Neto Gravado Total": 1000, "Neto No Gravado": 0,
    "Op. Exentas": 0, "Otros Tributos": 0, "Total IVA": 0, "Imp. Total": 1000,
  },
  {
    "Fecha": "12/10/2026", "Tipo": "6 - Factura B", "Punto de Venta": 12, "Número Desde": 347, "Número Hasta": 347,
    "Tipo Doc. Emisor": "CUIT", "Nro. Doc. Emisor": 30333333336, "Denominación Emisor": "PROVEEDOR FICTICIO 003",
    "Tipo Doc. Receptor": "CUIT", "Nro. Doc. Receptor": 30222222223, "Tipo Cambio": 1, "Moneda": "$",
    "Neto Grav. IVA 21%": 100, "IVA 21%": 21, "Neto Gravado Total": 100, "Neto No Gravado": 0,
    "Op. Exentas": 0, "Otros Tributos": 0, "Total IVA": 21, "Imp. Total": 121,
  },
];

function codigoDeError(fn: () => unknown): { code: string; message: string } | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof SifereParseError) return { code: error.code, message: error.message };
    throw error;
  }
}

describe("libro de ventas de ARCA (Mis Comprobantes Emitidos)", () => {
  it("se lee tal cual: hoja Sheet1, encabezados en la fila 2 y sentido SALE desde el título", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: VENTAS_FICTICIAS,
    });
    const result = parseSifereWorkbook(libro, "SALE");

    expect(result.sheetName).toBe("Sheet1");
    expect(result.detectedDirection).toBe("SALE");
    expect(result.directionSource).toBe("titulo");
    expect(result.detailRows).toBe(3);
    expect(result.validRows).toBe(3);
    expect(result.errorRows).toBe(0);
  });

  it("normaliza tipo, fecha dd/mm/aaaa, contraparte del receptor e importes por alícuota", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: VENTAS_FICTICIAS,
    });
    const result = parseSifereWorkbook(libro, "SALE");
    const [factura, facturaA, nota] = result.rows.map((row) => row.input);

    expect(factura).toMatchObject({ direction: "SALE", letter: "B", issuedOn: "2026-10-04", cuit: "00012345678", currency: "ARS" });
    expect(facturaA).toMatchObject({ letter: "A", issuedOn: "2026-10-05", cuit: "30111111119" });
    expect(nota).toMatchObject({ letter: "NC", issuedOn: "2026-10-06", cuit: "00000000000" });
    expect(result.rates.map((rate) => [rate.rate, rate.count, rate.net, rate.tax])).toEqual([
      ["10.5", 1, "2000.00", "210.00"],
      ["21", 2, "1500.00", "315.00"],
    ]);
    expect(result.totals.iva).toBe("525.00");
    expect(result.totals.netoGravado).toBe("3500.00");
  });

  it("rechaza un libro de compras cargado en Ventas, con el motivo y sin filas", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Recibidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_RECIBIDOS,
      filas: COMPRAS_FICTICIAS,
    });
    expect(codigoDeError(() => parseSifereWorkbook(libro, "SALE"))).toEqual({
      code: "SHEET_DIRECTION_MISMATCH",
      message: "Este archivo es un libro de compras (Mis Comprobantes Recibidos). Cargalo en la sección Compras.",
    });
  });

  it("rechaza un libro de ventas cargado en Compras, aunque no haya ninguna hoja con ese nombre", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: VENTAS_FICTICIAS,
    });
    expect(codigoDeError(() => parseSifereWorkbook(libro, "PURCHASE"))).toEqual({
      code: "SHEET_DIRECTION_MISMATCH",
      message: "Este archivo es un libro de ventas (Mis Comprobantes Emitidos). Cargalo en la sección Ventas.",
    });
  });
});

describe("libro de compras de ARCA (Mis Comprobantes Recibidos)", () => {
  it("toma la contraparte del emisor y deja la fila no soportada con su motivo", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Recibidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_RECIBIDOS,
      filas: COMPRAS_FICTICIAS,
    });
    const result = parseSifereWorkbook(libro, "PURCHASE");

    expect(result.detectedDirection).toBe("PURCHASE");
    expect(result.detailRows).toBe(3);
    expect(result.validRows).toBe(2);
    expect(result.errorRows).toBe(1);
    expect(result.rows[0]!.input).toMatchObject({ direction: "PURCHASE", letter: "A", cuit: "30111111119" });
    expect(result.rows[0]!.name).toBe("PROVEEDOR FICTICIO 001");
    expect(result.rows[2]!.input).toMatchObject({ letter: "B", cuit: "30333333336" });
    // «99 - Tipo sin catálogo» no tiene letra en el catálogo: la fila queda con error y no se pierde en silencio.
    expect(result.rows[1]!.errors).toEqual(["LETTER_INVALID"]);
    expect(result.totals.iva).toBe("441.00");
  });
});

describe("sentido del libro: casos de borde", () => {
  it("una hoja llamada Compras cargada en Ventas se rechaza por su nombre", () => {
    const libro = buildSifereTemplate("PURCHASE");
    expect(codigoDeError(() => parseSifereWorkbook(libro, "SALE"))).toEqual({
      code: "SHEET_DIRECTION_MISMATCH",
      message: "Este archivo es un libro de compras (hoja «Compras»). Cargalo en la sección Compras.",
    });
  });

  it("sin título ni hoja con sentido, la columna Denominación Receptor define la venta", () => {
    const libro = libroArca({
      titulo: "Libro IVA",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: VENTAS_FICTICIAS,
    });
    expect(codigoDeError(() => parseSifereWorkbook(libro, "PURCHASE"))).toEqual({
      code: "SHEET_DIRECTION_MISMATCH",
      message: "Este archivo es un libro de ventas (columna «Denominación Receptor»). Cargalo en la sección Ventas.",
    });
  });

  it("un libro sin sentido inferible se acepta como antes", () => {
    const libro = libroArca({
      titulo: "Libro IVA",
      hoja: "Hoja1",
      encabezados: ["Fecha de Emisión", "Tipo de Comprobante", "Punto de Venta", "Número de Comprobante", "Denominación", "Importe Total", "Neto Gravado IVA 21%", "Importe IVA 21%", "Total Neto Gravado", "Total IVA"],
      filas: [
        {
          "Fecha de Emisión": "04/10/2026", "Tipo de Comprobante": "1", "Punto de Venta": 3, "Número de Comprobante": 461,
          "Denominación": "CLIENTE FICTICIO", "Importe Total": 1210, "Neto Gravado IVA 21%": 1000, "Importe IVA 21%": 210,
          "Total Neto Gravado": 1000, "Total IVA": 210,
        },
      ],
    });
    const result = parseSifereWorkbook(libro, "PURCHASE");
    expect(result.detectedDirection).toBeNull();
    expect(result.directionSource).toBeNull();
    expect(result.validRows).toBe(1);
  });

  it("un IVA a 2,5% o 5% con importe queda como error de fila (no se pierde en silencio)", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: [{ ...VENTAS_FICTICIAS[0]!, "IVA 5%": 50, "Neto Grav. IVA 5%": 1000 }],
    });
    const result = parseSifereWorkbook(libro, "SALE");
    expect(result.errorRows).toBe(1);
    expect(result.rows[0]!.errors).toContain("ALICUOTA_NO_SOPORTADA");
  });

  it("un libro sin encabezado de comprobantes se rechaza con HEADER_NOT_FOUND", () => {
    const libro = libroArca({ titulo: "Otra cosa", encabezados: ["Columna A", "Columna B"], filas: [{ "Columna A": "x" }] });
    expect(codigoDeError(() => parseSifereWorkbook(libro, "SALE"))).toEqual({
      code: "HEADER_NOT_FOUND",
      message: "No se encontró el encabezado del libro IVA",
    });
  });
});

describe("CUIT del libro: lectura y control contra el cliente (brief 4A)", () => {
  const FILA = [VENTAS_FICTICIAS[0]!];

  it("lee el CUIT del título (fila 1) del libro", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    expect(parseSifereWorkbook(libro, "SALE").cuit).toEqual({ value: "20000000001", source: "titulo" });
  });

  it("acepta el CUIT del título con guiones y lo devuelve sin ellos", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20-00000000-1",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    expect(parseSifereWorkbook(libro, "SALE").cuit).toEqual({ value: "20000000001", source: "titulo" });
  });

  it("si el título no trae CUIT, lo toma del nombre del archivo", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    const result = parseSifereWorkbook(libro, "SALE", {
      fileName: "Mis Comprobantes Emitidos - CUIT 20000000001.xlsx",
    });
    expect(result.cuit).toEqual({ value: "20000000001", source: "nombre" });
  });

  it("si el título y el nombre traen CUIT distinto, prevalece el del título", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    const result = parseSifereWorkbook(libro, "SALE", {
      fileName: "Mis Comprobantes Emitidos - CUIT 27000000009.xlsx",
    });
    expect(result.cuit).toEqual({ value: "20000000001", source: "titulo" });
  });

  it("sin CUIT ni en el título ni en el nombre, el libro se lee igual y cuit queda en null", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    const result = parseSifereWorkbook(libro, "SALE", { fileName: "libro.xlsx" });
    expect(result.cuit).toBeNull();
    expect(result.validRows).toBe(1);
  });

  it("con el CUIT del cliente igual al del libro importa sin error", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    const result = parseSifereWorkbook(libro, "SALE", { clientCuit: "20000000001" });
    expect(result.validRows).toBe(1);
  });

  it("con otro CUIT del cliente rechaza con CUIT_DISTINTO, el motivo y sin filas", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos - CUIT 20000000001",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    expect(codigoDeError(() => parseSifereWorkbook(libro, "SALE", { clientCuit: "30111111119" }))).toEqual({
      code: "CUIT_DISTINTO",
      message: "Este archivo es del CUIT 20-00000000-1, no del cliente (CUIT 30-11111111-9).",
    });
  });

  it("un libro sin CUIT no bloquea aunque se indique el CUIT del cliente", () => {
    const libro = libroArca({
      titulo: "Mis Comprobantes Emitidos",
      encabezados: ENCABEZADOS_EMITIDOS,
      filas: FILA,
    });
    const result = parseSifereWorkbook(libro, "SALE", { clientCuit: "30111111119", fileName: "libro.xlsx" });
    expect(result.validRows).toBe(1);
  });
});
