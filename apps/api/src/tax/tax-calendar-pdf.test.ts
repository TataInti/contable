import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TAX_CALENDAR_PDF_MAX_BYTES } from "@contable/contracts";
import {
  MOTIVO_LECTURA_FALLIDA,
  MOTIVO_LECTURA_NO_DISPONIBLE,
  PdfCalendarioInvalidoError,
  decodificarPdfCalendario,
  motivoDeLecturaFallida,
} from "./tax-calendar-pdf-lectura.js";
import { leerCsvCalendario, mapearImportacion } from "./tax-calendar-csv.js";

/*
 * Apoyo del alta desde PDF (brief 5A): validaciones del archivo y mapeo de la lectura de la IA.
 * El flujo de la pantalla lo cubre el spec e2e/calendario-pdf-ui.spec.ts.
 */

const pdfSintetico = Buffer.from("%PDF-1.4\nsintetico\n%%EOF\n", "latin1").toString("base64");

describe("decodificarPdfCalendario", () => {
  it("acepta un PDF y devuelve sus bytes", () => {
    const pdf = decodificarPdfCalendario(pdfSintetico);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("rechaza un archivo que no es PDF, con el mensaje para el contador", () => {
    const texto = Buffer.from("no soy un pdf").toString("base64");
    expect(() => decodificarPdfCalendario(texto)).toThrow(PdfCalendarioInvalidoError);
    expect(() => decodificarPdfCalendario(texto)).toThrow("El archivo no es un PDF: subí el calendario en formato PDF");
  });

  it("rechaza un PDF que supera el tope de 5 MB y dice cuánto pesa", () => {
    const grande = Buffer.alloc(TAX_CALENDAR_PDF_MAX_BYTES + 1024 * 1024, 0x41);
    grande.write("%PDF-", 0, "latin1");
    expect(() => decodificarPdfCalendario(grande.toString("base64"))).toThrow("El PDF pesa 6,0 MB y el máximo es 5 MB");
  });

  it("rechaza base64 vacío o con caracteres inválidos", () => {
    expect(() => decodificarPdfCalendario("")).toThrow(PdfCalendarioInvalidoError);
    expect(() => decodificarPdfCalendario("%%%no-base64%%%")).toThrow(PdfCalendarioInvalidoError);
  });
});

describe("motivoDeLecturaFallida", () => {
  it("dice que la lectura no está disponible cuando la IA lo indica", () => {
    expect(motivoDeLecturaFallida("CUSTOMER_DATA_EXTRACTION_DISABLED")).toBe(MOTIVO_LECTURA_NO_DISPONIBLE);
    expect(motivoDeLecturaFallida("EXTRACTION_MODEL_NOT_CONFIGURED")).toBe(MOTIVO_LECTURA_NO_DISPONIBLE);
  });

  it("dice que el PDF no se pudo leer en los demás casos, y ofrece completar a mano", () => {
    expect(motivoDeLecturaFallida("PDF_RASTERIZATION_FAILED")).toBe(MOTIVO_LECTURA_FALLIDA);
    expect(motivoDeLecturaFallida(null)).toBe(MOTIVO_LECTURA_FALLIDA);
    expect(MOTIVO_LECTURA_FALLIDA).toContain("Completá las celdas a mano sobre el PDF");
  });
});

describe("lectura de la IA con el mapeo de la importación", () => {
  // La IA devuelve el mismo CSV que la importación: el fixture sintético tiene 5 celdas y
  // la celda de terminaciones 6 y 7 viene con confianza baja y sin verificar en imagen.
  const csv = readFileSync(new URL("../../../../e2e/fixtures/calendario-arca-2027-lectura-ia.csv", import.meta.url), "utf-8");

  it("propone 5 celdas que cubren las terminaciones 0 a 9 y marca como dudosa la de 6 y 7", () => {
    const lectura = leerCsvCalendario(csv);
    const resultado = mapearImportacion(lectura, new Set());
    expect(resultado.celdas).toHaveLength(5);
    expect(resultado.rechazadas).toHaveLength(0);
    const dudosas = resultado.celdas.filter((celda) => celda.revision === "FLAGGED");
    expect(dudosas).toHaveLength(1);
    expect(dudosas[0]?.entrada.endingDigits).toBe("67");
    expect(dudosas[0]?.entrada.dueDate).toBe("2027-11-19");
    const digitos = resultado.celdas.flatMap((celda) => (celda.entrada.endingDigits ?? "").split("")).sort().join("");
    expect(digitos).toBe("0123456789");
  });
});
