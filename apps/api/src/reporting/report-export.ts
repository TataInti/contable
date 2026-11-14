import PDFDocument from "pdfkit";
import { strToU8, zipSync } from "fflate";

export interface ExportReportResult {
  templateCode?: string;
  templateVersion?: number;
  cutoff?: string;
  generatedAt?: string;
  lines?: { code?: string; label?: string; value?: string; isTotal?: boolean; indent?: number }[];
}

export type ReportExportFormat = "csv" | "xlsx" | "pdf";

function xml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function asRows(result: ExportReportResult): string[][] {
  return [
    ["Código", "Concepto", "Importe"],
    ...(result.lines ?? []).map((line) => [line.code ?? "", line.label ?? "", line.value ?? "0"]),
  ];
}

export function reportCsv(result: ExportReportResult): Buffer {
  const metadata = [
    ["Reporte", result.templateCode ?? ""],
    ["Versión", String(result.templateVersion ?? "")],
    ["Corte", result.cutoff ?? ""],
    [],
  ];
  const text = [...metadata, ...asRows(result)].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return Buffer.from(`\uFEFF${text}`, "utf8");
}

export function reportXlsx(result: ExportReportResult): Buffer {
  const rows = [
    ["Reporte", result.templateCode ?? ""],
    ["Versión", String(result.templateVersion ?? "")],
    ["Corte", result.cutoff ?? ""],
    [],
    ...asRows(result),
  ];
  const worksheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reporte" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="16" customWidth="1"/><col min="2" max="2" width="48" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/></cols><sheetData>${worksheetRows}</sheetData></worksheet>`),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function reportPdf(result: ExportReportResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 52, info: { Title: `Reporte ${result.templateCode ?? "contable"}` } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(18).fillColor("#183b35").text(result.templateCode ?? "Reporte contable");
    doc.moveDown(0.25).font("Helvetica").fontSize(9).fillColor("#5d6865")
      .text(`Versión ${result.templateVersion ?? "—"} · Corte ${result.cutoff ?? "—"}`);
    doc.moveDown(1.2).fillColor("#17211f");
    for (const line of result.lines ?? []) {
      if (doc.y > 760) doc.addPage();
      doc.font(line.isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(10);
      const y = doc.y;
      doc.text(`${"  ".repeat(Math.max(0, line.indent ?? 0))}${line.label ?? line.code ?? ""}`, 52, y, { width: 360 });
      doc.text(line.value ?? "0", 420, y, { width: 120, align: "right" });
      doc.moveDown(0.55);
      if (line.isTotal) doc.moveTo(52, doc.y).lineTo(540, doc.y).strokeColor("#ccd4d1").stroke().moveDown(0.4);
    }
    doc.end();
  });
}

export async function exportReport(result: ExportReportResult, format: ReportExportFormat): Promise<Buffer> {
  if (format === "csv") return reportCsv(result);
  if (format === "xlsx") return reportXlsx(result);
  return reportPdf(result);
}

export const REPORT_CONTENT_TYPES: Record<ReportExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/* ---------- Escritor tabular genérico (corte 7a: libros fiscales) ----------
 * Se agrega junto a reportXlsx, reportCsv y reportPdf, que no cambian. Celdas
 * numéricas con formato, anchos por columna, fila de encabezado congelada y
 * fila de totales. Los importes llegan como cadena decimal con punto; la
 * presentación (miles y decimales) la pone el formato de la celda en xlsx y
 * el CSV usa punto decimal para que se pueda reimportar sin ambigüedad. */

export type TableColumnKind = "text" | "integer" | "money" | "rate" | "date";

export interface TableColumn {
  header: string;
  kind: TableColumnKind;
  /** Ancho en caracteres de Excel. Si falta, se usa el ancho por defecto del tipo. */
  width?: number;
}

/** Texto; entero o cadena decimal con punto (importes, tipos de cambio); fecha; null o "" = celda vacía. */
export type TableCell = string | number | Date | null;

export interface TableTotals {
  /** Va en la primera columna. */
  label: string;
  /** Un valor por columna. values[0] se ignora porque ahí va la etiqueta. */
  values: TableCell[];
}

export interface TableOptions {
  sheetName?: string;
  totals?: TableTotals;
}

const TABLE_DEFAULT_WIDTH: Record<TableColumnKind, number> = { text: 14, integer: 12, money: 16, rate: 14, date: 14 };
// Índices de cellXfs en TABLE_STYLES_XML.
const TABLE_STYLE: Record<TableColumnKind, number> = { text: 0, integer: 2, money: 3, rate: 4, date: 5 };
const TABLE_HEADER_STYLE = 1;
const TABLE_TOTAL_LABEL_STYLE = 6;
const TABLE_TOTAL_MONEY_STYLE = 7;
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

const TABLE_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0.0000"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EFEC"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA8A4"/></bottom><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF17211F"/></top><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="2" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

function columnLetters(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

function parseIsoDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Fecha inválida en la tabla: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function utcDate(value: Date | string): Date {
  return value instanceof Date ? value : parseIsoDate(value);
}

function dayText(value: Date | string): string {
  const date = utcDate(value);
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

/** Número de serie de Excel (1900): días desde 30-dic-1899, en UTC. */
function excelSerial(value: Date | string): number {
  const date = utcDate(value);
  return (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - EXCEL_EPOCH_MS) / DAY_MS;
}

function numericText(value: TableCell, column: TableColumn): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && DECIMAL_TEXT.test(value)) return value;
  throw new Error(`Valor numérico inválido en «${column.header}»`);
}

/** Recorta los ceros de la parte decimal dejando al menos `minDecimals` decimales. */
function trimDecimals(text: string, minDecimals: number): string {
  const [integer = "0", fraction = ""] = text.split(".");
  return `${integer}.${fraction.replace(/0+$/, "").padEnd(minDecimals, "0")}`;
}

function xlsxCell(ref: string, value: TableCell, column: TableColumn, style: number): string {
  if (value === null || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (column.kind === "text") return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
  if (column.kind === "date") {
    return `<c r="${ref}" s="${style}"><v>${excelSerial(value instanceof Date ? value : String(value))}</v></c>`;
  }
  return `<c r="${ref}" s="${style}"><v>${numericText(value, column)}</v></c>`;
}

function csvText(value: TableCell, column: TableColumn): string {
  if (value === null || value === "") return "";
  if (column.kind === "text") return String(value);
  if (column.kind === "date") return dayText(value instanceof Date ? value : String(value));
  const text = numericText(value, column);
  return column.kind === "integer" ? text : trimDecimals(text, 2);
}

function sheetXml(columns: readonly TableColumn[], rows: readonly TableCell[][], totals?: TableTotals): string {
  const lines: string[] = [];
  const header = columns.map(
    (column, index) =>
      `<c r="${columnLetters(index)}1" s="${TABLE_HEADER_STYLE}" t="inlineStr"><is><t>${xml(column.header)}</t></is></c>`,
  );
  lines.push(`<row r="1">${header.join("")}</row>`);
  rows.forEach((row, rowIndex) => {
    const number = rowIndex + 2;
    const cells = columns.map((column, index) =>
      xlsxCell(`${columnLetters(index)}${number}`, row[index] ?? null, column, TABLE_STYLE[column.kind]),
    );
    lines.push(`<row r="${number}">${cells.join("")}</row>`);
  });
  if (totals) {
    const number = rows.length + 2;
    const cells = columns.map((column, index) => {
      const ref = `${columnLetters(index)}${number}`;
      if (index === 0) {
        return `<c r="${ref}" s="${TABLE_TOTAL_LABEL_STYLE}" t="inlineStr"><is><t>${xml(totals.label)}</t></is></c>`;
      }
      const value = totals.values[index] ?? null;
      if (column.kind === "money" && value !== null && value !== "") {
        return `<c r="${ref}" s="${TABLE_TOTAL_MONEY_STYLE}"><v>${numericText(value, column)}</v></c>`;
      }
      return `<c r="${ref}" s="${TABLE_TOTAL_LABEL_STYLE}"/>`;
    });
    lines.push(`<row r="${number}">${cells.join("")}</row>`);
  }
  const lastRow = rows.length + 1 + (totals ? 1 : 0);
  const lastColumn = columnLetters(Math.max(columns.length - 1, 0));
  const cols = columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${column.width ?? TABLE_DEFAULT_WIDTH[column.kind]}" customWidth="1"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${lines.join("")}</sheetData><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
}

function sheetNameFor(name: string | undefined): string {
  const cleaned = (name ?? "Libro").replace(/[[\]:*?\/\\]/g, " ").trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : "Hoja1";
}

export function tableXlsx(
  columns: readonly TableColumn[],
  rows: readonly TableCell[][],
  options: TableOptions = {},
): Buffer {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetNameFor(options.sheetName))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(TABLE_STYLES_XML),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(columns, rows, options.totals)),
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

export function tableCsv(
  columns: readonly TableColumn[],
  rows: readonly TableCell[][],
  options: TableOptions = {},
): Buffer {
  const lines: string[][] = [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column, index) => csvText(row[index] ?? null, column))),
  ];
  const totals = options.totals;
  if (totals) {
    lines.push(columns.map((column, index) => (index === 0 ? totals.label : csvText(totals.values[index] ?? null, column))));
  }
  const text = lines.map((line) => line.map(csvCell).join(",")).join("\r\n");
  return Buffer.from(`\uFEFF${text}`, "utf8");
}
