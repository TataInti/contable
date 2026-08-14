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
