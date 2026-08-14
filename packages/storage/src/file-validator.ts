import { createHash } from "node:crypto";

/**
 * Validación de archivos — compartido (API + worker).
 * Allowlist de PDF/JPG/PNG/WEBP/HEIC por magic bytes.
 */

export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Detecta el MIME real por magic bytes. */
export function detectMime(buffer: Buffer): string | undefined {
  const head = buffer.subarray(0, 12).toString("latin1");
  if (head.startsWith("%PDF-")) return "application/pdf";
  const jpegHex = buffer.subarray(0, 3).toString("hex");
  if (jpegHex.startsWith("ffd8ff")) return "image/jpeg";
  if (head.startsWith("\u0089PNG")) return "image/png";
  if (head.startsWith("RIFF") && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return undefined;
}