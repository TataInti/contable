import { unzipSync, strFromU8, strToU8, zipSync } from "fflate";
import { Decimal } from "decimal.js";
import { normalizeArcaVoucherRow, type ArcaVoucherInput } from "./importers.js";

/**
 * Parser del libro IVA digital en formato Excel (.xlsx) de ARCA.
 *
 * Puro y determinista: recibe los bytes del `.xlsx` y devuelve un análisis
 * completo (alícuotas, tributos asociados y filas normalizadas listas para el
 * adaptador ARCA), sin consultar DB ni HTTP.
 *
 * El formato real del archivo `demo-liquidacion-manual.xlsx` usa los
 * encabezados nativos del libro IVA Digital (español, ej. "Neto Gravado IVA
 * 21%", "Importe IVA 21%", "Importe de Percepciones de Ingresos Brutos") y
 * fechas como número de serie de Excel. Este módulo resuelve:
 *   - extracción ZIP (via fflate), shared strings y celdas (número / string);
 *   - mapeo de encabezados nativos a los campos del adaptador ARCA;
 *   - conversión de fecha en serie Excel (epoch 1899-12-30) a ISO;
 *   - normalización de CUIT (consumidor final → 11 ceros, padding de ceros);
 *   - letra del comprobante a partir del código de tipo (1→A, 6→B, 3/8→NC, …);
 *   - clasificación por alícuota (10,5% / 21% / 27%) y tributos asociados
 *     (percepciones de IIBB, percepciones de IVA, municipales, internos, no
 *     gravado, exento).
 */

export type SifereDirection = "SALE" | "PURCHASE";

export interface SifereAnalysisRate {
  rate: "10.5" | "21" | "27";
  label: string;
  net: string;
  tax: string;
  count: number;
}

export interface SifereAnalysisTax {
  code: string;
  label: string;
  amount: string;
}

export interface SifereMappedRow {
  /** Posición 1-based de la fila dentro de la hoja. */
  index: number;
  /** Fila en el formato camelCase que espera el adaptador ARCA. */
  input: ArcaVoucherInput;
  /** Denominación de la contraparte (comprador/vendedor). */
  name: string | null;
  /** Rubro del proveedor (solo compras): SUPER / TRANSPORTE. */
  rubro: string | null;
  noGravado: string;
  percepIIBB: string;
  percepIVA: string;
  percepNoCategorizados: string;
  municipales: string;
  internos: string;
  errors: string[];
}

export interface SifereWorkbookResult {
  direction: SifereDirection;
  sheetName: string;
  headers: string[];
  totals: {
    importeTotal: string;
    netoGravado: string;
    iva: string;
    noGravado: string;
    exento: string;
  };
  rates: SifereAnalysisRate[];
  taxes: SifereAnalysisTax[];
  rows: SifereMappedRow[];
  detailRows: number;
  validRows: number;
  errorRows: number;
}

export type SifereParseErrorCode =
  | "NOT_A_ZIP"
  | "WORKBOOK_NOT_FOUND"
  | "HEADER_NOT_FOUND"
  | "SHEET_NOT_FOUND"
  | "NO_DETAIL_ROWS";

export class SifereParseError extends Error {
  readonly code: SifereParseErrorCode;
  constructor(code: SifereParseErrorCode, message: string) {
    super(message);
    this.name = "SifereParseError";
    this.code = code;
  }
}

// ---------------------------------------------------------------
// Utilidades de XML / celdas
// ---------------------------------------------------------------

const EXCEL_EPOCH_MS = 25569 * 86400000; // 1899-12-30 en ms desde epoch

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si\b[^>]*>(.*?)<\/si>/gs;
  let match: RegExpExecArray | null;
  while ((match = siRe.exec(xml)) !== null) {
    const inner = match[1] ?? "";
    const tRe = /<t[^>]*>([^<]*)<\/t>/g;
    let t: RegExpExecArray | null;
    let acc = "";
    while ((t = tRe.exec(inner)) !== null) acc += t[1];
    out.push(acc);
  }
  return out;
}

function normalizeHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function columnLetterToIndex(letters: string): number {
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1; // 0-based
}

/**
 * Extrae las celdas de una fila XML `<row …>…</row>` como un Map col→valor
 * (0-based), resolviendo shared strings, inlineStr y valores numéricos.
 */
function extractRowCells(rowXml: string, shared: string[]): Map<number, string> {
  const cells = new Map<number, string>();
  const cellRe = /<c\b([^>]*?)(?:\/>|>(.*?)<\/c>)/gs;
  let match: RegExpExecArray | null;
  while ((match = cellRe.exec(rowXml)) !== null) {
    const attrs = match[1] ?? "";
    const inner = match[2] ?? "";
    const refMatch = /r="([A-Z]+)\d+"/.exec(attrs);
    if (!refMatch) continue;
    const col = columnLetterToIndex(refMatch[1]!);
    const typeMatch = /t="([^"]+)"/.exec(attrs);
    const type = typeMatch?.[1] ?? "n";
    let value = "";
    if (type === "s") {
      const vMatch = /<v>([^<]*)<\/v>/.exec(inner);
      const index = vMatch ? Number(vMatch[1]) : -1;
      value = index >= 0 && index < shared.length ? shared[index]! : "";
    } else if (type === "inlineStr") {
      const tMatch = /<t[^>]*>([^<]*)<\/t>/.exec(inner);
      value = tMatch ? tMatch[1]! : "";
    } else if (type === "b") {
      value = /<v>1<\/v>/.test(inner) ? "1" : "0";
    } else {
      const vMatch = /<v>([^<]*)<\/v>/.exec(inner);
      value = vMatch ? vMatch[1]! : "";
    }
    cells.set(col, value);
  }
  return cells;
}

function parseWorksheet(xml: string, shared: string[]): Array<Map<number, string>> {
  const rows: Array<Map<number, string>> = [];
  const rowRe = /<row\b[^>]*>(.*?)<\/row>/gs;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(xml)) !== null) {
    rows.push(extractRowCells(match[0], shared));
  }
  return rows;
}

// ---------------------------------------------------------------
// Mapeo de encabezados nativos
// ---------------------------------------------------------------

interface HeaderRule {
  key: string;
  test: RegExp;
}

const HEADER_RULES: readonly HeaderRule[] = [
  { key: "numberTo", test: /numero de comprobante hasta/ },
  { key: "issuedOn", test: /fecha de emision/ },
  { key: "typeCode", test: /tipo de comprobante/ },
  { key: "pointOfSale", test: /punto de venta/ },
  { key: "numberFrom", test: /^numero de comprobante$/ },
  { key: "docType", test: /tipo doc/ },
  { key: "cuit", test: /nro doc/ },
  { key: "name", test: /denominacion/ },
  { key: "total", test: /importe total/ },
  { key: "currency", test: /moneda/ },
  { key: "exchangeRate", test: /tipo de cambio/ },
  { key: "noGravado", test: /no gravado/ },
  { key: "exempt", test: /exento/ },
  { key: "percepIIBB", test: /percepciones de ingresos brutos/ },
  { key: "percepIVA", test: /percepciones o pagos a cuenta de iva/ },
  { key: "percepNoCat", test: /percepcion a no categor/ },
  { key: "municipales", test: /impuestos municipales/ },
  { key: "internos", test: /impuestos internos/ },
  { key: "otrosTrib", test: /otros tributos/ },
  { key: "neto105", test: /neto gravado iva 10/ },
  { key: "iva105", test: /importe iva 10/ },
  { key: "neto21", test: /neto gravado iva 21/ },
  { key: "iva21", test: /importe iva 21/ },
  { key: "neto27", test: /neto gravado iva 27/ },
  { key: "iva27", test: /importe iva 27/ },
  { key: "netoGravado", test: /total neto gravado/ },
  { key: "totalIva", test: /total iva/ },
  { key: "actividad", test: /actividad/ },
];

function resolveHeaders(headerRow: Map<number, string>): Record<string, number> {
  const byName = new Map<string, number>();
  for (const [col, value] of headerRow) {
    const normalized = normalizeHeader(value);
    if (normalized) byName.set(normalized, col);
  }
  const resolved: Record<string, number> = {};
  for (const rule of HEADER_RULES) {
    if (resolved[rule.key] !== undefined) continue;
    for (const [name, col] of byName) {
      if (rule.test.test(name)) {
        resolved[rule.key] = col;
        break;
      }
    }
  }
  return resolved;
}

// ---------------------------------------------------------------
// Conversión de valores
// ---------------------------------------------------------------

const TYPE_TO_LETTER: Readonly<Record<string, string>> = {
  "1": "A", "2": "ND", "3": "NC",
  "6": "B", "7": "ND", "8": "NC",
  "11": "C", "12": "ND", "13": "NC",
  "51": "M", "52": "ND", "53": "NC",
};

function serialToIso(value: string | undefined | null): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const serial = Number(trimmed);
  if (!Number.isFinite(serial)) return null;
  const ms = Math.round(serial * 86400000 - EXCEL_EPOCH_MS);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeCuit(value: string | undefined | null): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits === "" || /^0+$/.test(digits)) return "00000000000";
  if (digits.length < 11) return digits.padStart(11, "0");
  return digits;
}

function dec(value: string | undefined | null): Decimal {
  if (value == null) return new Decimal(0);
  const trimmed = value.trim();
  if (trimmed === "") return new Decimal(0);
  return new Decimal(trimmed);
}

function money(value: Decimal): string {
  return value.toFixed(2);
}

// ---------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------

interface SheetRef {
  name: string;
  rid: string;
}

interface WorkbookMeta {
  sheets: SheetRef[];
  targets: Map<string, string>;
}

function parseWorkbook(xml: string): WorkbookMeta {
  const sheets: SheetRef[] = [];
  const sheetRe = /<sheet\b[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = sheetRe.exec(xml)) !== null) {
    const tag = match[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1] ?? "";
    const rid = /r:id="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (name && rid) sheets.push({ name, rid });
  }
  return { sheets, targets: new Map() };
}

function parseWorkbookRels(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = relRe.exec(xml)) !== null) {
    const tag = match[0];
    const id = /Id="([^"]*)"/.exec(tag)?.[1] ?? "";
    const target = /Target="([^"]*)"/.exec(tag)?.[1] ?? "";
    if (id && target) targets.set(id, target);
  }
  return targets;
}

interface SheetXml {
  name: string;
  xml: string;
}

function readDirections(files: Record<string, Uint8Array>): SheetXml[] {
  const workbookEntry = files["xl/workbook.xml"];
  if (!workbookEntry) throw new SifereParseError("WORKBOOK_NOT_FOUND", "No se encontró xl/workbook.xml");
  const workbook = parseWorkbook(strFromU8(workbookEntry));
  const relsEntry = files["xl/_rels/workbook.xml.rels"];
  const targets = relsEntry ? parseWorkbookRels(strFromU8(relsEntry)) : new Map<string, string>();

  const sheets: SheetXml[] = [];
  for (const sheet of workbook.sheets) {
    const target = targets.get(sheet.rid) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`;
    // Los targets de la relación pueden venir relativos a "xl/" o a la raíz.
    const path = target.startsWith("/")
      ? target.slice(1)
      : target.startsWith("xl/") || target.startsWith("xl\\")
        ? target
        : `xl/${target}`;
    const xml = files[path];
    if (xml) sheets.push({ name: sheet.name, xml: strFromU8(xml) });
  }
  return sheets;
}

/**
 * Parsea un libro IVA digital (.xlsx) y detecta la hoja de Ventas o Compras.
 * Devuelve el análisis por alícuota, los tributos asociados y las filas
 * normalizadas listas para el adaptador ARCA.
 */
export function parseSifereWorkbook(
  raw: Uint8Array,
  direction: SifereDirection,
): SifereWorkbookResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(raw);
  } catch {
    throw new SifereParseError("NOT_A_ZIP", "El archivo no es un .xlsx válido");
  }

  const sharedXml = files["xl/sharedStrings.xml"];
  const shared = sharedXml ? parseSharedStrings(strFromU8(sharedXml)) : [];

  const sheets = readDirections(files);
  const wanted = direction === "SALE" ? "ventas" : "compras";

  let chosen: SheetXml | undefined;
  // Preferencia: nombre de hoja que contenga "ventas"/"compras"; sino la que
  // exhiba el encabezado "Fecha de Emisión" + "Tipo de Comprobante".
  chosen = sheets.find((sheet) => {
    const name = normalizeHeader(sheet.name);
    return wanted === "ventas" ? name === "ventas" : name === "compras";
  });
  if (!chosen) {
    chosen = sheets.find((sheet) => sheet.xml.includes("Fecha de Emisi") || sheet.xml.includes("Fecha de emisi"));
  }
  if (!chosen) {
    chosen = sheets.find((sheet) => {
      const name = normalizeHeader(sheet.name);
      return wanted === "ventas" ? name.includes("venta") : name.includes("compra");
    });
  }
  if (!chosen) {
    throw new SifereParseError(
      "SHEET_NOT_FOUND",
      `No se encontró la hoja de ${wanted === "ventas" ? "Ventas" : "Compras"} en el libro`,
    );
  }

  const rows = parseWorksheet(chosen.xml, shared);

  // Localizar fila de encabezado (contiene "Fecha de Emisión" y "Punto de Venta").
  let headerIndex = -1;
  let columns: Record<string, number> = {};
  const headers: string[] = [];
  const scanLimit = Math.min(rows.length, 20);
  for (let i = 0; i < scanLimit; i += 1) {
    const row = rows[i]!;
    const names = [...row.values()].map(normalizeHeader);
    if (names.some((n) => n === "fecha de emision") && names.some((n) => n === "punto de venta")) {
      headerIndex = i;
      columns = resolveHeaders(row);
      for (const value of row.values()) {
        if (value) headers.push(value);
      }
      break;
    }
  }
  if (headerIndex === -1) {
    throw new SifereParseError("HEADER_NOT_FOUND", "No se encontró el encabezado del libro IVA");
  }

  const get = (row: Map<number, string>, key: string): string | undefined => {
    const col = columns[key];
    return col !== undefined ? row.get(col) : undefined;
  };

  const totals = {
    importeTotal: new Decimal(0),
    netoGravado: new Decimal(0),
    iva: new Decimal(0),
    noGravado: new Decimal(0),
    exento: new Decimal(0),
  };
  const rateAcc: Record<"10.5" | "21" | "27", { net: Decimal; tax: Decimal; count: number }> = {
    "10.5": { net: new Decimal(0), tax: new Decimal(0), count: 0 },
    "21": { net: new Decimal(0), tax: new Decimal(0), count: 0 },
    "27": { net: new Decimal(0), tax: new Decimal(0), count: 0 },
  };
  const taxAcc: Record<string, Decimal> = {
    PERCEPCIONES_IIBB: new Decimal(0),
    PERCEPCION_IVA: new Decimal(0),
    PERCEPCION_NO_CATEGORIZADOS: new Decimal(0),
    IMPUESTOS_MUNICIPALES: new Decimal(0),
    IMPUESTOS_INTERNOS: new Decimal(0),
    OTROS_TRIBUTOS: new Decimal(0),
  };

  const detail: SifereMappedRow[] = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    const typeCode = (get(row, "typeCode") ?? "").trim();
    const posRaw = (get(row, "pointOfSale") ?? "").trim();
    const numRaw = (get(row, "numberFrom") ?? "").trim();
    // Saltea filas de totales, notas o vacías (no llevan tipo/PV/número).
    if (!typeCode || !posRaw || !numRaw) continue;
    if (!/^\d+$/.test(typeCode) || !/^\d+$/.test(posRaw) || !/^\d+$/.test(numRaw)) continue;

    const letter = TYPE_TO_LETTER[typeCode] ?? "";
    const numberTo = (get(row, "numberTo") ?? "").trim();
    const cuit = normalizeCuit(get(row, "cuit"));
    const issuedOn = serialToIso(get(row, "issuedOn"));
    const currencyRaw = (get(row, "currency") ?? "").trim();
    const currency = currencyRaw === "PES" ? "ARS" : currencyRaw.length === 3 ? currencyRaw : "ARS";
    const exchangeRate = (get(row, "exchangeRate") ?? "").trim();

    const neto105 = dec(get(row, "neto105"));
    const iva105 = dec(get(row, "iva105"));
    const neto21 = dec(get(row, "neto21"));
    const iva21 = dec(get(row, "iva21"));
    const neto27 = dec(get(row, "neto27"));
    const iva27 = dec(get(row, "iva27"));
    const netoGravado = dec(get(row, "netoGravado"));
    const importeTotal = dec(get(row, "total"));
    const noGravado = dec(get(row, "noGravado"));
    const exempt = dec(get(row, "exempt"));
    const percepIIBB = dec(get(row, "percepIIBB"));
    const percepIVA = dec(get(row, "percepIVA"));
    const percepNoCat = dec(get(row, "percepNoCat"));
    const municipales = dec(get(row, "municipales"));
    const internos = dec(get(row, "internos"));
    const otrosTrib = dec(get(row, "otrosTrib"));
    const rubro = (get(row, "actividad") ?? "").trim().toUpperCase() || null;
    const name = (get(row, "name") ?? "").trim() || null;

    // Acumuladores de análisis.
    totals.importeTotal = totals.importeTotal.plus(importeTotal);
    totals.netoGravado = totals.netoGravado.plus(netoGravado);
    totals.iva = totals.iva.plus(iva21).plus(iva105).plus(iva27);
    totals.noGravado = totals.noGravado.plus(noGravado);
    totals.exento = totals.exento.plus(exempt);
    taxAcc["PERCEPCIONES_IIBB"] = taxAcc["PERCEPCIONES_IIBB"]!.plus(percepIIBB);
    taxAcc["PERCEPCION_IVA"] = taxAcc["PERCEPCION_IVA"]!.plus(percepIVA);
    taxAcc["PERCEPCION_NO_CATEGORIZADOS"] = taxAcc["PERCEPCION_NO_CATEGORIZADOS"]!.plus(percepNoCat);
    taxAcc["IMPUESTOS_MUNICIPALES"] = taxAcc["IMPUESTOS_MUNICIPALES"]!.plus(municipales);
    taxAcc["IMPUESTOS_INTERNOS"] = taxAcc["IMPUESTOS_INTERNOS"]!.plus(internos);
    taxAcc["OTROS_TRIBUTOS"] = taxAcc["OTROS_TRIBUTOS"]!.plus(otrosTrib);
    for (const [rate, net, tax] of [
      ["10.5", neto105, iva105],
      ["21", neto21, iva21],
      ["27", neto27, iva27],
    ] as const) {
      if (tax.greaterThan(0) || net.greaterThan(0)) {
        rateAcc[rate].net = rateAcc[rate].net.plus(net);
        rateAcc[rate].tax = rateAcc[rate].tax.plus(tax);
        rateAcc[rate].count = rateAcc[rate].count + 1;
      }
    }

    const hasIva = iva21.greaterThan(0) || iva105.greaterThan(0) || iva27.greaterThan(0);
    const input: ArcaVoucherInput = {
      direction,
      letter,
      pointOfSale: posRaw,
      numberFrom: numRaw,
      cuit,
      issuedOn: issuedOn ?? "",
      net: netoGravado.toFixed(4),
      ...(hasIva ? { hasIva: true } : {}),
      iva21: iva21.toFixed(4),
      iva105: iva105.toFixed(4),
      iva27: iva27.toFixed(4),
      exempt: exempt.toFixed(4),
      otherTaxes: otrosTrib.toFixed(4),
      currency,
      ...(numberTo ? { numberTo } : {}),
      ...(exchangeRate ? { exchangeRate } : {}),
    };

    const normalized = normalizeArcaVoucherRow(input);
    const errors = normalized.status === "ERROR" ? (normalized.errors ?? []) : [];

    detail.push({
      index: i + 1,
      input,
      name,
      rubro,
      noGravado: noGravado.toFixed(4),
      percepIIBB: percepIIBB.toFixed(4),
      percepIVA: percepIVA.toFixed(4),
      percepNoCategorizados: percepNoCat.toFixed(4),
      municipales: municipales.toFixed(4),
      internos: internos.toFixed(4),
      errors,
    });
  }

  if (detail.length === 0) {
    throw new SifereParseError("NO_DETAIL_ROWS", "El libro no contiene comprobantes para importar");
  }

  const validRows = detail.filter((row) => row.errors.length === 0).length;
  const errorRows = detail.length - validRows;

  return {
    direction,
    sheetName: chosen.name,
    headers,
    totals: {
      importeTotal: money(totals.importeTotal),
      netoGravado: money(totals.netoGravado),
      iva: money(totals.iva),
      noGravado: money(totals.noGravado),
      exento: money(totals.exento),
    },
    rates: (["10.5", "21", "27"] as const)
      .map((rate) => ({
        rate,
        label: `${rate}%`,
        net: money(rateAcc[rate].net),
        tax: money(rateAcc[rate].tax),
        count: rateAcc[rate].count,
      }))
      .filter((rate) => rate.count > 0),
    taxes: [
      { code: "PERCEPCIONES_IIBB", label: "Percepciones IIBB", amount: money(taxAcc["PERCEPCIONES_IIBB"]!) },
      { code: "PERCEPCION_IVA", label: "Percepciones IVA", amount: money(taxAcc["PERCEPCION_IVA"]!) },
      { code: "PERCEPCION_NO_CATEGORIZADOS", label: "Percepción no categorizados", amount: money(taxAcc["PERCEPCION_NO_CATEGORIZADOS"]!) },
      { code: "IMPUESTOS_MUNICIPALES", label: "Impuestos municipales", amount: money(taxAcc["IMPUESTOS_MUNICIPALES"]!) },
      { code: "IMPUESTOS_INTERNOS", label: "Impuestos internos", amount: money(taxAcc["IMPUESTOS_INTERNOS"]!) },
      { code: "OTROS_TRIBUTOS", label: "Otros tributos", amount: money(taxAcc["OTROS_TRIBUTOS"]!) },
      { code: "NO_GRAVADO", label: "No gravado", amount: money(totals.noGravado) },
      { code: "EXENTO", label: "Exento", amount: money(totals.exento) },
    ].filter((tax) => Number(tax.amount) !== 0),
    rows: detail,
    detailRows: detail.length,
    validRows,
    errorRows,
  };
}

// ---------------------------------------------------------------
// Plantillas modelo (.xlsx) para importar compras y ventas
// ---------------------------------------------------------------

/**
 * Columnas del libro IVA digital que espera el parser. Orden canónico para
 * generar la plantilla modelo y para que el estudio ordene sus Excels.
 * El parser tolera columnas extra y las identifica por nombre, no por orden.
 */
export const SIFERE_HEADER_ORDER = [
  "Fecha de Emisión",
  "Tipo de Comprobante",
  "Punto de Venta",
  "Número de Comprobante",
  "Número de Comprobante Hasta",
  "Tipo Doc.",
  "Nro. Doc.",
  "Denominación",
  "Importe Total",
  "Moneda Original",
  "Tipo de Cambio",
  "Importe No Gravado",
  "Importe Exento",
  "Percepciones de Ingresos Brutos",
  "Percepciones o Pagos a Cuenta de IVA",
  "Impuestos Municipales",
  "Percepción a No Categorizados",
  "Impuestos Internos",
  "Otros Tributos",
  "Neto Gravado IVA 0%",
  "Neto Gravado IVA 2,5%",
  "Importe IVA 2,5%",
  "Neto Gravado IVA 5%",
  "Importe IVA 5%",
  "Neto Gravado IVA 10,5%",
  "Importe IVA 10,5%",
  "Neto Gravado IVA 21%",
  "Importe IVA 21%",
  "Neto Gravado IVA 27%",
  "Importe IVA 27%",
  "Total Neto Gravado",
  "Total IVA",
  "Actividad",
] as const;

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function colName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows: string[][]): string {
  const cells: string[] = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r]!;
    const rowCells: string[] = [];
    for (let c = 0; c < row.length; c += 1) {
      const ref = `${colName(c)}${r + 1}`;
      rowCells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(row[c] ?? "")}</t></is></c>`);
    }
    cells.push(`<row r="${r + 1}">${rowCells.join("")}</row>`);
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells.join("")}</sheetData></worksheet>`;
}

function sampleRows(direction: SifereDirection): string[][] {
  const header = [...SIFERE_HEADER_ORDER];
  const base: string[] = [];
  const numCols = header.length;
  for (let i = 0; i < numCols; i += 1) base.push("");
  const map: Record<string, number> = {};
  header.forEach((h, i) => (map[h] = i));

  const set = (row: string[], key: string, value: string) => {
    const i = map[key];
    if (i !== undefined) row[i] = value;
  };

  const examples: string[][] = [];
  if (direction === "SALE") {
    const a = [...base];
    set(a, "Fecha de Emisión", "2026-06-04");
    set(a, "Tipo de Comprobante", "1");
    set(a, "Punto de Venta", "3");
    set(a, "Número de Comprobante", "461");
    set(a, "Número de Comprobante Hasta", "461");
    set(a, "Tipo Doc.", "80");
    set(a, "Nro. Doc.", "30658650242");
    set(a, "Denominación", "EMPRESA EJEMPLO S.A.");
    set(a, "Importe Total", "245394.99");
    set(a, "Moneda Original", "PES");
    set(a, "Tipo de Cambio", "1");
    set(a, "Importe No Gravado", "0");
    set(a, "Importe Exento", "0");
    set(a, "Neto Gravado IVA 21%", "202805.76");
    set(a, "Importe IVA 21%", "42589.21");
    set(a, "Total Neto Gravado", "202805.76");
    set(a, "Total IVA", "42589.21");
    examples.push(a);
  } else {
    const a = [...base];
    set(a, "Fecha de Emisión", "2026-06-01");
    set(a, "Tipo de Comprobante", "1");
    set(a, "Punto de Venta", "4");
    set(a, "Número de Comprobante", "61939");
    set(a, "Número de Comprobante Hasta", "61939");
    set(a, "Tipo Doc.", "80");
    set(a, "Nro. Doc.", "30702388356");
    set(a, "Denominación", "PROVEEDOR EJEMPLO S.R.L.");
    set(a, "Importe Total", "75495.87");
    set(a, "Moneda Original", "PES");
    set(a, "Tipo de Cambio", "1");
    set(a, "Importe No Gravado", "0");
    set(a, "Importe Exento", "0");
    set(a, "Percepciones o Pagos a Cuenta de IVA", "12582.64");
    set(a, "Neto Gravado IVA 21%", "59917.36");
    set(a, "Importe IVA 21%", "12582.64");
    set(a, "Total Neto Gravado", "59917.36");
    set(a, "Total IVA", "12582.64");
    set(a, "Actividad", "SUPER");
    examples.push(a);
  }
  return [header, ...examples];
}

const MINIMAL_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

/**
 * Genera un .xlsx modelo con las columnas del libro IVA digital y una fila de
 * ejemplo. Devuelve los bytes para descargar. El estudio lo usa como plantilla
 * para ordenar sus Excels antes de importar.
 */
export function buildSifereTemplate(direction: SifereDirection): Uint8Array {
  const rows = sampleRows(direction);
  const sheetName = direction === "SALE" ? "Ventas" : "Compras";
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(MINIMAL_XML),
    "_rels/.rels": strToU8(RELS_XML),
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(rows)),
  };
  return zipSync(files);
}