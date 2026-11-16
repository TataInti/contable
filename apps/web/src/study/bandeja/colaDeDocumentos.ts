import type { Document } from "../../lib/api";
import { formatearFechaHora } from "../../lib/formatoFechas";
import { getStatusBadgeMeta } from "../../ui/StatusBadge";
import { documentFileName, documentTypeLabel, normalizeDocumentSearch } from "./utilidades";

/**
 * Colas de la Bandeja documental, por estado del documento (no de la extracción).
 * EXTRACTED es «Para revisar» y REVIEWED es «Revisado»: aprobar una extracción mueve el
 * documento de una cola a la otra (ver extraction-service.approve).
 *
 * Lógica pura: los indicadores, el filtro y la búsqueda de la lista salen de acá.
 */
export type DocumentQueueFilter = "ALL" | "PROCESSING" | "NEEDS_REVIEW" | "REVIEWED" | "ERROR";

const PROCESSING_DOCUMENT_STATUSES = new Set([
  "UPLOADED",
  "VALIDATING",
  "PROCESSING",
  "IN_PROGRESS",
  "RUNNING",
]);
const ERROR_DOCUMENT_STATUSES = new Set(["EXTRACTION_FAILED", "INFECTED", "FAILED"]);

export function belongsToDocumentQueue(document: { status: string }, filter: DocumentQueueFilter) {
  if (filter === "ALL") return true;
  if (filter === "PROCESSING") return PROCESSING_DOCUMENT_STATUSES.has(document.status);
  if (filter === "NEEDS_REVIEW") return document.status === "EXTRACTED";
  if (filter === "REVIEWED") return document.status === "REVIEWED";
  return ERROR_DOCUMENT_STATUSES.has(document.status);
}

/**
 * Nombre visible de cada estado en la Bandeja (C7B-4): el mismo que el de su cola.
 * READY, APPLIED y CANCELED no tienen cola y conservan el nombre compartido de StatusBadge.
 * Es un mapeo local de la Bandeja: el StatusBadge compartido no cambia.
 */
const NOMBRE_EN_BANDEJA: Readonly<Record<string, string>> = {
  EXTRACTED: "Para revisar",
  REVIEWED: "Revisado",
  UPLOADED: "Procesando",
  VALIDATING: "Procesando",
  PROCESSING: "Procesando",
  IN_PROGRESS: "Procesando",
  RUNNING: "Procesando",
  EXTRACTION_FAILED: "Con error",
  FAILED: "Con error",
  INFECTED: "Amenaza detectada",
};

export function nombreVisibleDelEstado(status: string): string {
  return NOMBRE_EN_BANDEJA[status] ?? getStatusBadgeMeta(status).label;
}

/** Lo que la fila muestra y la búsqueda recorre: nombre, tipo, estado con su nombre visible y fecha de ingreso. */
function textoDeLaFila(document: Document): string {
  return [
    documentFileName(document),
    documentTypeLabel(document),
    nombreVisibleDelEstado(document.status),
    formatearFechaHora(document.createdAt),
  ].join(" ");
}

/** Búsqueda por lo que se ve (7b-6), sin tildes ni mayúsculas. Una búsqueda vacía no filtra. */
export function coincideConBusqueda(document: Document, busqueda: string): boolean {
  const termino = normalizeDocumentSearch(busqueda.trim());
  if (!termino) return true;
  return normalizeDocumentSearch(textoDeLaFila(document)).includes(termino);
}

/** Más recientes primero (7b-12): la pantalla ordena por fecha de ingreso y no depende del orden de la API. */
export function ordenarPorIngresoDescendente<T extends { createdAt: string }>(
  documentos: readonly T[],
): T[] {
  return [...documentos].sort(
    (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
  );
}
