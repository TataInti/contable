import { createHash } from "node:crypto";

/**
 * Validación de archivos (plan sección 8.2 / 19.4).
 * - Allowlist cerrada de PDF/JPG/PNG/WEBP/HEIC.
 * - Magic bytes además de extensión/MIME declarado.
 * - Límites previos/posteriores.
 */

export const ALLOWED_TYPES = {
  "application/pdf": [".pdf", "%PDF-"],
  "image/jpeg": [".jpg", ".jpeg", "\uFFFD\uFFFD\uFFFD\uFFFD"], // FF D8 FF D8
  "image/png": [".png", "\u0089PNG"],
  "image/webp": [".webp", "RIFF....WEBP"],
  "image/heic": [".heic", ""],
} as const;

export type AllowedMime = keyof typeof ALLOWED_TYPES;

export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
export const MAX_PAGES = 100;

export interface FileValidationResult {
  ok: boolean;
  error?: string;
  detectedMime?: string;
  sha256?: string;
  size: number;
}

export function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Detecta el MIME real por magic bytes (inicio del buffer). */
export function detectMime(buffer: Buffer): string | undefined {
  const head = buffer.subarray(0, 12).toString("latin1");
  if (head.startsWith("%PDF-")) return "application/pdf";
  const jpegHex = buffer.subarray(0, 3).toString("hex");
  if (jpegHex.startsWith("ffd8ff")) return "image/jpeg";
  if (head.startsWith("\u0089PNG")) return "image/png";
  if (head.startsWith("RIFF") && buffer.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return undefined;
}

/** Valida tamaño, magic bytes y extensión. */
export function validateFile(
  buffer: Buffer,
  declaredMime: string,
  originalName: string,
  opts: { maxSize?: number } = {},
): FileValidationResult {
  const size = buffer.length;
  const maxSize = opts.maxSize ?? MAX_FILE_SIZE;

  if (size <= 0) return { ok: false, error: "Archivo vacío", size };
  if (size > maxSize) {
    return { ok: false, error: `Excede el tamaño máximo (${maxSize} bytes)`, size };
  }

  const detected = detectMime(buffer);
  if (!detected) return { ok: false, error: "Tipo de archivo no soportado (magic bytes inválidos)", size };

  // El MIME declarado debe coincidir con el detectado (o ser genérico)
  if (declaredMime && declaredMime !== "application/octet-stream" && declaredMime !== detected) {
    return { ok: false, error: "MIME declarado no coincide con el contenido real", size };
  }

  const ext = getExtension(originalName);
  const allowedExts: readonly string[] | undefined =
    (ALLOWED_TYPES as Record<string, readonly string[] | undefined>)[detected] ?? undefined;
  if (ext && allowedExts && !allowedExts.includes(ext.toLowerCase())) {
    return { ok: false, error: "Extensión no coincide con el tipo real", size };
  }

  return { ok: true, detectedMime: detected, sha256: sha256Of(buffer), size };
}

function getExtension(name: string): string | undefined {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx) : undefined;
}

/** Normaliza el nombre del archivo: quita traversal y caracteres peligrosos. */
export function safeBaseName(name: string): string {
  // Quita paths y traversal
  const base = name.split(/[/\\]/).pop() ?? "";
  // Quita caracteres de control y espacios raros
  return base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.\.+/g, "")
    .slice(0, 200);
}