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
  it("exporta el libro de saldos de la DJ: orígenes, estados por saldo y el interruptor de arrastre (corte 6a)", () => {
    expect(contracts).toHaveProperty("CREDIT_LOT_ORIGINS");
    expect(contracts).toHaveProperty("DECLARATION_CREDIT_LOT_STATUSES");
    expect(contracts).toHaveProperty("creditLotCarryForwardSchema");
    expect(contracts.CREDIT_LOT_ORIGINS).toEqual(["CIERRE", "DJ", "MANUAL"]);
    expect(contracts.creditLotCarryForwardSchema.safeParse(false).success).toBe(true);
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

  it("exporta la lista de matrículas de un miembro (ficha del profesional, A4-2a)", () => {
    expect(contracts).toHaveProperty("professionalCredentialListResponseSchema");
    const item = {
      id: "11111111-1111-4111-8111-111111111111",
      firmId: "11111111-1111-4111-8111-111111111111",
      userId: "11111111-1111-4111-8111-111111111111",
      jurisdictionId: "11111111-1111-4111-8111-111111111111",
      authorityId: "11111111-1111-4111-8111-111111111111",
      registrationNumber: "DEMO-100",
      status: "ACTIVE",
      validFrom: "2025-01-01",
      validTo: null,
    };
    const { professionalCredentialListResponseSchema } = contracts;
    expect(professionalCredentialListResponseSchema.safeParse({ data: [item] }).success).toBe(true);
    expect(professionalCredentialListResponseSchema.safeParse({ data: [] }).success).toBe(true);
    const conFechaHora = { ...item, validFrom: "2025-01-01T00:00:00.000Z" };
    expect(
      professionalCredentialListResponseSchema.safeParse({ data: [conFechaHora] }).success,
    ).toBe(false);
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
    expect(
      contracts.taxFilingDeclarationBodySchema.safeParse({ ...body, totalAPagar: "-1" }).success,
    ).toBe(false);
    expect(
      contracts.taxFilingDeclarationBodySchema.safeParse({ ...body, totalAPagar: "1.00001" })
        .success,
    ).toBe(false);
    expect(contracts.taxFilingDeclarationBodySchema.safeParse({ ...body, extra: 1 }).success).toBe(
      false,
    );
    expect(contracts.FILING_DECLARATION_DOCUMENT_CATEGORY).toBe("DECLARACION_JURADA");
  });

  it("exporta el detalle de saldos a favor de la DJ (D13-4 a): tope de 100 ítems y lectura", () => {
    expect(contracts.FILING_DECLARATION_CREDIT_DETAIL_MAX_ITEMS).toBe(100);
    expect(contracts).toHaveProperty("taxFilingCreditDetailSchema");
    expect(contracts).toHaveProperty("taxFilingCreditDetailReadSchema");
  });

  it("exporta el contrato del saldo de caja fiscal (corte 8a): estados, consulta y respuesta", () => {
    expect(contracts.cajaFiscalEstado.options).toEqual(["COMPLETO", "PARCIAL", "SIN_DATOS"]);
    expect(contracts).toHaveProperty("cajaFiscalQuerySchema");
    expect(contracts).toHaveProperty("cajaFiscalResponseSchema");
    expect(contracts.cajaFiscalQuerySchema.safeParse({}).success).toBe(false);
    expect(contracts.cajaFiscalQuerySchema.safeParse({ periodId: "no-es-uuid" }).success).toBe(
      false,
    );
  });
});
