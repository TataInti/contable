import type { PresentationEvidenceCategory } from "@contable/contracts";
import { api, uploadToSignedUrl } from "../lib/api";

/**
 * Constancia de presentación subida por el estudio.
 *
 * El organismo recibe la presentación pero la constancia hay que bajarla aparte;
 * acá el estudio la adjunta al registrar la presentación, sin pedido documental
 * ni portal del cliente. El archivo pasa por la validación y el antivirus de
 * cualquier documento antes de quedar disponible.
 */

interface UploadSession {
  sessionId: string;
  presignedUrl: string;
  objectKey: string;
}

interface ReceiptDocument {
  id: string;
  status: string;
}

const READY_STATUSES = ["READY", "APPLIED"];
const FAILED_STATUSES = ["FAILED", "CANCELED", "EXTRACTION_FAILED"];

export const RECEIPT_ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

/**
 * Sube una constancia o una declaración jurada del estudio, sin pedido documental, y devuelve el
 * id del documento, todavía en validación.
 */
export async function uploadPresentacionDocument(
  base: string,
  file: File,
  category: PresentationEvidenceCategory,
): Promise<string> {
  const session = await api.post<UploadSession>(`${base}/document-upload-sessions`, {
    ...(file.type ? { expectedMime: file.type } : {}),
    category,
  });
  await uploadToSignedUrl(session.presignedUrl, file);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const completed = await api.post<{ documentId: string }>(
    `${base}/document-upload-sessions/${session.sessionId}/complete`,
    {
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      sha256,
      objectKey: session.objectKey,
    },
  );
  return completed.documentId;
}

/** El acuse de presentación: atajo de PanelPresentacion, que no cambia en 5b-1. */
export function uploadFilingReceipt(base: string, file: File): Promise<string> {
  return uploadPresentacionDocument(base, file, "ACUSE");
}

/** Espera a que la constancia termine la validación. Rechaza si falla o si tarda demasiado. */
export async function waitForReceiptReady(
  base: string,
  documentId: string,
  { timeoutMs = 90_000, intervalMs = 2_000 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const documents = await api.get<ReceiptDocument[]>(`${base}/documents`);
    const status = documents.find((document) => document.id === documentId)?.status;
    if (status && READY_STATUSES.includes(status)) return;
    if (status && FAILED_STATUSES.includes(status)) {
      throw new Error("El acuse no pasó la validación del archivo. Probá con otro archivo.");
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "El acuse ya quedó subido pero sigue en validación. Esperá un momento, elegilo de la lista y registrá la presentación.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
