import {
  esArchivoTxtDgrTucuman,
  leerTxtDgrTucuman,
  type OpcionesLecturaTxtDgr,
} from "./txtDgrTucuman";

function parseDelimitedRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

export type OpcionesLecturaFuente = OpcionesLecturaTxtDgr;

export interface LecturaFuente {
  rows: Record<string, unknown>[];
  /** Observaciones que no impiden la carga (por ejemplo, fechas fuera del período). */
  avisos: string[];
}

const MAXIMO_ERRORES_VISIBLES = 5;

/** Un archivo con errores por línea: el mensaje lista los primeros y cuenta el resto. */
export class ArchivoConErrores extends Error {
  readonly errores: string[];

  constructor(errores: string[]) {
    const visibles = errores.slice(0, MAXIMO_ERRORES_VISIBLES).join(" ");
    const resto = errores.length - MAXIMO_ERRORES_VISIBLES;
    super(
      errores.length === 1
        ? errores[0]!
        : `El archivo tiene ${errores.length} errores. ${visibles}${
            resto > 0 ? ` Hay ${resto} ${resto === 1 ? "error más" : "errores más"}.` : ""
          }`,
    );
    this.name = "ArchivoConErrores";
    this.errores = errores;
  }
}

/** Lee el archivo y devuelve sus filas con los avisos. Los TXT de la DGR de Tucumán tienen su propio lector. */
export function leerArchivoFuente(
  fileName: string,
  content: string,
  opciones: OpcionesLecturaFuente = {},
): LecturaFuente {
  if (!fileName.toLowerCase().endsWith(".json") && esArchivoTxtDgrTucuman(fileName)) {
    const lectura = leerTxtDgrTucuman(fileName, content, opciones);
    if (lectura.errores.length > 0) throw new ArchivoConErrores(lectura.errores);
    return { rows: lectura.filas, avisos: lectura.avisos };
  }
  return { rows: leerFilasGenericas(fileName, content), avisos: [] };
}

export function parseSourceFile(
  fileName: string,
  content: string,
  opciones?: OpcionesLecturaFuente,
): Record<string, unknown>[] {
  return leerArchivoFuente(fileName, content, opciones).rows;
}

function leerFilasGenericas(fileName: string, content: string): Record<string, unknown>[] {
  if (fileName.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(content) as unknown;
    if (!Array.isArray(parsed) || parsed.some((row) => !row || typeof row !== "object")) {
      throw new Error("El JSON debe contener un arreglo de filas");
    }
    return parsed as Record<string, unknown>[];
  }

  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error("El archivo debe contener encabezado y al menos una fila");
  const delimiter = [";", "\t", ","].sort(
    (left, right) => lines[0]!.split(right).length - lines[0]!.split(left).length,
  )[0]!;
  const headers = parseDelimitedRow(lines[0]!, delimiter);
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) {
    throw new Error("El encabezado contiene columnas vacías o duplicadas");
  }
  return lines.slice(1).map((line) => {
    const values = parseDelimitedRow(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

export async function hashSourceFile(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export async function fileToHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
