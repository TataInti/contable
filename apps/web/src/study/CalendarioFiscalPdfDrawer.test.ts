import { describe, expect, it } from "vitest";
import { errorDelPdf } from "./CalendarioFiscalPdfDrawer";

/** Apoyo del alta desde PDF (brief 5A): validación del archivo antes de subirlo. */

describe("errorDelPdf", () => {
  it("no marca error cuando todavía no se eligió archivo (lo marca el motivo del botón)", () => {
    expect(errorDelPdf(null)).toBeNull();
  });

  it("acepta un PDF de hasta 5 MB", () => {
    const pdf = new File(["%PDF-1.4"], "calendario.pdf", { type: "application/pdf" });
    expect(errorDelPdf(pdf)).toBeNull();
  });

  it("pide elegir un PDF cuando el archivo no lo es", () => {
    const imagen = new File(["x"], "calendario.png", { type: "image/png" });
    expect(errorDelPdf(imagen)).toBe("Elegí un archivo PDF: el calendario se lee en formato PDF.");
  });

  it("dice cuánto pesa el archivo cuando supera 5 MB", () => {
    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "calendario.pdf", { type: "application/pdf" });
    expect(errorDelPdf(grande)).toContain("El PDF pesa más de 5 MB");
  });
});
