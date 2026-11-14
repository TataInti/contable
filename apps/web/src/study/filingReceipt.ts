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

/** Sube la constancia y devuelve el id del documento, todavía en validación. */
export async function uploadFilingReceipt(base: string, file: File): Promise<string> {
  const session = await api.post<UploadSession>(`${base}/document-upload-sessions`, {
    ...(file.type ? { expectedMime: file.type } : {}),
    category: "ACUSE",
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
      throw new Error("La constancia no pasó la validación del archivo. Probá con otro archivo.");
    }
    if (Date.now() >= deadline) {
      throw new Error(
        "La constancia ya quedó subida pero sigue en validación. Esperá un momento, elegila de la lista y registrá la presentación.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
