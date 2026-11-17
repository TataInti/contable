import { unzipSync, strFromU8, strToU8, zipSync } from "fflate";
import { Decimal } from "decimal.js";
import { normalizeArcaVoucherRow, type ArcaVoucherInput } from "./importers.js";
import {
  arcaCurrency,
  arcaCuit,
  arcaIsoDate,
  arcaTipoLetter,
  normalizeArcaHeader,
  resolveArcaColumns,
  type ArcaColumnKey,
} from "./arca-columnas.js";

/**
 * Parser del libro IVA digital en formato Excel (.xlsx) de ARCA.
 *
 * Puro y determinista: recibe los bytes del `.xlsx` y devuelve un análisis
 * completo (alícuotas, tributos asociados y filas normalizadas listas para el
 * adaptador ARCA), sin consultar DB ni HTTP.
 *
 * Acepta dos formatos:
 *   - el libro IVA digital del modelo del producto (hoja «Ventas» o «Compras»,
 *     encabezados nativos, fechas como número de serie);
 *   - «Mis Comprobantes» de ARCA: una hoja (p. ej. «Sheet1»), título en la fila 1,
 *     encabezados en la fila 2 y datos desde la fila 3; «Tipo» como «6 - Factura B»
 *     y fechas dd/mm/aaaa.
 *
 * El sentido (ventas o compras) se infiere del contenido: el título («Emitidos» o
 * «Recibidos»), las columnas «Denominación Receptor» o «Denominación Emisor» y,
 * en último término, el nombre de la hoja. Si el contenido contradice el sentido
 * pedido, se rechaza con SHEET_DIRECTION_MISMATCH y no se guarda nada.
 */

export type SifereDirection = "SALE" | "PURCHASE";

/** De dónde sale el sentido inferido del libro. */
export type SifereDirectionSource = "titulo" | "columnas" | "hoja";

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
  /** Sentido pedido (y, si el libro lo declara, el mismo que surge del contenido). */
  direction: SifereDirection;
  /** Sentido que surge del contenido del libro; null si no se puede inferir. */
  detectedDirection: SifereDirection | null;
  directionSource: SifereDirectionSource | null;
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
  | "NO_DETAIL_ROWS"
  | "SHEET_DIRECTION_MISMATCH";

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
  // Una fila vacía autocerrada (<row r="5"/>) no debe tomar la fila siguiente.
  const rowRe = /<row\b[^>]*?(?:\/>|>(.*?)<\/row>)/gs;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(xml)) !== null) {
    rows.push(extractRowCells(match[0], shared));
  }
  return rows;
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
// Hojas y encabezado
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

const HEADER_SCAN_LIMIT = 20;

const CELDA_NUMERICA = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Índice de la fila de encabezados, o -1. Es la fila de texto inmediatamente anterior a la
 * primera fila de datos, que es la primera con al menos tres celdas numéricas (importes,
 * número de comprobante, punto de venta). No compara texto: los nombres de columna se
 * resuelven después con resolveArcaColumns.
 */
function headerRowIndex(rows: ReadonlyArray<Map<number, string>>): number {
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  for (let i = 1; i < limit; i += 1) {
    const numericas = [...rows[i]!.values()].filter((valor) => CELDA_NUMERICA.test(valor.trim())).length;
    if (numericas >= 3) return i - 1;
  }
  return -1;
}

// ---------------------------------------------------------------
// Sentido del libro (desde el contenido)
// ---------------------------------------------------------------

function sentidoDeTitulo(titulo: string): SifereDirection | null {
  const name = normalizeArcaHeader(titulo);
  const venta = /\bemitid|\bventas\b/.test(name);
  const compra = /\brecibid|\bcompras\b/.test(name);
  if (venta === compra) return null;
  return venta ? "SALE" : "PURCHASE";
}

function sentidoDeColumnas(nombres: ReadonlyMap<string, number>): SifereDirection | null {
  const receptor = nombres.has("denominacion receptor");
  const emisor = nombres.has("denominacion emisor");
  if (receptor === emisor) return null;
  return receptor ? "SALE" : "PURCHASE";
}

function sentidoDeHoja(nombre: string): SifereDirection | null {
  const name = normalizeArcaHeader(nombre);
  if (name === "ventas") return "SALE";
  if (name === "compras") return "PURCHASE";
  return null;
}

function mensajeSentido(detectado: SifereDirection, detalle: string): string {
  const libro = detectado === "SALE" ? "ventas" : "compras";
  const seccion = detectado === "SALE" ? "Ventas" : "Compras";
  return `Este archivo es un libro de ${libro} (${detalle}). Cargalo en la sección ${seccion}.`;
}

// ---------------------------------------------------------------
// Parser principal
// ---------------------------------------------------------------

/**
 * Parsea un libro IVA digital (.xlsx), verifica que su contenido corresponda al
 * sentido pedido y devuelve el análisis por alícuota, los tributos asociados y
 * las filas normalizadas listas para el adaptador ARCA.
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
  if (sheets.length === 0) {
    throw new SifereParseError("SHEET_NOT_FOUND", "El libro no tiene hojas");
  }

  // Sirve la hoja que tiene la fila de encabezado del libro IVA.
  const candidatas = sheets.flatMap((sheet) => {
    const rows = parseWorksheet(sheet.xml, shared);
    const headerIndex = headerRowIndex(rows);
    if (headerIndex === -1) return [];
    // Un libro IVA de ARCA necesita «Fecha» y «Punto de Venta» en su encabezado.
    const celdas: Array<string | undefined> = [];
    for (const [col, value] of rows[headerIndex]!) celdas[col] = value;
    const columnas = resolveArcaColumns(celdas, direction);
    if (columnas.issuedOn === undefined || columnas.pointOfSale === undefined) return [];
    return [{ sheet, rows, headerIndex }];
  });
  if (candidatas.length === 0) {
    throw new SifereParseError("HEADER_NOT_FOUND", "No se encontró el encabezado del libro IVA");
  }
  // Preferencia: la hoja con el nombre del sentido pedido; si no hay, la primera con encabezado.
  const nombreEsperado = direction === "SALE" ? "ventas" : "compras";
  const elegida =
    candidatas.find((candidata) => normalizeArcaHeader(candidata.sheet.name) === nombreEsperado) ??
    candidatas[0]!;
  const { sheet, rows, headerIndex } = elegida;

  const headerRow = rows[headerIndex]!;
  const headerCells: Array<string | undefined> = [];
  const nombres = new Map<string, number>();
  for (const [col, value] of headerRow) {
    headerCells[col] = value;
    const name = normalizeArcaHeader(value);
    if (name && !nombres.has(name)) nombres.set(name, col);
  }
  const headers: string[] = [];
  for (const value of headerRow.values()) {
    if (value) headers.push(value);
  }
  const columns = resolveArcaColumns(headerCells, direction);

  // Sentido desde el contenido: título, columnas de contraparte y nombre de hoja.
  const textosTitulo = rows
    .slice(0, headerIndex)
    .flatMap((row) => [...row.values()])
    .filter((text) => text.trim() !== "");
  const baseTitulo = (textosTitulo[0] ?? "").split(" - ")[0]!.trim().slice(0, 80);
  const deTitulo = sentidoDeTitulo(textosTitulo.join(" "));
  const deColumnas = sentidoDeColumnas(nombres);
  const deHoja = sentidoDeHoja(sheet.name);
  let detectado: { direction: SifereDirection; source: SifereDirectionSource; detalle: string } | null =
    null;
  if (deTitulo) {
    detectado = { direction: deTitulo, source: "titulo", detalle: baseTitulo };
  } else if (deColumnas) {
    detectado = {
      direction: deColumnas,
      source: "columnas",
      detalle: `columna «Denominación ${deColumnas === "SALE" ? "Receptor" : "Emisor"}»`,
    };
  } else if (deHoja) {
    detectado = { direction: deHoja, source: "hoja", detalle: `hoja «${sheet.name}»` };
  }
  if (detectado && detectado.direction !== direction) {
    throw new SifereParseError(
      "SHEET_DIRECTION_MISMATCH",
      mensajeSentido(detectado.direction, detectado.detalle),
    );
  }

  const get = (row: Map<number, string>, key: ArcaColumnKey): string | undefined => {
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
    const typeRaw = (get(row, "typeCode") ?? "").trim();
    const posRaw = (get(row, "pointOfSale") ?? "").trim();
    const numRaw = (get(row, "numberFrom") ?? "").trim();
    // Saltea filas de totales, notas o vacías (no llevan tipo/PV/número).
    if (!typeRaw || !posRaw || !numRaw) continue;
    if (!/^\d+/.test(typeRaw) || !/^\d+$/.test(posRaw) || !/^\d+$/.test(numRaw)) continue;

    const letter = arcaTipoLetter(typeRaw);
    const numberTo = (get(row, "numberTo") ?? "").trim();
    const cuit = arcaCuit(get(row, "cuit"));
    const issuedOn = arcaIsoDate(get(row, "issuedOn"));
    const currency = arcaCurrency(get(row, "currency"));
    const exchangeRate = (get(row, "exchangeRate") ?? "").trim();

    const neto105 = dec(get(row, "neto105"));
    const iva105 = dec(get(row, "iva105"));
    const neto21 = dec(get(row, "neto21"));
    const iva21 = dec(get(row, "iva21"));
    const neto27 = dec(get(row, "neto27"));
    const iva27 = dec(get(row, "iva27"));
    const iva25 = dec(get(row, "iva25"));
    const iva5 = dec(get(row, "iva5"));
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
    // IVA a 2,5% o 5%: el modelo no lo soporta; la fila queda con error, no se pierde en silencio.
    const ivaNoSoportado = !iva25.isZero() || !iva5.isZero();
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
      ...(ivaNoSoportado ? { ivaNoSoportado: true } : {}),
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
    detectedDirection: detectado?.direction ?? null,
    directionSource: detectado?.source ?? null,
    sheetName: sheet.name,
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