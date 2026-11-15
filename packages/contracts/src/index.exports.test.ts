import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";

// Protege las dos líneas de exportación que el índice reúne desde cortes
// distintos: cuit-ending.js (terminación de CUIT, calendarios) y
// fiscal-books.js (libros de compras y ventas, corte 7a). Si un merge futuro
// pierde una de ellas, esta prueba falla en CI.
describe("índice de contratos: exportaciones de calendarios y libros", () => {
  it("exporta cuitEnding y devuelve la terminación con guiones", () => {
    expect(contracts).toHaveProperty("cuitEnding");
    expect(contracts.cuitEnding("20-12345678-9")).toBe("9");
  });

  it("exporta FISCAL_BOOK_COLUMNS y fiscalBookExportQuerySchema", () => {
    expect(contracts).toHaveProperty("FISCAL_BOOK_COLUMNS");
    expect(contracts).toHaveProperty("fiscalBookExportQuerySchema");
    expect(contracts.FISCAL_BOOK_COLUMNS.length).toBeGreaterThan(0);
    const { fiscalBookExportQuerySchema } = contracts;
    expect(typeof fiscalBookExportQuerySchema.safeParse).toBe("function");
  });
  it("exporta los esquemas de calendarios fiscales (corte 2a-i)", () => {
    expect(contracts).toHaveProperty("createTaxCalendarSchema");
    expect(contracts).toHaveProperty("taxCalendarEntryInputSchema");
    expect(contracts).toHaveProperty("taxCalendarListQuerySchema");
  });

  it("exporta el esquema y las columnas de la importación de calendarios (corte 2b-1)", () => {
    expect(contracts).toHaveProperty("importTaxCalendarEntriesSchema");
    expect(contracts).toHaveProperty("TAX_CALENDAR_IMPORT_COLUMNS");
    expect(contracts.TAX_CALENDAR_IMPORT_COLUMNS).toContain("verificado_en_imagen");
  });

  it("exporta DUE_DATE_FREQUENCIES y dueDateFrequencySchema (lista de vencimientos, D-R3-A)", () => {
    expect(contracts.DUE_DATE_FREQUENCIES).toEqual(["MONTHLY", "QUARTERLY", "ANNUAL", "ONCE"]);
    expect(contracts.dueDateFrequencySchema.safeParse("MENSUAL").success).toBe(false);
  });

  it("exporta el contrato del panel de trabajo (corte 4a): estados y consulta", () => {
    expect(contracts.TAX_PANEL_DJ_STATES).toContain("PRESENTADO");
    expect(contracts).toHaveProperty("taxPanelQuerySchema");
    expect(contracts.taxPanelQuerySchema.parse({}).limit).toBe(50);
  });
  it("exporta el contrato de la declaración jurada (corte 5a): importes no negativos, hasta 4 decimales y sin campos extra", () => {
    const body = {
      declarationDocumentId: "11111111-1111-4111-8111-111111111111",
      impuestoDeterminado: "1500.5000",
      saldoFavorTecnico: "0",
      saldoLibreDisponibilidad: "20.25",
      totalAPagar: "1500.50",
    };
    expect(contracts.taxFilingDeclarationBodySchema.safeParse(body).success).toBe(true);
    expect(contracts.taxFilingDeclarationBodySchema.safeParse({ ...body, totalAPagar: "-1" }).success).toBe(false);
    expect(contracts.taxFilingDeclarationBodySchema.safeParse({ ...body, totalAPagar: "1.00001" }).success).toBe(false);
    expect(contracts.taxFilingDeclarationBodySchema.safeParse({ ...body, extra: 1 }).success).toBe(false);
    expect(contracts.FILING_DECLARATION_DOCUMENT_CATEGORY).toBe("DECLARACION_JURADA");
  });
});
