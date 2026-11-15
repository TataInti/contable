import type { FastifyRequest } from "fastify";
import type { TaxPanelRow } from "@contable/contracts";
import { describe, expect, it } from "vitest";
import { assertCapability, requiredCapability } from "../auth/guard.js";
import {
  addDays,
  argentinaToday,
  buildGroups,
  buildOptions,
  buildRow,
  compressDigits,
  daysUntilDue,
  deriveDjState,
  endingGroupsFrom,
  periodLabel,
  pickFiling,
  pickLegajo,
  responsablesFor,
  sortPanelRows,
  type PanelFiling,
  type PanelObligation,
  type PanelWorkpaper,
} from "./tax-panel-service.js";

function obligation(overrides: Partial<PanelObligation> = {}): PanelObligation {
  return {
    obligationId: "ob-1",
    clientId: "cl-1",
    clientName: "Cliente sintético 4A uno",
    cuit: "20123456781",
    taxTypeId: "tt-iva",
    taxTypeName: "IVA",
    regimeId: "rg-ri",
    regimeName: "Responsable inscripto",
    jurisdictionId: "jr-nac",
    jurisdictionName: "Nación",
    periodId: "pd-oct",
    periodLabelRaw: null,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    dueDate: "2026-11-10",
    dueDateSource: "CALENDAR",
    calculatedDueDate: "2026-11-10",
    ...overrides,
  };
}

function row(
  overrides: Partial<PanelObligation> = {},
  responsables: TaxPanelRow["responsables"] = [],
): TaxPanelRow {
  return buildRow(obligation(overrides), null, undefined, "SIN_LEGAJO", responsables, "2026-11-15");
}

function workpaper(overrides: Partial<PanelWorkpaper> = {}): PanelWorkpaper {
  return {
    workpaperId: "wp-1",
    clientId: "cl-1",
    status: "IN_REVIEW",
    revision: 1,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    ...overrides,
  };
}

function filing(overrides: Partial<PanelFiling> = {}): PanelFiling {
  return {
    filingId: "tf-1",
    obligationId: "ob-1",
    status: "PENDING",
    filedAt: "2026-11-01",
    createdAt: "2026-11-01T10:00:00.000Z",
    hasReceipt: false,
    ...overrides,
  };
}

describe("fecha de referencia y días corridos (S4-3, zona UTC−3)", () => {
  it("toma el día de Argentina: a las 02:30 UTC todavía es el día anterior", () => {
    expect(argentinaToday(new Date("2026-11-15T02:30:00.000Z"))).toBe("2026-11-14");
    expect(argentinaToday(new Date("2026-11-15T03:00:00.000Z"))).toBe("2026-11-15");
  });

  it("cuenta días corridos: negativo si está vencida, cero el día del vencimiento, null sin fecha", () => {
    expect(daysUntilDue("2026-11-15", "2026-11-10")).toBe(-5);
    expect(daysUntilDue("2026-11-15", "2026-11-15")).toBe(0);
    expect(daysUntilDue("2026-11-15", "2026-11-20")).toBe(5);
    expect(daysUntilDue("2026-11-15", null)).toBeNull();
  });

  it("un vencimiento del día cambia de cuenta según la zona: en Argentina vence hoy; en UTC, ayer", () => {
    const now = new Date("2026-11-15T02:30:00.000Z");
    expect(daysUntilDue(argentinaToday(now), "2026-11-14")).toBe(0);
    expect(daysUntilDue("2026-11-15", "2026-11-14")).toBe(-1);
  });

  it("suma días cruzando fin de mes, fin de año y febrero bisiesto", () => {
    expect(addDays("2026-11-15", 30)).toBe("2026-12-15");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("etiqueta de período", () => {
  it("usa el nombre cargado; si no hay, «MM/AAAA» para un mes completo o el rango de fechas", () => {
    expect(periodLabel("Octubre 2026", "2026-10-01", "2026-10-31")).toBe("Octubre 2026");
    expect(periodLabel(null, "2026-10-01", "2026-10-31")).toBe("10/2026");
    expect(periodLabel("  ", "2026-10-01", "2026-10-31")).toBe("10/2026");
    expect(periodLabel(null, "2026-10-15", "2026-11-14")).toBe("15/10/2026 → 14/11/2026");
  });
});

describe("estado de DJ y legajo (plan §4.4)", () => {
  const none = {
    hasFiled: false,
    hasPending: false,
    hasFinalizedSettlement: false,
    legajoStatus: null,
  };

  it("cubre las combinaciones del plan: sin legajo, legajo en curso, DJ pendiente, sin acuse y presentado", () => {
    expect(deriveDjState(none)).toBe("SIN_LEGAJO");
    expect(deriveDjState({ ...none, legajoStatus: "COLLECTING_INPUTS" })).toBe("LEGAJO_EN_CURSO");
    expect(
      deriveDjState({ ...none, hasFinalizedSettlement: true, legajoStatus: "IN_REVIEW" }),
    ).toBe("DJ_PENDIENTE");
    expect(deriveDjState({ ...none, hasPending: true })).toBe("PRESENTACION_SIN_ACUSE");
    expect(deriveDjState({ ...none, hasFiled: true })).toBe("PRESENTADO");
  });

  it("una presentación FILED gana a un intento PENDING y a una liquidación finalizada", () => {
    expect(
      deriveDjState({ ...none, hasFiled: true, hasPending: true, hasFinalizedSettlement: true }),
    ).toBe("PRESENTADO");
  });

  it("un legajo cerrado sin liquidación presentada queda como DJ pendiente (S4-15)", () => {
    expect(deriveDjState({ ...none, legajoStatus: "FINALIZED" })).toBe("DJ_PENDIENTE");
  });
});

describe("legajo y presentación de la obligación", () => {
  it("prefiere el legajo vinculado con la revisión más alta", () => {
    const linked = [
      workpaper({ workpaperId: "wp-r1", revision: 1 }),
      workpaper({ workpaperId: "wp-r2", revision: 2, status: "CALCULATED" }),
    ];
    expect(pickLegajo(obligation(), linked, [])).toEqual({
      workpaperId: "wp-r2",
      status: "CALCULATED",
      revision: 2,
    });
  });

  it("sin vínculo, toma el legajo del cliente que cubre el cierre del período (S4-7)", () => {
    const cubre = workpaper({
      workpaperId: "wp-cubre",
      periodStart: "2026-09-01",
      periodEnd: "2026-10-31",
    });
    const ajeno = workpaper({
      workpaperId: "wp-otro",
      periodStart: "2026-11-01",
      periodEnd: "2026-11-30",
    });
    expect(pickLegajo(obligation(), [], [ajeno, cubre])?.workpaperId).toBe("wp-cubre");
  });

  it("sin legajo que cubra el período, devuelve null", () => {
    expect(
      pickLegajo(
        obligation(),
        [],
        [workpaper({ periodStart: "2026-11-01", periodEnd: "2026-11-30" })],
      ),
    ).toBeNull();
  });

  it("elige la presentación FILED más reciente; si no hay, la PENDING; si solo hay rechazadas, ninguna", () => {
    const viejo = filing({ filingId: "tf-old", status: "FILED", filedAt: "2026-10-20" });
    const nuevo = filing({ filingId: "tf-new", status: "FILED", filedAt: "2026-11-02" });
    const pendiente = filing({ filingId: "tf-pend", status: "PENDING", filedAt: "2026-11-05" });
    expect(pickFiling([viejo, pendiente, nuevo])?.filingId).toBe("tf-new");
    expect(pickFiling([pendiente])?.filingId).toBe("tf-pend");
    expect(pickFiling([filing({ status: "REJECTED" })])).toBeUndefined();
  });
});

describe("terminación, grupos y orden", () => {
  it("comprime las terminaciones en rangos y deduplica celdas equivalentes", () => {
    expect(compressDigits("0123")).toBe("0-3");
    expect(compressDigits("0159")).toBe("0-1, 5, 9");
    expect(endingGroupsFrom(["3210", "0123", "4569"])).toEqual([
      { key: "0123", label: "0-3" },
      { key: "4569", label: "4-6, 9" },
    ]);
  });

  it("agrupa por terminación con «Sin CUIT» al final y conteos que suman el total", () => {
    const rows = [
      row({ obligationId: "a", cuit: "20123456781" }),
      row({ obligationId: "b", cuit: "20123456785" }),
      row({ obligationId: "c", cuit: "20123456781" }),
      row({ obligationId: "d", cuit: "" }),
    ];
    const { groups, orderOf } = buildGroups(rows, "terminacion");
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ["Terminación 1", 2],
      ["Terminación 5", 1],
      ["Sin CUIT", 1],
    ]);
    expect(groups.reduce((total, g) => total + g.count, 0)).toBe(rows.length);
    expect(orderOf(rows[3] as TaxPanelRow)).toBe(2);
  });

  it("agrupa por responsable: «Vos» primero, luego los nombres y «Sin asignar» al final", () => {
    const self = { userId: "u-self", name: "Yo", isSelf: true };
    const other = { userId: "u-otro", name: "Ana", isSelf: false };
    const rows = [
      row({ obligationId: "a" }, [self, other]),
      row({ obligationId: "b" }, [other]),
      row({ obligationId: "c" }, []),
    ];
    expect(buildGroups(rows, "responsable").groups.map((g) => [g.label, g.count])).toEqual([
      ["Vos", 1],
      ["Ana", 1],
      ["Sin asignar", 1],
    ]);
  });

  it("ordena por vencimiento con las fechas sin vencimiento al final, en ambas direcciones", () => {
    const rows = [
      row({ obligationId: "sin", dueDate: null }),
      row({ obligationId: "tarde", dueDate: "2026-12-01" }),
      row({ obligationId: "pronto", dueDate: "2026-11-01" }),
    ];
    expect(sortPanelRows(rows, "vencimiento", "asc", null).map((r) => r.obligationId)).toEqual([
      "pronto",
      "tarde",
      "sin",
    ]);
    expect(sortPanelRows(rows, "vencimiento", "desc", null).map((r) => r.obligationId)).toEqual([
      "tarde",
      "pronto",
      "sin",
    ]);
  });

  it("con agrupación, el orden de grupo manda sobre el orden por columna", () => {
    const rows = [
      row({ obligationId: "x1", cuit: "20123456785", dueDate: "2026-11-01" }),
      row({ obligationId: "x2", cuit: "20123456781", dueDate: "2026-12-01" }),
    ];
    const { orderOf } = buildGroups(rows, "terminacion");
    expect(sortPanelRows(rows, "vencimiento", "asc", orderOf).map((r) => r.obligationId)).toEqual([
      "x2",
      "x1",
    ]);
  });
});

describe("responsables y opciones de filtro", () => {
  it("el usuario que consulta va primero; los nombres que la RLS oculta quedan en null", () => {
    const names = new Map([["u-self", "Yo"]]);
    expect(responsablesFor([{ userId: "u-otro" }, { userId: "u-self" }], names, "u-self")).toEqual([
      { userId: "u-self", name: "Yo", isSelf: true },
      { userId: "u-otro", name: null, isSelf: false },
    ]);
  });

  it("las opciones salen del conjunto filtrado: impuestos, períodos, responsables y grupos", () => {
    const rows = [
      row({ obligationId: "a", taxTypeId: "tt-iva", taxTypeName: "IVA", periodId: "pd-oct" }, [
        { userId: "u-self", name: "Yo", isSelf: true },
      ]),
      row({
        obligationId: "b",
        taxTypeId: "tt-iibb",
        taxTypeName: "IIBB",
        periodId: "pd-sep",
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
      }),
    ];
    const options = buildOptions(rows, [{ key: "0123", label: "0-3" }]);
    expect(options.taxTypes).toEqual([
      { id: "tt-iibb", name: "IIBB" },
      { id: "tt-iva", name: "IVA" },
    ]);
    expect(options.periods).toEqual([
      { id: "pd-oct", label: "10/2026" },
      { id: "pd-sep", label: "09/2026" },
    ]);
    expect(options.responsables).toEqual([{ userId: "u-self", name: "Yo" }]);
    expect(options.grupos).toEqual([{ key: "0123", label: "0-3" }]);
  });
});

describe("capacidad del panel: el guard no cambia", () => {
  it("la subruta de obligaciones hereda tax.settlements.read del prefijo /tax-worklist", () => {
    expect(requiredCapability("GET", "/api/v1/firms/f-1/portfolio/tax-worklist/obligations")).toBe(
      "tax.settlements.read",
    );
  });

  it("sin esa capacidad, el guard responde 403 CAPABILITY_REQUIRED (ningún rol interno carece de ella: prueba con capacidades simuladas)", () => {
    const req = { capabilities: new Set(["client.read"]) } as unknown as FastifyRequest;
    let caught: unknown;
    try {
      assertCapability(req, "tax.settlements.read");
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ statusCode: 403, code: "CAPABILITY_REQUIRED" });
  });
});
