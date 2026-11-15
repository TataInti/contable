import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api";
import {
  adjustmentLabel,
  calendarIssues,
  cellIssues,
  cellPayload,
  digitsLabel,
  digitsOf,
  emptyCalendarForm,
  emptyCellForm,
  filtersFromParams,
  groupingLabel,
  paramsWithFilters,
  periodLabel,
  problemTarget,
  reviewStatus,
  scopeQuery,
  serverIssues,
  sortedDigits,
  statusLabel,
  NO_CALENDAR_FILTERS,
  type CalendarEntryRow,
} from "./calendariosFiscales";

const AUTH = "a0000000-0000-4000-8000-000000000001";
const JUR = "b0000000-0000-4000-8000-000000000001";

function entry(overrides: Partial<CalendarEntryRow>): CalendarEntryRow {
  return {
    id: "f0000000-0000-4000-8000-000000000001",
    conceptLabel: "Concepto sintético",
    taxTypeId: null,
    regimeId: null,
    groupingKind: "ENDING_DIGITS",
    endingDigits: "0123",
    zoneCode: null,
    referencePeriodStart: "2026-01-01T00:00:00.000Z",
    referencePeriodEnd: "2026-01-31T00:00:00.000Z",
    referenceLabel: "Ene-26",
    dueDate: "2026-02-18T00:00:00.000Z",
    dueDateRaw: null,
    adjustment: "NONE",
    noteRef: null,
    noteText: null,
    reviewState: "REVIEWED",
    sortOrder: 0,
    ...overrides,
  };
}

describe("dígitos de terminación", () => {
  it("escribe los grupos de CUIT como rangos legibles", () => {
    expect(digitsLabel(["0", "1", "2", "3"])).toBe("0 a 3");
    expect(digitsLabel(["4", "5", "6"])).toBe("4 a 6");
    expect(digitsLabel(["7", "8", "9"])).toBe("7 a 9");
    expect(digitsLabel(["0", "2"])).toBe("0 y 2");
    expect(digitsLabel(["0", "1", "3"])).toBe("0 a 1 y 3");
    expect(digitsLabel(["5"])).toBe("5");
    expect(digitsLabel([])).toBe("");
  });

  it("ordena y deduplica la selección y la lee desde la celda", () => {
    expect(sortedDigits(["3", "0", "3"])).toBe("03");
    expect(sortedDigits([])).toBe("");
    expect(digitsOf("0123")).toEqual(["0", "1", "2", "3"]);
    expect(digitsOf(null)).toEqual([]);
  });

  it("muestra la agrupación de la celda: terminaciones o todos", () => {
    expect(groupingLabel(entry({ endingDigits: "456" }))).toBe("4 a 6");
    expect(groupingLabel(entry({ groupingKind: "ALL", endingDigits: null }))).toBe("Todos");
    expect(groupingLabel(entry({ endingDigits: null }))).toBe("—");
  });
});

describe("validación de celdas con los esquemas de contracts", () => {
  it("pide las terminaciones cuando la agrupación es por terminación", () => {
    const issues = cellIssues({ ...emptyCellForm(), conceptLabel: "IVA", dueDate: "2026-02-18" });
    expect(issues.endingDigits).toBe("Indicá las terminaciones de la celda (por ejemplo 0123)");
  });

  it("rechaza una fecha que no existe y acepta una real", () => {
    const base = { ...emptyCellForm(), conceptLabel: "IVA", digits: ["0", "1"] };
    expect(cellIssues({ ...base, dueDate: "2026-02-30" }).dueDate).toBe(
      "La fecha debe ser una fecha real con formato AAAA-MM-DD",
    );
    expect(cellIssues({ ...base, dueDate: "2026-02-27" })).toEqual({});
  });

  it("no exige terminaciones para «todos» y descarta las que quedaron cargadas", () => {
    const form = { ...emptyCellForm(), conceptLabel: "CSI", groupingKind: "ALL" as const, digits: ["0"], dueDate: "2026-03-10" };
    expect(cellPayload(form).endingDigits).toBeNull();
    expect(cellIssues(form)).toEqual({});
  });

  it("valida el concepto y envía los períodos vacíos como nulos", () => {
    const issues = cellIssues({ ...emptyCellForm(), conceptLabel: "   ", digits: ["0"], dueDate: "2026-02-18" });
    expect(issues.conceptLabel).toBe("Falta el concepto de la celda");
    const payload = cellPayload({ ...emptyCellForm(), conceptLabel: " IVA ", digits: ["0"], dueDate: "2026-02-18" });
    expect(payload.conceptLabel).toBe("IVA");
    expect(payload.referencePeriodStart).toBeNull();
    expect(payload.referenceLabel).toBeNull();
  });
});

describe("alta de calendario", () => {
  it("valida el año por rango y por tipo, con el mensaje del esquema", () => {
    const base = { ...emptyCalendarForm(), taxAuthorityId: AUTH, jurisdictionId: JUR, title: "Calendario sintético" };
    expect(calendarIssues({ ...base, year: "1999" }).year).toBe("El año debe estar entre 2000 y 2100");
    expect(calendarIssues({ ...base, year: "abc" }).year).toBe("El año debe ser un número entero");
    expect(calendarIssues({ ...base, year: "" }).year).toBe("El año es obligatorio");
    expect(calendarIssues({ ...base, year: "2026" })).toEqual({});
  });

  it("pide el organismo y el título corto", () => {
    const issues = calendarIssues({ ...emptyCalendarForm(), year: "2026", title: "ab" });
    expect(issues.taxAuthorityId).toBe("Indicá el organismo");
    expect(issues.title).toBe("El título debe tener al menos 3 caracteres");
  });
});

describe("filtros en la dirección", () => {
  it("lee los filtros válidos e ignora los inválidos", () => {
    const params = new URLSearchParams(`anio=2026&organismo=${AUTH}&jurisdiccion=no-es-uuid&estado=publicado,foo,oculto`);
    const filters = filtersFromParams(params);
    expect(filters.year).toBe(2026);
    expect(filters.taxAuthorityId).toBe(AUTH);
    expect(filters.jurisdictionId).toBeNull();
    expect(filters.statuses).toEqual(["publicado", "oculto"]);
    expect(filtersFromParams(new URLSearchParams("anio=1999")).year).toBeNull();
  });

  it("escribe la dirección conservando el calendario abierto y limpia al quitar", () => {
    const current = new URLSearchParams("calendario=c1&anio=2025");
    const written = paramsWithFilters(current, { ...NO_CALENDAR_FILTERS, year: 2026, statuses: ["borrador"] });
    expect(written.get("calendario")).toBe("c1");
    expect(written.get("anio")).toBe("2026");
    expect(written.get("estado")).toBe("borrador");
    const cleared = paramsWithFilters(written, NO_CALENDAR_FILTERS);
    expect(cleared.has("anio")).toBe(false);
    expect(cleared.has("estado")).toBe(false);
    expect(cleared.get("calendario")).toBe("c1");
  });

  it("envía al servidor solo año, organismo y jurisdicción", () => {
    expect(scopeQuery({ year: 2026, taxAuthorityId: AUTH, jurisdictionId: null })).toBe(
      `year=2026&taxAuthorityId=${AUTH}`,
    );
    expect(scopeQuery({ year: null, taxAuthorityId: null, jurisdictionId: null })).toBe("");
  });
});

describe("informe de validación y errores", () => {
  it("apunta cada problema a su celda por índice", () => {
    const entries = [entry({ id: "e-0" }), entry({ id: "e-1" })];
    expect(problemTarget({ field: "entries[1].endingDigits", message: "x", severity: "ERROR" }, entries)).toEqual({
      entryId: "e-1",
      field: "endingDigits",
    });
    expect(problemTarget({ field: "entries", message: "x", severity: "ERROR" }, entries)).toBeNull();
    expect(problemTarget({ field: "entries[9].dueDate", message: "x", severity: "ERROR" }, entries)).toBeNull();
  });

  it("lee los dos formatos de error de la API", () => {
    const validation = new ApiError("VALIDATION_ERROR", "Revisá los datos", 400, null, {
      code: "VALIDATION_ERROR",
      message: "Revisá los datos",
      details: [{ path: ["year"], message: "El año debe estar entre 2000 y 2100" }],
    });
    expect(serverIssues(validation).fields.year).toBe("El año debe estar entre 2000 y 2100");

    const domain = new ApiError("CALENDAR_REFERENCE_NOT_FOUND", "El tipo no existe", 422, null, {
      code: "CALENDAR_REFERENCE_NOT_FOUND",
      message: "El tipo no existe",
      details: { path: ["taxTypeId"] },
    });
    expect(serverIssues(domain)).toEqual({ fields: { taxTypeId: "El tipo no existe" }, message: "El tipo no existe" });

    const notDomain = serverIssues(new Error("red caída"));
    expect(notDomain.fields).toEqual({});
    expect(notDomain.message).toBe("No se pudo completar la solicitud. Reintentá en unos minutos.");
  });

  it("traduce los estados y los ajustes a castellano", () => {
    expect(statusLabel("DRAFT")).toBe("Borrador");
    expect(statusLabel("PUBLISHED")).toBe("Publicado");
    expect(statusLabel("HIDDEN")).toBe("Oculto");
    expect(adjustmentLabel("WEEKEND")).toBe("Fin de semana");
    expect(reviewStatus("FLAGGED").label).toBe("Dudosa");
    expect(reviewStatus(null).label).toBe("—");
  });

  it("muestra el período con su rótulo y sus fechas", () => {
    expect(periodLabel(entry({ referenceLabel: "Anticipo Ene-26" }))).toBe(
      "Anticipo Ene-26 (2026-01-01 a 2026-01-31)",
    );
    expect(periodLabel(entry({ referenceLabel: null, referencePeriodStart: null, referencePeriodEnd: null }))).toBe("—");
  });
});
