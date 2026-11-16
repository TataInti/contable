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

  it("exporta los contratos de avisos propios (corte 3c)", () => {
    expect(contracts.DUE_ALERT_NOTIFICATION_TYPES).toEqual(["DUE_ALERT", "DUE_OVERDUE"]);
    expect(contracts).toHaveProperty("notificationListQuerySchema");
    expect(contracts).toHaveProperty("notificationItemSchema");
    expect(contracts).toHaveProperty("notificationListResponseSchema");
    expect(contracts).toHaveProperty("notificationUnreadCountResponseSchema");
    expect(contracts).toHaveProperty("notificationReadResponseSchema");
    expect(contracts).toHaveProperty("notificationArchiveResponseSchema");
  });
});
