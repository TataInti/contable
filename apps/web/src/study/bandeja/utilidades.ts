import type { Document } from "../../lib/api";

export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export function validateFile(selected: File | null) {
  if (!selected) return "Elegí un archivo para continuar.";
  if (!ALLOWED_TYPES.has(selected.type) || selected.size > MAX_FILE_SIZE)
    return "Elegí un PDF, JPG, PNG o WebP de hasta 25 MB.";
  return null;
}

export function fileSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`
    : `${Math.ceil(size / 1024)} KB`;
}

export function documentFileName(document: Document) {
  return document.fileVersions?.[0]?.originalName ?? document.id.slice(0, 8);
}

export function documentTypeLabel(document: Document) {
  const mimeType = document.fileVersions?.[0]?.mimeType ?? "";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("webp")) return "WEBP";
  return "IMAGEN";
}

export function normalizeDocumentSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR");
}
