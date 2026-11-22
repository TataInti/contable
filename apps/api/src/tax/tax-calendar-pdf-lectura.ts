import { TAX_CALENDAR_PDF_MAX_BYTES } from "@contable/contracts";

/**
 * Lectura de calendarios desde PDF (brief 5A): funciones puras, sin base ni red.
 * Validan el archivo que llega en base64 y arman los motivos que ve el contador.
 */

/** El PDF recibido no sirve (formato, tamaño o base64). El servicio lo traduce a un error 422 de calendarios. */
export class PdfCalendarioInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfCalendarioInvalidoError";
  }
}

export const MOTIVO_LECTURA_NO_DISPONIBLE =
  "La lectura automática no está disponible para este estudio. Completá las celdas a mano sobre el PDF.";
export const MOTIVO_LECTURA_FALLIDA =
  "La IA no pudo leer este PDF (escaneado ilegible o formato desconocido). Completá las celdas a mano sobre el PDF.";

/** Motivos de la IA que significan «no está habilitada» o «no está configurada» (no es un fallo del PDF). */
const MOTIVOS_NO_DISPONIBLE = new Set([
  "CUSTOMER_DATA_EXTRACTION_DISABLED",
  "EXTRACTION_ENGINE_UNSUPPORTED",
  "EXTRACTION_MODEL_NOT_CONFIGURED",
  "MODEL_NOT_PRIVACY_ALLOWLISTED",
  "OPENROUTER_PROVIDER_NOT_PRIVACY_ALLOWLISTED",
  "OPENROUTER_API_KEY_MISSING",
]);

/** Valida el PDF que llega en base64 y devuelve su contenido. Tope: TAX_CALENDAR_PDF_MAX_BYTES. */
export function decodificarPdfCalendario(pdfBase64: string): Buffer {
  const limpio = pdfBase64.replace(/^data:application\/pdf;base64,/, "").trim();
  if (limpio.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(limpio)) {
    throw new PdfCalendarioInvalidoError("El archivo no se pudo leer: volvé a elegir el PDF");
  }
  const pdf = Buffer.from(limpio, "base64");
  if (pdf.length > TAX_CALENDAR_PDF_MAX_BYTES) {
    const mb = (pdf.length / (1024 * 1024)).toFixed(1).replace(".", ",");
    throw new PdfCalendarioInvalidoError(`El PDF pesa ${mb} MB y el máximo es 5 MB. Bajá la calidad del archivo o subí solo las páginas del calendario.`,
    );
  }
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new PdfCalendarioInvalidoError("El archivo no es un PDF: subí el calendario en formato PDF");
  }
  return pdf;
}

/** Texto de la lectura que se muestra en la pantalla cuando la IA no deja celdas. */
export function motivoDeLecturaFallida(reason: string | null): string {
  if (reason !== null && MOTIVOS_NO_DISPONIBLE.has(reason)) return MOTIVO_LECTURA_NO_DISPONIBLE;
  return MOTIVO_LECTURA_FALLIDA;
}
