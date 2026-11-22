import { Decimal } from "decimal.js";

/**
 * Encabezados del libro IVA de ARCA («Mis Comprobantes» y libro IVA digital).
 *
 * Un único juego de reglas para el .xlsx (xlsx.ts) y para el .csv/.json
 * (importers.ts): las columnas se reconocen por nombre, nunca por posición.
 * Sin dependencias de los otros módulos del paquete (evita ciclos de importación).
 */

export type ArcaColumnKey =
  | "numberTo"
  | "issuedOn"
  | "typeCode"
  | "pointOfSale"
  | "numberFrom"
  | "docType"
  | "cuit"
  | "name"
  | "total"
  | "currency"
  | "exchangeRate"
  | "noGravado"
  | "exempt"
  | "percepIIBB"
  | "percepIVA"
  | "percepNoCat"
  | "municipales"
  | "internos"
  | "otrosTrib"
  | "neto105"
  | "iva105"
  | "neto21"
  | "iva21"
  | "neto27"
  | "iva27"
  | "iva25"
  | "iva5"
  | "netoGravado"
  | "totalIva"
  | "actividad";

interface HeaderRule {
  key: ArcaColumnKey;
  test: RegExp;
}

// Nombres normalizados (minúsculas, sin acentos ni puntuación). Cubre el
// formato «Mis Comprobantes» de ARCA («Fecha», «Tipo», «Número Desde», «Neto
// Grav. IVA 21%», «Imp. Total») y el libro IVA digital del modelo del producto.
const HEADER_RULES: readonly HeaderRule[] = [
  { key: "numberTo", test: /^numero (de comprobante )?hasta$/ },
  { key: "issuedOn", test: /^(fecha de emision|fecha)$/ },
  { key: "typeCode", test: /^(tipo de comprobante|tipo)$/ },
  { key: "pointOfSale", test: /punto de venta/ },
  { key: "numberFrom", test: /^(numero de comprobante|numero desde)$/ },
  { key: "docType", test: /^tipo doc/ },
  { key: "cuit", test: /^nro doc/ },
  { key: "name", test: /^denominacion/ },
  { key: "total", test: /^(importe|imp) total$/ },
  { key: "currency", test: /^moneda/ },
  { key: "exchangeRate", test: /^tipo (de )?cambio$/ },
  { key: "noGravado", test: /no gravado/ },
  { key: "exempt", test: /exento|^op exentas?$/ },
  { key: "percepIIBB", test: /percepciones de ingresos brutos/ },
  { key: "percepIVA", test: /percepciones o pagos a cuenta de iva/ },
  { key: "percepNoCat", test: /percepcion a no categor/ },
  { key: "municipales", test: /impuestos municipales/ },
  { key: "internos", test: /impuestos internos/ },
  { key: "otrosTrib", test: /otros tributos/ },
  { key: "neto105", test: /^neto grav(ado)? iva 10/ },
  { key: "iva105", test: /^(importe )?iva 10/ },
  { key: "neto21", test: /^neto grav(ado)? iva 21/ },
  { key: "iva21", test: /^(importe )?iva 21/ },
  { key: "neto27", test: /^neto grav(ado)? iva 27/ },
  { key: "iva27", test: /^(importe )?iva 27/ },
  { key: "iva25", test: /^(importe )?iva 2 5/ },
  { key: "iva5", test: /^(importe )?iva 5$/ },
  { key: "netoGravado", test: /^(total )?neto gravado( total)?$/ },
  { key: "totalIva", test: /total iva/ },
  { key: "actividad", test: /actividad/ },
];

/**
 * Notas de crédito y de débito según la tabla oficial de ARCA («Libro IVA Digital - Tablas del
 * Sistema», apartado «Tipo de Comprobante»). Es la única fuente: el importador y la liquidación
 * (voucherDocumentKind) deciden por estas listas, no por la letra ni por un código suelto.
 */
export const ARCA_NOTA_CREDITO_CODES: ReadonlySet<number> = new Set([
  3, 8, 13, 21, 38, 43, 44, 48, 53, 90, 110, 112, 113, 114, 119, 197, 203, 208, 213,
]);
export const ARCA_NOTA_DEBITO_CODES: ReadonlySet<number> = new Set([
  2, 7, 12, 20, 37, 45, 46, 47, 52, 115, 116, 117, 120, 196, 202, 207, 212,
]);

// Facturas con letra propia. Los recibos y los tiques no entran: sin letra, la fila se informa con su motivo.
const TYPE_TO_LETTER: Readonly<Record<string, string>> = {
  "1": "A",
  "6": "B",
  "11": "C",
  "51": "M",
  // Liquidaciones de ARCA: 63 = Liquidación A, 64 = Liquidación B (decisión de Ciro, A27-1).
  "63": "A",
  "64": "B",
  // Facturas de crédito electrónica MiPyME (FCE): sus notas (203, 208, 213) ya están en la tabla oficial.
  "201": "A",
  "206": "B",
  "211": "C",
};

/** Clase de comprobante desde el código de ARCA («13», «013», «13 - Nota de Crédito C»). Null si no es un código. */
export function arcaTipoClase(value: string | number | null | undefined): "NC" | "ND" | "FACTURA" | null {
  const code = /^\s*(\d+)/.exec(String(value ?? ""))?.[1];
  if (code === undefined) return null;
  const numero = Number(code);
  if (ARCA_NOTA_CREDITO_CODES.has(numero)) return "NC";
  if (ARCA_NOTA_DEBITO_CODES.has(numero)) return "ND";
  return "FACTURA";
}

const EXCEL_EPOCH_MS = 25569 * 86400000; // 1899-12-30 en ms desde epoch

/** Normaliza un encabezado para compararlo: minúsculas, sin acentos ni puntuación. */
export function normalizeArcaHeader(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Devuelve, por clave canónica, el índice del encabezado que la contiene.
 * `headers` va por posición (columna del .xlsx o índice del .csv); las
 * posiciones vacías se ignoran. La contraparte depende del sentido: en una
 * venta es el receptor y en una compra es el emisor.
 */
export function resolveArcaColumns(
  headers: ReadonlyArray<string | undefined>,
  direction: "SALE" | "PURCHASE",
): Partial<Record<ArcaColumnKey, number>> {
  const byName = new Map<string, number>();
  headers.forEach((header, col) => {
    if (!header) return;
    const name = normalizeArcaHeader(header);
    if (name && !byName.has(name)) byName.set(name, col);
  });

  const resolved: Partial<Record<ArcaColumnKey, number>> = {};
  for (const rule of HEADER_RULES) {
    for (const [name, col] of byName) {
      if (rule.test.test(name)) {
        resolved[rule.key] = col;
        break;
      }
    }
  }

  const contraparte = direction === "SALE" ? "receptor" : "emisor";
  const cuitCol = byName.get(`nro doc ${contraparte}`);
  if (cuitCol !== undefined) resolved.cuit = cuitCol;
  const nameCol = byName.get(`denominacion ${contraparte}`);
  if (nameCol !== undefined) resolved.name = nameCol;
  return resolved;
}

/** Letra del comprobante desde el tipo de ARCA («6», «6 - Factura B»). Vacío si no se reconoce. */
export function arcaTipoLetter(value: string | null | undefined): string {
  const code = /^\s*(\d+)/.exec(value ?? "")?.[1];
  if (code === undefined) return "";
  const clase = arcaTipoClase(code);
  if (clase === "NC" || clase === "ND") return clase;
  return TYPE_TO_LETTER[String(Number(code))] ?? "";
}

/** Fecha ISO (AAAA-MM-DD) desde «dd/mm/aaaa», ISO o número de serie de Excel. Null si no es válida. */
export function arcaIsoDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (br) {
    const iso = `${br[3]}-${br[2]}-${br[1]}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
    return iso;
  }
  const serial = Number(trimmed);
  if (!Number.isFinite(serial)) return null;
  const date = new Date(Math.round(serial * 86400000 - EXCEL_EPOCH_MS));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** CUIT de 11 dígitos. Vacío o ceros → consumidor final (11 ceros); DNI y CUIL se completan con ceros. */
export function arcaCuit(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (digits === "" || /^0+$/.test(digits)) return "00000000000";
  if (digits.length < 11) return digits.padStart(11, "0");
  return digits;
}

/**
 * Importe como texto decimal con punto. Acepta coma decimal («1.234,56» o
 * «1234,56»). Vacío → undefined. Lo que no es numérico se devuelve tal cual y
 * lo rechaza la normalización de la fila.
 */
export function arcaAmount(value: unknown): string | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value !== "string") return undefined;
  let text = value.trim().replace(/\s/g, "");
  if (text === "") return undefined;
  if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(text)) text = text.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(text)) text = text.replace(",", ".");
  return text;
}

/** Moneda ISO: «$» y «Pesos» son ARS; un código de tres letras se mantiene; el resto, ARS (como antes). */
export function arcaCurrency(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (/^(pes|peso|pesos|ars|\$)$/i.test(text)) return "ARS";
  if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();
  if (/d[oó]lar/i.test(text)) return "USD";
  return "ARS";
}

/** Verdadero si el texto es un número decimal válido para los importes canónicos. */
export function esImporteDecimal(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value) && new Decimal(value).isFinite();
}
