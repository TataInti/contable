import { describe, expect, it } from "vitest";
import { detectMime, sha256Of, validateFile, safeBaseName, MAX_FILE_SIZE } from "./file-validator.js";

describe("detectMime", () => {
  it("detecta PDF por magic bytes", () => {
    expect(detectMime(Buffer.from("%PDF-1.4 ..."))).toBe("application/pdf");
  });

  it("detecta JPEG por FF D8 FF", () => {
    expect(detectMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("image/jpeg");
  });

  it("detecta PNG", () => {
    expect(detectMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png");
  });

  it("rechaza contenido desconocido", () => {
    expect(detectMime(Buffer.from("hello world"))).toBeUndefined();
  });
});

describe("validateFile", () => {
  it("acepta un PDF válido con nombre coherente", () => {
    const pdf = Buffer.from("%PDF-1.4 minimal pdf content");
    const result = validateFile(pdf, "application/pdf", "factura.pdf");
    expect(result.ok).toBe(true);
    expect(result.detectedMime).toBe("application/pdf");
    expect(result.sha256).toBe(sha256Of(pdf));
  });

  it("rechaza archivo vacío", () => {
    expect(validateFile(Buffer.alloc(0), "application/pdf", "x.pdf").ok).toBe(false);
  });

  it("rechaza tamaño excesivo", () => {
    const big = Buffer.alloc(MAX_FILE_SIZE + 1);
    expect(validateFile(big, "application/pdf", "x.pdf").ok).toBe(false);
  });

  it("rechaza MIME declarado que no coincide", () => {
    const pdf = Buffer.from("%PDF-1.4 content");
    const result = validateFile(pdf, "image/png", "x.pdf");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("MIME");
  });

  it("rechaza extensión que no coincide", () => {
    const pdf = Buffer.from("%PDF-1.4 content");
    const result = validateFile(pdf, "application/pdf", "x.exe");
    expect(result.ok).toBe(false);
  });

  it("rechaza contenido no soportado", () => {
    const junk = Buffer.from("this is not a file at all");
    expect(validateFile(junk, "application/pdf", "x.pdf").ok).toBe(false);
  });
});

describe("safeBaseName", () => {
  it("quita traversal de path", () => {
    expect(safeBaseName("../../etc/passwd")).toBe("passwd");
  });

  it("quita backslashes", () => {
    expect(safeBaseName("..\\..\\secret.txt")).toBe("secret.txt");
  });

  it("limita longitud", () => {
    const long = "a".repeat(500) + ".pdf";
    expect(safeBaseName(long).length).toBeLessThanOrEqual(200);
  });
});