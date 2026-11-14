import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { reportCsv, reportXlsx, tableCsv, tableXlsx, type TableColumn } from "./report-export.js";

const COLUMNS: TableColumn[] = [
  { header: "Fecha", kind: "date", width: 14 },
  { header: "Número", kind: "integer", width: 12 },
  { header: "Neto", kind: "money", width: 16 },
  { header: "Tipo de cambio", kind: "rate", width: 15 },
  { header: "Letra", kind: "text", width: 8 },
];
const ROWS = [[new Date("2026-10-05T00:00:00.000Z"), 123, "-1500.5", "1234.5", "A"]];
const TOTALS = { label: "Totales (1 comprobantes)", values: [null, null, "-1500.50", null, null] };

function parts(buffer: Buffer): Record<string, string> {
  const files = unzipSync(new Uint8Array(buffer));
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

/** Celdas de una hoja: referencia → atributos y contenido. Basta para el XML que generamos. */
function cells(sheet: string): Record<string, { attrs: string; body: string }> {
  const out: Record<string, { attrs: string; body: string }> = {};
  for (const match of sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/g)) {
    out[match[1] ?? ""] = { attrs: match[2] ?? "", body: match[3] ?? "" };
  }
  return out;
}

describe("escritor tabular xlsx (libros fiscales)", () => {
  it("escribe las partes del paquete y la hoja con el nombre pedido", () => {
    const file = parts(tableXlsx(COLUMNS, ROWS, { sheetName: "Libro de compras", totals: TOTALS }));
    expect(Object.keys(file).sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(file["xl/workbook.xml"]).toContain('name="Libro de compras"');
  });

  it("escribe encabezado, importes numéricos, fecha serial y fila de totales con formato", () => {
    const sheet = parts(tableXlsx(COLUMNS, ROWS, { totals: TOTALS }))["xl/worksheets/sheet1.xml"] ?? "";
    const c = cells(sheet);
    expect(c["A1"]?.body).toContain("<t>Fecha</t>");
    expect(c["A1"]?.attrs).toContain('s="1"');
    // 05-oct-2026 = 46300 días desde 30-dic-1899 (1-ene-2026 = 46023).
    expect(c["A2"]?.body).toBe("<v>46300</v>");
    expect(c["A2"]?.attrs).toContain('s="5"');
    expect(c["B2"]?.body).toBe("<v>123</v>");
    expect(c["C2"]?.body).toBe("<v>-1500.5</v>");
    expect(c["C2"]?.attrs).toContain('s="3"');
    expect(c["D2"]?.body).toBe("<v>1234.5</v>");
    expect(c["E2"]?.body).toContain("<t>A</t>");
    expect(c["A3"]?.body).toContain("<t>Totales (1 comprobantes)</t>");
    expect(c["C3"]?.body).toBe("<v>-1500.50</v>");
    expect(c["C3"]?.attrs).toContain('s="7"');
    expect(c["D3"]?.attrs).toContain('s="6"');
  });

  it("fija anchos por columna y congela la fila de encabezado", () => {
    const sheet = parts(tableXlsx(COLUMNS, ROWS, { totals: TOTALS }))["xl/worksheets/sheet1.xml"] ?? "";
    expect(sheet).toContain('<col min="3" max="3" width="16" customWidth="1"/>');
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
  });
});

describe("escritor tabular csv (libros fiscales)", () => {
  it("escribe encabezado, importes con dos decimales, fecha dd/mm/aaaa y totales", () => {
    const text = tableCsv(COLUMNS, ROWS, { totals: TOTALS }).toString("utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split("\r\n")).toEqual([
      '"Fecha","Número","Neto","Tipo de cambio","Letra"',
      '"05/10/2026","123","-1500.50","1234.50","A"',
      '"Totales (1 comprobantes)","","-1500.50","",""',
    ]);
  });
});

describe("regresión: reportCsv y reportXlsx conservan su formato", () => {
  const result = {
    templateCode: "BAL",
    templateVersion: 2,
    cutoff: "2026-01-31",
    lines: [{ code: "CAJA", label: "Caja", value: "100.00" }],
  };

  it("reportCsv mantiene el texto exacto", () => {
    expect(reportCsv(result).toString("utf8")).toBe(
      '\uFEFF"Reporte","BAL"\r\n"Versión","2"\r\n"Corte","2026-01-31"\r\n\r\n"Código","Concepto","Importe"\r\n"CAJA","Caja","100.00"',
    );
  });

  it("reportXlsx mantiene la hoja «Reporte» con sus tres columnas", () => {
    const file = parts(reportXlsx(result));
    expect(file["xl/workbook.xml"]).toContain('name="Reporte"');
    expect(file["xl/worksheets/sheet1.xml"]).toContain('<col min="2" max="2" width="48" customWidth="1"/>');
    expect(cells(file["xl/worksheets/sheet1.xml"] ?? "")["B6"]?.body).toContain("<t>Caja</t>");
  });
});
