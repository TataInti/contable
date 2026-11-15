import {
  TAX_CALENDAR_IMPORT_COLUMNS,
  TAX_CALENDAR_IMPORT_MAX_BYTES,
  TAX_CALENDAR_IMPORT_MAX_ROWS,
  TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS,
  type TaxCalendarEntriesImportReport,
  type TaxCalendarImportNotice,
} from "@contable/contracts";
import { ApiError } from "../lib/api";

/**
 * Lógica pura del cajón «Importar celdas desde un archivo» (corte 2b-2). La API decide qué
 * se importa (corte 2b-1); acá se cuenta, se nombra y se decide cuándo se puede avanzar.
 */

/** Columnas del contrato, sin escribirlas a mano. */
export const COLUMNAS_OBLIGATORIAS: readonly string[] = TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS;
export const COLUMNAS_OPCIONALES: readonly string[] = TAX_CALENDAR_IMPORT_COLUMNS.filter(
  (columna) => !TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS.some((obligatoria) => obligatoria === columna),
);

const numero = (valor: number): string => valor.toLocaleString("es-AR");

export const TOPE_ARCHIVO = `${TAX_CALENDAR_IMPORT_MAX_BYTES / (1024 * 1024)} MB`;
export const TOPE_FILAS = numero(TAX_CALENDAR_IMPORT_MAX_ROWS);

const BORRADOR_CERRADO = "El calendario ya no está en borrador.";

/** Prefijo del aviso que el lector de la API emite por cada celda que queda como dudosa. */
const PREFIJO_DUDOSA = "Queda marcada como dudosa";

/** El informe no trae un contador de dudosas: cada una llega como aviso con este texto. */
export function esAvisoDeDudosa(aviso: TaxCalendarImportNotice): boolean {
  return aviso.motivo.startsWith(PREFIJO_DUDOSA);
}

export interface ResumenInforme {
  leidas: number;
  aImportar: number;
  /** Filas rechazadas: una fila puede traer varios motivos y se cuenta una sola vez. */
  filasRechazadas: number;
  dudosas: number;
}

export function resumenInforme(informe: TaxCalendarEntriesImportReport): ResumenInforme {
  return {
    leidas: informe.totalFilas,
    aImportar: informe.validas,
    filasRechazadas: new Set(informe.rechazadas.map((rechazo) => rechazo.fila)).size,
    dudosas: informe.avisos.filter(esAvisoDeDudosa).length,
  };
}

/** «1 celda» o «411 celdas». */
export function celdas(cantidad: number): string {
  return cantidad === 1 ? "1 celda" : `${numero(cantidad)} celdas`;
}

/** Rótulo del botón principal: «Importar 411 celdas». Antes de la prueba, «Importar celdas». */
export function rotuloImportar(aImportar: number | null): string {
  return aImportar === null ? "Importar celdas" : `Importar ${celdas(aImportar)}`;
}

/** Línea del informe cuando hay dudosas; vacía si no hay ninguna. */
export function lineaDudosas(dudosas: number): string {
  if (dudosas === 0) return "";
  return dudosas === 1
    ? "1 celda quedará marcada «Dudosa»: hay que revisarla antes de publicar el calendario."
    : `${numero(dudosas)} celdas quedarán marcadas «Dudosa»: hay que revisarlas antes de publicar el calendario.`;
}

/** Aviso de la importación real: «Se importaron 411 celdas; 297 quedan dudosas: hay que revisarlas…». */
export function notificacionImportacion(importadas: number, dudosas: number): string {
  const base = `${importadas === 1 ? "Se importó" : "Se importaron"} ${celdas(importadas)}`;
  if (dudosas === 0) return `${base}.`;
  const quedan = dudosas === 1 ? "1 queda dudosa" : `${numero(dudosas)} quedan dudosas`;
  const revisar = dudosas === 1 ? "hay que revisarla" : "hay que revisarlas";
  return `${base}; ${quedan}: ${revisar} antes de publicar el calendario.`;
}

/** Mismo texto que el lector de la API cuando el archivo pesa más del tope. */
export function errorDeTamano(bytes: number): string | null {
  if (bytes <= TAX_CALENDAR_IMPORT_MAX_BYTES) return null;
  return `El archivo supera el máximo de ${TOPE_ARCHIVO} (pesa ${Math.ceil(bytes / 1024)} KB). Dividilo en archivos más chicos.`;
}

/** Mismo texto que el lector de la API cuando el archivo no tiene contenido. */
export function errorDeContenido(texto: string): string | null {
  return texto.trim() === ""
    ? "El archivo está vacío. Subí un CSV con el encabezado y al menos una fila."
    : null;
}

/** Tamaño para mostrar junto al nombre del archivo: «42 KB» (mínimo 1 KB). */
export function tamanoArchivo(bytes: number): string {
  return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

export type ErrorDeImportacion =
  | { tipo: "archivo"; mensaje: string }
  | { tipo: "borrador"; mensaje: string }
  | { tipo: "reintentar"; mensaje: string }
  | { tipo: "otro"; mensaje: string };

/** Clasifica el error por estado y código de la API; el mensaje siempre es el del servidor. */
export function errorDeImportacion(error: unknown): ErrorDeImportacion {
  if (!(error instanceof ApiError)) {
    return {
      tipo: "reintentar",
      mensaje: "No se pudo completar la solicitud. Reintentá en unos minutos.",
    };
  }
  if (error.status === 422 && error.code === "CALENDAR_VALIDATION_FAILED") {
    return { tipo: "archivo", mensaje: error.message };
  }
  if (error.status === 409 && error.code === "CALENDAR_NOT_DRAFT") {
    return { tipo: "borrador", mensaje: error.message };
  }
  if (error.retryable) return { tipo: "reintentar", mensaje: error.message };
  return { tipo: "otro", mensaje: error.message };
}

export interface EstadoImportacion {
  archivoElegido: boolean;
  leyendo: boolean;
  archivoError: string | null;
  borradorCerrado: boolean;
  informe: TaxCalendarEntriesImportReport | null;
}

/** Motivo de «Probar sin guardar» deshabilitado; null si se puede probar. */
export function motivoProbar(estado: EstadoImportacion): string | null {
  if (!estado.archivoElegido) return "Elegí un archivo para probarlo.";
  if (estado.leyendo) return "Leyendo el archivo…";
  if (estado.archivoError) return "Elegí otro archivo para probarlo.";
  if (estado.borradorCerrado) return BORRADOR_CERRADO;
  return null;
}

/** Motivo de «Importar N celdas» deshabilitado; null si se puede importar. */
export function motivoImportar(estado: EstadoImportacion): string | null {
  if (!estado.archivoElegido) return "Elegí un archivo para importarlo.";
  if (estado.leyendo) return "Leyendo el archivo…";
  if (estado.archivoError) return "Elegí otro archivo para importarlo.";
  if (estado.borradorCerrado) return BORRADOR_CERRADO;
  if (!estado.informe) return "Probalo sin guardar para ver el informe antes de importar.";
  if (estado.informe.validas === 0) {
    return "No hay celdas para importar: corregí las filas rechazadas y probá de nuevo.";
  }
  return null;
}
