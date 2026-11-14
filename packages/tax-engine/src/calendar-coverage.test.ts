import { describe, expect, it } from "vitest";
import { validateCalendarCoverage, type CalendarCoverageEntry } from "./calendar.js";

/**
 * Cobertura de terminaciones antes de publicar un calendario (corte 2a-i).
 * Los casos reales salen de los CSV verificados contra la imagen del calendario
 * nacional y provincial/municipal de 2026 (datos públicos de las autoridades).
 */

const IVA_ENERO: CalendarCoverageEntry = {
  conceptLabel: "IVA — DDJJ",
  regimeId: "reg-iva",
  groupingKind: "ENDING_DIGITS",
  referencePeriodStart: "2026-01-01",
  referencePeriodEnd: "2026-01-31",
  referenceLabel: "IVA enero 2026",
  dueDate: "2026-01-19",
};

function row(endingDigits: string, dueDate: string, extra: Partial<CalendarCoverageEntry> = {}): CalendarCoverageEntry {
  return { ...IVA_ENERO, endingDigits, dueDate, ...extra };
}

describe("validateCalendarCoverage: cobertura de terminaciones 0 a 9", () => {
  it("acepta una cobertura exacta sin faltantes ni repetidos", () => {
    const report = validateCalendarCoverage([
      row("0123", "2026-01-19"),
      row("456", "2026-01-20"),
      row("789", "2026-01-21"),
    ]);
    expect(report.canPublish).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it("nombra los dígitos que faltan y la fila del grupo", () => {
    const report = validateCalendarCoverage([row("01234567", "2026-01-19")]);
    expect(report.canPublish).toBe(false);
    expect(report.problems).toEqual([
      expect.objectContaining({
        field: "entries[0].endingDigits",
        severity: "ERROR",
        message: "IVA — DDJJ (IVA enero 2026): faltan los dígitos 8 y 9",
      }),
    ]);
  });

  it("usa el singular cuando falta un solo dígito", () => {
    const report = validateCalendarCoverage([row("012345678", "2026-01-19")]);
    expect(report.problems[0]?.message).toContain("falta el dígito 9");
  });

  it("indica el dígito repetido y las dos filas donde aparece", () => {
    const report = validateCalendarCoverage([row("0123", "2026-01-19"), row("3456789", "2026-01-20")]);
    expect(report.canPublish).toBe(false);
    expect(report.problems).toEqual([
      expect.objectContaining({
        field: "entries[1].endingDigits",
        message: "IVA — DDJJ (IVA enero 2026): el dígito 3 aparece en dos filas (entries[0] y entries[1])",
      }),
    ]);
  });

  it("separa las coberturas por período de referencia: meses distintos no compiten", () => {
    const febrero = row("0123456789", "2026-02-19", {
      referencePeriodStart: "2026-02-01",
      referencePeriodEnd: "2026-02-28",
      referenceLabel: "IVA febrero 2026",
    });
    const report = validateCalendarCoverage([row("0123456789", "2026-01-19"), febrero]);
    expect(report.problems).toEqual([]);
    expect(report.canPublish).toBe(true);
  });

  it("acepta una celda «todos» sola y rechaza mezclarla con terminaciones", () => {
    expect(
      validateCalendarCoverage([row("", "2026-01-19", { groupingKind: "ALL", endingDigits: null })]).canPublish,
    ).toBe(true);
    const mezcla = validateCalendarCoverage([
      row("", "2026-01-19", { groupingKind: "ALL", endingDigits: null }),
      row("0123456789", "2026-01-20"),
    ]);
    expect(mezcla.canPublish).toBe(false);
    expect(mezcla.problems[0]?.message).toContain("mezcla «todos» con terminaciones");
  });

  it("rechaza las zonas mientras están reservadas", () => {
    const report = validateCalendarCoverage([row("", "2026-01-19", { groupingKind: "ZONE", endingDigits: null })]);
    expect(report.canPublish).toBe(false);
    expect(report.problems[0]).toEqual(expect.objectContaining({ field: "entries[0].groupingKind" }));
  });
});

describe("validateCalendarCoverage: celdas, fechas y años", () => {
  it("bloquea la publicación con celdas PROPOSED o FLAGGED y lo dice", () => {
    const report = validateCalendarCoverage([
      row("0123", "2026-01-19", { reviewState: "PROPOSED" }),
      row("456", "2026-01-20", { reviewState: "REVIEWED" }),
      row("789", "2026-01-21", { reviewState: "FLAGGED" }),
    ]);
    expect(report.canPublish).toBe(false);
    expect(report.problems.map((p) => p.field)).toEqual(["entries[0].reviewState", "entries[2].reviewState"]);
    expect(report.problems[0]?.message).toContain("PROPOSED");
    expect(report.problems[1]?.message).toContain("FLAGGED");
  });

  it("rechaza una fecha de vencimiento inexistente", () => {
    const report = validateCalendarCoverage([row("0123456789", "2026-02-30")]);
    expect(report.problems).toEqual([
      expect.objectContaining({ field: "entries[0].dueDate", message: expect.stringContaining("no es válida") }),
    ]);
  });

  it("exige que el vencimiento caiga en el año del calendario", () => {
    const report = validateCalendarCoverage(
      [row("0123456789", "2027-03-10", { referencePeriodStart: "2026-02-01", referencePeriodEnd: "2026-02-28" })],
      { year: 2026 },
    );
    expect(report.canPublish).toBe(false);
    expect(report.problems[0]?.message).toContain("cae fuera del año del calendario (2026)");
  });

  it("admite el anticipo de diciembre que vence en enero del año del calendario", () => {
    const report = validateCalendarCoverage(
      [
        row("0123456789", "2026-01-19", {
          referencePeriodStart: "2025-12-01",
          referencePeriodEnd: "2025-12-31",
          referenceLabel: "Anticipo dic-25",
        }),
      ],
      { year: 2026 },
    );
    expect(report.problems).toEqual([]);
  });

  it("admite una DDJJ anual de 2026 que vence el 30/06/2027 (dato real de Tucumán)", () => {
    const report = validateCalendarCoverage(
      [
        row("0123456789", "2027-06-30", {
          referencePeriodStart: "2026-01-01",
          referencePeriodEnd: "2026-12-31",
          referenceLabel: "DDJJ 2026",
        }),
      ],
      { year: 2026 },
    );
    expect(report.problems).toEqual([]);
  });

  it("advierte, sin bloquear, por sábado, domingo o feriado sin ajuste", () => {
    const sabado = validateCalendarCoverage([row("0123456789", "2026-01-17")]);
    expect(sabado.canPublish).toBe(true);
    expect(sabado.problems).toEqual([
      expect.objectContaining({ field: "entries[0].dueDate", severity: "ADVERTENCIA" }),
    ]);
    expect(sabado.problems[0]?.message).toContain("sábado");

    const feriado = validateCalendarCoverage([row("0123456789", "2026-05-25")], { holidays: ["2026-05-25"] });
    expect(feriado.canPublish).toBe(true);
    expect(feriado.problems[0]?.message).toContain("feriado");
  });

  it("no advierte cuando el ajuste ya está informado", () => {
    const report = validateCalendarCoverage([row("0123456789", "2026-05-25", { adjustment: "HOLIDAY" })], {
      holidays: ["2026-05-25"],
    });
    expect(report.problems).toEqual([]);
  });

  it("rechaza un calendario sin celdas", () => {
    expect(validateCalendarCoverage([]).problems[0]).toEqual(expect.objectContaining({ field: "entries" }));
  });
});

describe("validateCalendarCoverage: casos verificados de los CSV de 2026", () => {
  it("IVA enero 2026 por terminación cubre 0 a 9 sin observaciones", () => {
    const report = validateCalendarCoverage(
      [
        row("01", "2026-01-19"),
        row("23", "2026-01-20"),
        row("45", "2026-01-21"),
        row("67", "2026-01-22"),
        row("89", "2026-01-23"),
      ],
      { year: 2026 },
    );
    expect(report.problems).toEqual([]);
    expect(report.canPublish).toBe(true);
  });

  it("Ingresos Brutos de Tucumán con el rótulo corrido: anticipo de enero vence en febrero", () => {
    const report = validateCalendarCoverage(
      [
        row("01", "2026-02-18", {
          conceptLabel: "Ingresos Brutos — anticipo mensual",
          regimeId: "reg-iibb-tuc",
          referenceLabel: "Anticipo Ene-26",
        }),
      ],
      { year: 2026 },
    );
    expect(report.canPublish).toBe(false);
    expect(report.problems[0]?.message).toBe(
      "Ingresos Brutos — anticipo mensual (Anticipo Ene-26): faltan los dígitos 2, 3, 4, 5, 6, 7, 8 y 9",
    );
  });

  it("T.E.M. municipal: la posición 12/2025 vence el 19/01/2026 en el calendario 2026", () => {
    const report = validateCalendarCoverage(
      [
        row("01", "2026-01-19", {
          conceptLabel: "T.E.M. — Tributo Económico Municipal",
          regimeId: "reg-tem",
          referencePeriodStart: "2025-12-01",
          referencePeriodEnd: "2025-12-31",
          referenceLabel: "Posición 12/2025",
        }),
      ],
      { year: 2026 },
    );
    expect(report.problems.map((p) => p.message)).toEqual([
      "T.E.M. — Tributo Económico Municipal (Posición 12/2025): faltan los dígitos 2, 3, 4, 5, 6, 7, 8 y 9",
    ]);
  });
});
