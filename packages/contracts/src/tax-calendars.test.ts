import { describe, expect, it } from "vitest";
import {
  importTaxCalendarEntriesSchema,
  isRealIsoDate,
  TAX_CALENDAR_IMPORT_COLUMNS,
  TAX_CALENDAR_IMPORT_MAX_BYTES,
  TAX_CALENDAR_IMPORT_MAX_ROWS,
  TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS,
} from "./tax-calendars.js";

describe("calendarios: importación desde CSV (contratos, corte 2b-1)", () => {
  it("acepta el cuerpo con csv y dryRun en true o false", () => {
    expect(
      importTaxCalendarEntriesSchema.safeParse({ csv: "concepto\n", dryRun: true }).success,
    ).toBe(true);
    expect(
      importTaxCalendarEntriesSchema.safeParse({ csv: "concepto\n", dryRun: false }).success,
    ).toBe(true);
  });

  it("exige dryRun y dice qué elegir; no acepta campos de más", () => {
    const sinPrueba = importTaxCalendarEntriesSchema.safeParse({ csv: "x" });
    expect(sinPrueba.success).toBe(false);
    expect(sinPrueba.error?.issues[0]?.message).toContain("dryRun");
    expect(importTaxCalendarEntriesSchema.safeParse({ csv: "x", dryRun: "si" }).success).toBe(
      false,
    );
    expect(
      importTaxCalendarEntriesSchema.safeParse({ csv: "x", dryRun: true, taxTypeId: "x" }).success,
    ).toBe(false);
  });

  it("exige el contenido del archivo como texto", () => {
    const sinArchivo = importTaxCalendarEntriesSchema.safeParse({ dryRun: true });
    expect(sinArchivo.success).toBe(false);
    expect(sinArchivo.error?.issues[0]?.message).toBe("Falta el contenido del archivo (csv)");
  });

  it("fija las 11 columnas del formato verificado y las 5 obligatorias", () => {
    expect(TAX_CALENDAR_IMPORT_COLUMNS).toHaveLength(11);
    expect(TAX_CALENDAR_IMPORT_COLUMNS).toEqual(
      expect.arrayContaining([
        "concepto",
        "periodo_referencia",
        "criterio_agrupacion",
        "digitos",
        "fecha_completa",
      ]),
    );
    expect(TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS).toEqual([
      "concepto",
      "criterio_agrupacion",
      "digitos",
      "fecha_completa",
      "periodo_referencia",
    ]);
    for (const columna of TAX_CALENDAR_IMPORT_REQUIRED_COLUMNS) {
      expect(TAX_CALENDAR_IMPORT_COLUMNS).toContain(columna);
    }
  });

  it("fija los topes: 1 MB de texto y 2.000 filas", () => {
    expect(TAX_CALENDAR_IMPORT_MAX_BYTES).toBe(1048576);
    expect(TAX_CALENDAR_IMPORT_MAX_ROWS).toBe(2000);
  });

  it("distingue una fecha real de una imposible", () => {
    expect(isRealIsoDate("2026-02-28")).toBe(true);
    expect(isRealIsoDate("2026-02-30")).toBe(false);
    expect(isRealIsoDate("2028-02-29")).toBe(true);
    expect(isRealIsoDate("2026-2-3")).toBe(false);
  });
});
