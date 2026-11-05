/**
 * Colas de la bandeja documental.
 *
 * La bandeja separa documentos por el estado del Documento (no de la
 * extracción): EXTRACTED = "Para revisar" y REVIEWED = "Revisados".
 * Regresión cubierta: aprobar una extracción debe mover el documento de
 * EXTRACTED a REVIEWED (ver extraction-service.approve), si no, un
 * documento aprobado queda eternamente en "Para revisar".
 */
export type DocumentQueueFilter = "ALL" | "PROCESSING" | "NEEDS_REVIEW" | "REVIEWED" | "ERROR";

const PROCESSING_DOCUMENT_STATUSES = new Set(["UPLOADED", "VALIDATING", "PROCESSING", "IN_PROGRESS", "RUNNING"]);
const ERROR_DOCUMENT_STATUSES = new Set(["EXTRACTION_FAILED", "INFECTED", "FAILED"]);

export function belongsToDocumentQueue(document: { status: string }, filter: DocumentQueueFilter) {
  if (filter === "ALL") return true;
  if (filter === "PROCESSING") return PROCESSING_DOCUMENT_STATUSES.has(document.status);
  if (filter === "NEEDS_REVIEW") return document.status === "EXTRACTED";
  if (filter === "REVIEWED") return document.status === "REVIEWED";
  return ERROR_DOCUMENT_STATUSES.has(document.status);
}