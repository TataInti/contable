import { describe, expect, it } from "vitest";
import { resolveDueDate, type DueDateResolutionInput, type ResolvableDueDateCalendar } from "./calendar.js";

/** Resolución del vencimiento de una obligación (corte 2a-i, precedencia D-C2). */

const AUTHORITY = { id: "auth-afip", name: "Administración Federal de Ingresos Públicos" };
const REGIME_IVA = {
  id: "reg-iva",
  name: "IVA Responsable Inscripto",
  taxTypeId: "tt-iva",
  jurisdictionId: "jur-nacion",
  authorityId: AUTHORITY.id,
  authorityName: AUTHORITY.name,
};
const PERIOD_ENERO = { startDate: "2026-01-01", endDate: "2026-01-31" };
const CUIT_TERMINADO_EN = (digit: string) => `20-1234567${digit}-${digit}`;

type Row = {
  id: string;
  digits?: string;
  all?: boolean;
  dueDate: string;
  regimeId?: string | null;
  taxTypeId?: string | null;
  start?: string | null;
  end?: string | null;
};

function calendar(
  id: string,
  rows: Row[],
  extra: Partial<Pick<ResolvableDueDateCalendar, "status" | "year" | "taxAuthorityId" | "jurisdictionId">> = {},
): ResolvableDueDateCalendar {
  return {
    id,
    status: extra.status ?? "PUBLISHED",
    taxAuthorityId: extra.taxAuthorityId ?? AUTHORITY.id,
    jurisdictionId: extra.jurisdictionId ?? "jur-nacion",
    year: extra.year ?? 2026,
    entries: rows.map((row) => ({
      id: row.id,
      regimeId: row.regimeId === undefined ? "reg-iva" : row.regimeId,
      taxTypeId: row.taxTypeId === undefined ? "tt-iva" : row.taxTypeId,
      groupingKind: row.all ? "ALL" : "ENDING_DIGITS",
      endingDigits: row.all ? null : (row.digits ?? null),
      referencePeriodStart: row.start === undefined ? PERIOD_ENERO.startDate : row.start,
      referencePeriodEnd: row.end === undefined ? PERIOD_ENERO.endDate : row.end,
      dueDate: row.dueDate,
    })),
  };
}

function input(
  cuit: string,
  calendars: ResolvableDueDateCalendar[],
  extra: Partial<Omit<DueDateResolutionInput, "cuit" | "calendars" | "regime">> = {},
): DueDateResolutionInput {
  return {
    cuit,
    regime: REGIME_IVA,
    period: extra.period ?? PERIOD_ENERO,
    calendars,
    ...(extra.override !== undefined ? { override: extra.override } : {}),
  };
}

const IVA_ENERO_PUBLICADO = calendar("cal-iva-2026", [
  { id: "e01", digits: "01", dueDate: "2026-01-19" },
  { id: "e23", digits: "23", dueDate: "2026-01-20" },
  { id: "e45", digits: "45", dueDate: "2026-01-21" },
  { id: "e67", digits: "67", dueDate: "2026-01-22" },
  { id: "e89", digits: "89", dueDate: "2026-01-23" },
]);

describe("resolveDueDate: terminación de CUIT y grupos", () => {
  it("resuelve por el último dígito del CUIT y devuelve celda y calendario", () => {
    const resolved = resolveDueDate(input(CUIT_TERMINADO_EN("5"), [IVA_ENERO_PUBLICADO]));
    expect(resolved).toEqual({
      source: "CALENDAR",
      dueDate: "2026-01-21",
      calendarId: "cal-iva-2026",
      entryId: "e45",
    });
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("9"), [IVA_ENERO_PUBLICADO]))).toMatchObject({
      source: "CALENDAR",
      dueDate: "2026-01-23",
      entryId: "e89",
    });
  });

  const grupos: Array<{ nombre: string; grupos: string[] }> = [
    { nombre: "0-3, 4-6, 7-9", grupos: ["0123", "456", "789"] },
    { nombre: "0-2, 3-5, 6-7, 8-9", grupos: ["012", "345", "67", "89"] },
    { nombre: "cinco grupos de dos dígitos", grupos: ["01", "23", "45", "67", "89"] },
    { nombre: "0-9 en una sola celda", grupos: ["0123456789"] },
  ];
  for (const { nombre, grupos: sets } of grupos) {
    it(`resuelve cada terminación con los grupos ${nombre}`, () => {
      const rows: Row[] = sets.map((digits, index) => ({
        id: `g${index}`,
        digits,
        dueDate: `2026-01-${String(19 + index).padStart(2, "0")}`,
      }));
      const cal = [calendar("cal-grupos", rows)];
      for (let digit = 0; digit <= 9; digit += 1) {
        const expectedIndex = sets.findIndex((set) => set.includes(String(digit)));
        const resolved = resolveDueDate(input(CUIT_TERMINADO_EN(String(digit)), cal));
        expect(resolved).toMatchObject({ source: "CALENDAR", entryId: `g${expectedIndex}` });
      }
    });
  }

  it("una celda «todos» aplica a cualquier terminación", () => {
    const cal = [calendar("cal-todos", [{ id: "todos", all: true, dueDate: "2026-01-30" }])];
    for (const digit of ["0", "5", "9"]) {
      expect(resolveDueDate(input(CUIT_TERMINADO_EN(digit), cal))).toMatchObject({
        source: "CALENDAR",
        dueDate: "2026-01-30",
      });
    }
  });

  it("una celda de zona no resuelve en este corte", () => {
    const cal = [
      calendar("cal-zona", [{ id: "zona", digits: "0123456789", dueDate: "2026-01-19" }]),
    ];
    cal[0]!.entries = cal[0]!.entries.map((entry) => ({ ...entry, groupingKind: "ZONE", endingDigits: null }));
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("1"), cal))).toMatchObject({
      source: null,
      reason: "SIN_CELDA",
    });
  });
});

describe("resolveDueDate: precedencia y avisos (P1)", () => {
  it("el valor manual gana sobre el calendario publicado (D-C2)", () => {
    const resolved = resolveDueDate(
      input(CUIT_TERMINADO_EN("5"), [IVA_ENERO_PUBLICADO], {
        override: { dueDate: "2026-01-30", reason: "Prórroga informada por el organismo" },
      }),
    );
    expect(resolved).toEqual({ source: "MANUAL", dueDate: "2026-01-30", calendarId: null, entryId: null });
  });

  it("sin calendario publicado devuelve la falta con el mensaje de P1", () => {
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("5"), []))).toEqual({
      source: null,
      dueDate: null,
      calendarId: null,
      entryId: null,
      reason: "SIN_CALENDARIO",
      message: "Falta cargar el calendario de Administración Federal de Ingresos Públicos para 2026",
    });
  });

  it("borradores y calendarios ocultos no cuentan para la resolución", () => {
    const borrador = calendar("cal-borrador", [{ id: "x", digits: "0123456789", dueDate: "2026-01-19" }], {
      status: "DRAFT",
    });
    const oculto = calendar("cal-oculto", [{ id: "y", digits: "0123456789", dueDate: "2026-01-19" }], {
      status: "HIDDEN",
    });
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("5"), [borrador, oculto]))).toMatchObject({
      source: null,
      reason: "SIN_CALENDARIO",
    });
  });

  it("un calendario de otro organismo o jurisdicción no aplica", () => {
    const otroOrganismo = calendar("cal-otro", [{ id: "z", digits: "0123456789", dueDate: "2026-01-19" }], {
      taxAuthorityId: "auth-otra",
    });
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("5"), [otroOrganismo]))).toMatchObject({
      reason: "SIN_CALENDARIO",
    });
  });

  it("si el calendario existe pero no tiene la celda, lo dice con el período y la terminación", () => {
    const soloFebrero = calendar("cal-feb", [
      { id: "f", digits: "0123456789", dueDate: "2026-02-19", start: "2026-02-01", end: "2026-02-28" },
    ]);
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("5"), [soloFebrero]))).toEqual({
      source: null,
      dueDate: null,
      calendarId: null,
      entryId: null,
      reason: "SIN_CELDA",
      message:
        "El calendario de Administración Federal de Ingresos Públicos para 2026 no tiene una celda para IVA Responsable Inscripto, el período 2026-01 y la terminación 5",
    });
  });

  it("más de una celda que coincide es un error interno", () => {
    const duplicado = calendar("cal-dup", [
      { id: "d1", digits: "0123456789", dueDate: "2026-01-19" },
      { id: "d2", digits: "5", dueDate: "2026-01-20" },
    ]);
    expect(() => resolveDueDate(input(CUIT_TERMINADO_EN("5"), [duplicado]))).toThrow(/CALENDAR_AMBIGUOUS/);
  });

  it("un CUIT sin dígitos no se puede resolver", () => {
    expect(() => resolveDueDate(input("", [IVA_ENERO_PUBLICADO]))).toThrow(/CUIT/);
  });
});

describe("resolveDueDate: régimen, tipo de impuesto y períodos de otro año", () => {
  it("una celda sin régimen se vincula por tipo de impuesto dentro de la jurisdicción", () => {
    const porTipo = calendar("cal-tipo", [
      { id: "t5", digits: "5", dueDate: "2026-01-21", regimeId: null, taxTypeId: "tt-iva" },
    ]);
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("5"), [porTipo]))).toMatchObject({
      source: "CALENDAR",
      entryId: "t5",
    });
  });

  it("una celda de otro régimen no aplica a este", () => {
    const otroRegimen = calendar("cal-otro-regimen", [
      { id: "r5", digits: "5", dueDate: "2026-01-21", regimeId: "reg-otro" },
    ]);
    expect(resolveDueDate(input(CUIT_TERMINADO_EN("5"), [otroRegimen]))).toMatchObject({
      source: null,
      reason: "SIN_CELDA",
    });
  });

  it("el anticipo de diciembre (T.E.M., posición 12/2025) se resuelve en el calendario 2026", () => {
    const tem2026 = calendar(
      "cal-tem-2026",
      [{ id: "tem-dic", digits: "01", dueDate: "2026-01-19", start: "2025-12-01", end: "2025-12-31" }],
      { year: 2026 },
    );
    expect(
      resolveDueDate(
        input(CUIT_TERMINADO_EN("1"), [tem2026], {
          period: { startDate: "2025-12-01", endDate: "2025-12-31" },
        }),
      ),
    ).toMatchObject({ source: "CALENDAR", dueDate: "2026-01-19", entryId: "tem-dic" });
  });

  it("Ingresos Brutos de Tucumán con el rótulo corrido: el anticipo de enero vence en febrero", () => {
    const iibb = calendar(
      "cal-iibb",
      [{ id: "iibb-ene", digits: "01", dueDate: "2026-02-18", regimeId: "reg-iibb" }],
      { year: 2026 },
    );
    const resolved = resolveDueDate({
      cuit: CUIT_TERMINADO_EN("0"),
      regime: { ...REGIME_IVA, id: "reg-iibb", name: "IIBB local Tucumán", taxTypeId: "tt-iibb" },
      period: PERIOD_ENERO,
      calendars: [iibb],
    });
    expect(resolved).toMatchObject({ source: "CALENDAR", dueDate: "2026-02-18", entryId: "iibb-ene" });
  });
});
