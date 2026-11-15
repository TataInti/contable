import type { Prisma, TaxObligationStatus } from "@prisma/client";
import {
  cuitEnding,
  TAX_PANEL_DEFAULT_LOOKBACK_DAYS,
  TAX_PANEL_DJ_STATES,
  type TaxPanelDjState,
  type TaxPanelDueDateSource,
  type TaxPanelFilingStatus,
  type TaxPanelGroup,
  type TaxPanelGrouping,
  type TaxPanelLegajo,
  type TaxPanelOptions,
  type TaxPanelQuery,
  type TaxPanelResponse,
  type TaxPanelResponsable,
  type TaxPanelRow,
  type TaxPanelSortDir,
  type TaxPanelSortKey,
} from "@contable/contracts";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";

/**
 * Panel de trabajo global por usuario (corte 4a): derivación de estados y listado
 * de obligaciones del estudio (plan §4.2 a §4.7). Sin migración ni escritura.
 * Toda la consulta corre dentro de withTenantContext: la RLS por asignación limita
 * las filas y el modo «me» sale de la sesión.
 */

/** Tope de obligaciones que el panel carga para derivar estados (supuesto S4-13). */
export const TAX_PANEL_CANDIDATE_CAP = 5000;
const CAP_LABEL = "5.000";
/** Vista inicial: obligaciones no presentadas (S4-5). Con un estado explícito solo se excluye NOT_APPLICABLE. */
const PRESENTED_OR_CLOSED: TaxObligationStatus[] = [
  "FILED",
  "PARTIALLY_PAID",
  "PAID",
  "NOT_APPLICABLE",
];
const NOT_APPLICABLE_ONLY: TaxObligationStatus[] = ["NOT_APPLICABLE"];
const DAY_MS = 86_400_000;
const ARGENTINA_OFFSET_MS = 3 * 60 * 60 * 1000;
const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

export class TaxPanelError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | undefined;

  constructor(code: string, message: string, status: number, field?: string) {
    super(message);
    this.name = "TaxPanelError";
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

/** Obligación tal como la lee el panel (sin el estado de la obligación, que no se muestra). */
export interface PanelObligation {
  obligationId: string;
  clientId: string;
  clientName: string;
  cuit: string;
  taxTypeId: string;
  taxTypeName: string;
  regimeId: string;
  regimeName: string;
  jurisdictionId: string;
  jurisdictionName: string;
  periodId: string;
  periodLabelRaw: string | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  dueDateSource: TaxPanelDueDateSource;
  calculatedDueDate: string | null;
}

export interface PanelWorkpaper {
  workpaperId: string;
  clientId: string;
  status: string;
  revision: number;
  periodStart: string;
  periodEnd: string;
}

export interface PanelWorkpaperLink {
  obligationId: string;
  workpaper: PanelWorkpaper;
}

/** Presentación (TaxFiling) ya reducida a los campos que usa el panel. */
export interface PanelFiling {
  filingId: string;
  obligationId: string;
  status: string;
  filedAt: string;
  createdAt: string;
  hasReceipt: boolean;
}

interface PanelBatch {
  links: PanelWorkpaperLink[];
  workpapers: PanelWorkpaper[];
  filings: PanelFiling[];
  finalized: Set<string>;
  assignments: { clientId: string; userId: string }[];
  names: Map<string, string>;
}

const EMPTY_BATCH: PanelBatch = {
  links: [],
  workpapers: [],
  filings: [],
  finalized: new Set<string>(),
  assignments: [],
  names: new Map<string, string>(),
};

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseDay(day: string): { year: number; month: number; dayOfMonth: number } {
  const [year, month, dayOfMonth] = day.split("-").map(Number) as [number, number, number];
  return { year, month, dayOfMonth };
}

function dmy(day: string): string {
  const parts = parseDay(day);
  return `${pad2(parts.dayOfMonth)}/${pad2(parts.month)}/${parts.year}`;
}

function settlementKey(clientId: string, regimeId: string, periodId: string): string {
  return `${clientId}|${regimeId}|${periodId}`;
}

function nameOrder(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return collator.compare(a, b);
}

/** Día calendario UTC de un DateTime guardado a medianoche UTC (fechas de período, vencimiento, presentación). */
export function calendarDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Fecha de referencia del panel: día calendario en Argentina (UTC−3, sin cambio horario). */
export function argentinaToday(now: Date): string {
  return new Date(now.getTime() - ARGENTINA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Suma días corridos a una fecha AAAA-MM-DD. */
export function addDays(day: string, days: number): string {
  return new Date(utcDay(day).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Días corridos entre dos fechas AAAA-MM-DD (hasta − desde). No cuenta días hábiles (S4-3). */
export function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((utcDay(toDay).getTime() - utcDay(fromDay).getTime()) / DAY_MS);
}

/** Días corridos hasta el vencimiento: negativo = vencida; null si no tiene fecha. */
export function daysUntilDue(asOf: string, dueDate: string | null): number | null {
  return dueDate === null ? null : daysBetween(asOf, dueDate);
}

/** Etiqueta del período: el nombre cargado; si no hay, «MM/AAAA» para un mes completo o «dd/mm/aaaa → dd/mm/aaaa». */
export function periodLabel(label: string | null, periodStart: string, periodEnd: string): string {
  const trimmed = label?.trim();
  if (trimmed) return trimmed;
  const start = parseDay(periodStart);
  const end = parseDay(periodEnd);
  const lastDayOfMonth = new Date(Date.UTC(end.year, end.month, 0)).getUTCDate();
  if (
    start.year === end.year &&
    start.month === end.month &&
    start.dayOfMonth === 1 &&
    end.dayOfMonth === lastDayOfMonth
  ) {
    return `${pad2(start.month)}/${start.year}`;
  }
  return `${dmy(periodStart)} → ${dmy(periodEnd)}`;
}

/**
 * Legajo de la obligación: el vinculado (WorkpaperSettlement, revisión más alta
 * no SUPERSEDED); si no hay vínculo, el del cliente que cubre el cierre del período.
 */
export function pickLegajo(
  obligation: PanelObligation,
  linked: PanelWorkpaper[],
  clientWorkpapers: PanelWorkpaper[],
): TaxPanelLegajo | null {
  const covering = clientWorkpapers.filter(
    (w) => w.periodStart <= obligation.periodEnd && w.periodEnd >= obligation.periodEnd,
  );
  const pool = linked.length > 0 ? linked : covering;
  const best = [...pool].sort(
    (a, b) => b.revision - a.revision || cmp(a.workpaperId, b.workpaperId),
  )[0];
  return best === undefined
    ? null
    : { workpaperId: best.workpaperId, status: best.status, revision: best.revision };
}

/** Presentación: la FILED más reciente; si no hay, la PENDING más reciente (intento sin acuse). */
export function pickFiling(filings: PanelFiling[]): PanelFiling | undefined {
  const newest = (list: PanelFiling[]) =>
    [...list].sort(
      (a, b) =>
        cmp(b.filedAt, a.filedAt) || cmp(b.createdAt, a.createdAt) || cmp(a.filingId, b.filingId),
    )[0];
  const filed = filings.filter((f) => f.status === "FILED");
  if (filed.length > 0) return newest(filed);
  const pending = filings.filter((f) => f.status === "PENDING");
  return pending.length > 0 ? newest(pending) : undefined;
}

/**
 * Estado de la DJ (D4-2, sin «Completo»). Orden de precedencia: presentada,
 * presentación sin acuse, liquidación finalizada sin presentar, legajo cerrado
 * sin presentar (supuesto del PR, S4-15), legajo abierto, sin legajo.
 */
export function deriveDjState(input: {
  hasFiled: boolean;
  hasPending: boolean;
  hasFinalizedSettlement: boolean;
  legajoStatus: string | null;
}): TaxPanelDjState {
  if (input.hasFiled) return "PRESENTADO";
  if (input.hasPending) return "PRESENTACION_SIN_ACUSE";
  if (input.hasFinalizedSettlement) return "DJ_PENDIENTE";
  if (input.legajoStatus === "FINALIZED") return "DJ_PENDIENTE";
  if (input.legajoStatus !== null) return "LEGAJO_EN_CURSO";
  return "SIN_LEGAJO";
}

/** Responsables de un cliente: el usuario que consulta primero; luego por nombre (nulos al final). */
export function responsablesFor(
  assignees: { userId: string }[],
  names: ReadonlyMap<string, string>,
  selfId: string,
): TaxPanelResponsable[] {
  return assignees
    .map((a) => ({
      userId: a.userId,
      name: names.get(a.userId) ?? null,
      isSelf: a.userId === selfId,
    }))
    .sort(
      (a, b) =>
        Number(b.isSelf) - Number(a.isSelf) || nameOrder(a.name, b.name) || cmp(a.userId, b.userId),
    );
}

/** Arma la fila del panel a partir de la obligación y de sus datos derivados. */
export function buildRow(
  obligation: PanelObligation,
  legajo: TaxPanelLegajo | null,
  filing: PanelFiling | undefined,
  djState: TaxPanelDjState,
  responsables: TaxPanelResponsable[],
  asOf: string,
): TaxPanelRow {
  return {
    obligationId: obligation.obligationId,
    clientId: obligation.clientId,
    clientName: obligation.clientName,
    cuit: obligation.cuit,
    cuitEnding: cuitEnding(obligation.cuit),
    taxTypeId: obligation.taxTypeId,
    taxTypeName: obligation.taxTypeName,
    regimeId: obligation.regimeId,
    regimeName: obligation.regimeName,
    jurisdictionId: obligation.jurisdictionId,
    jurisdictionName: obligation.jurisdictionName,
    periodId: obligation.periodId,
    periodLabel: periodLabel(
      obligation.periodLabelRaw,
      obligation.periodStart,
      obligation.periodEnd,
    ),
    periodStart: obligation.periodStart,
    periodEnd: obligation.periodEnd,
    dueDate: obligation.dueDate,
    dueDateSource: obligation.dueDateSource,
    calculatedDueDate: obligation.calculatedDueDate,
    daysUntilDue: daysUntilDue(asOf, obligation.dueDate),
    legajo,
    filing: filing
      ? {
          filingId: filing.filingId,
          status: filing.status as TaxPanelFilingStatus,
          filedAt: filing.filedAt,
          hasReceipt: filing.hasReceipt,
        }
      : null,
    djState,
    assigneeCount: responsables.length,
    responsables,
  };
}

interface GroupInfo {
  key: string;
  label: string;
  rank: number;
  sort: string;
}

/** Grupo de una fila. Con responsables múltiples, la fila cae en el primer responsable (S4-14). */
export function groupOf(row: TaxPanelRow, grouping: TaxPanelGrouping): GroupInfo {
  switch (grouping) {
    case "terminacion":
      return row.cuitEnding === null
        ? { key: "terminacion:sin-cuit", label: "Sin CUIT", rank: 1, sort: "" }
        : {
            key: `terminacion:${row.cuitEnding}`,
            label: `Terminación ${row.cuitEnding}`,
            rank: 0,
            sort: row.cuitEnding,
          };
    case "vencimiento":
      return row.dueDate === null
        ? { key: "vencimiento:sin-vencimiento", label: "Sin vencimiento", rank: 1, sort: "" }
        : {
            key: `vencimiento:${row.dueDate}`,
            label: `Vence el ${dmy(row.dueDate)}`,
            rank: 0,
            sort: row.dueDate,
          };
    case "responsable": {
      const primary = row.responsables[0];
      if (primary === undefined)
        return { key: "responsable:sin-asignar", label: "Sin asignar", rank: 3, sort: "" };
      if (primary.isSelf) return { key: "responsable:vos", label: "Vos", rank: 0, sort: "" };
      if (primary.name === null)
        return { key: "responsable:otro", label: "Otro asignado", rank: 2, sort: "" };
      return {
        key: `responsable:${primary.userId}`,
        label: primary.name,
        rank: 1,
        sort: primary.name,
      };
    }
    case "cliente":
      return {
        key: `cliente:${row.clientId}`,
        label: row.clientName,
        rank: 0,
        sort: row.clientName,
      };
  }
}

/** Conteos por grupo sobre el conjunto filtrado (sin paginar) y el orden de cada grupo. */
export function buildGroups(
  rows: TaxPanelRow[],
  grouping: TaxPanelGrouping,
): { groups: TaxPanelGroup[]; orderOf: (row: TaxPanelRow) => number } {
  const found = new Map<string, GroupInfo & { count: number }>();
  for (const row of rows) {
    const info = groupOf(row, grouping);
    const current = found.get(info.key);
    if (current) current.count += 1;
    else found.set(info.key, { ...info, count: 1 });
  }
  const ordered = [...found.values()].sort(
    (a, b) => a.rank - b.rank || collator.compare(a.sort, b.sort) || cmp(a.key, b.key),
  );
  const groups = ordered.map((g, order) => ({ key: g.key, label: g.label, order, count: g.count }));
  const orderByKey = new Map(groups.map((g) => [g.key, g.order] as const));
  return {
    groups,
    orderOf: (row) => orderByKey.get(groupOf(row, grouping).key) ?? groups.length,
  };
}

/**
 * Orden del servidor. Vencimiento: sin fecha al final en ambas direcciones.
 * Desempate fijo (cliente, régimen, período, id) para paginar de forma estable.
 */
export function sortPanelRows(
  rows: TaxPanelRow[],
  orden: TaxPanelSortKey,
  dir: TaxPanelSortDir,
  groupOrder: ((row: TaxPanelRow) => number) | null,
): TaxPanelRow[] {
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (groupOrder) {
      const byGroup = groupOrder(a) - groupOrder(b);
      if (byGroup !== 0) return byGroup;
    }
    let key = 0;
    switch (orden) {
      case "vencimiento":
        if (a.dueDate === null || b.dueDate === null) {
          if (a.dueDate !== b.dueDate) return a.dueDate === null ? 1 : -1;
        } else {
          key = cmp(a.dueDate, b.dueDate) * sign;
        }
        break;
      case "cliente":
        key = collator.compare(a.clientName, b.clientName) * sign;
        break;
      case "impuesto":
        key =
          (collator.compare(a.taxTypeName, b.taxTypeName) ||
            collator.compare(a.regimeName, b.regimeName)) * sign;
        break;
      case "estado":
        key =
          (TAX_PANEL_DJ_STATES.indexOf(a.djState) - TAX_PANEL_DJ_STATES.indexOf(b.djState)) * sign;
        break;
    }
    return (
      key ||
      collator.compare(a.clientName, b.clientName) ||
      collator.compare(a.regimeName, b.regimeName) ||
      cmp(a.periodStart, b.periodStart) ||
      cmp(a.obligationId, b.obligationId)
    );
  });
}

/** Opciones de filtro calculadas sobre el conjunto filtrado antes de paginar (S4-16). */
export function buildOptions(
  rows: TaxPanelRow[],
  grupos: { key: string; label: string }[],
): TaxPanelOptions {
  const responsables = new Map<string, { userId: string; name: string | null }>();
  const taxTypes = new Map<string, { id: string; name: string }>();
  const periods = new Map<string, { id: string; label: string; start: string }>();
  for (const row of rows) {
    taxTypes.set(row.taxTypeId, { id: row.taxTypeId, name: row.taxTypeName });
    periods.set(row.periodId, { id: row.periodId, label: row.periodLabel, start: row.periodStart });
    for (const responsable of row.responsables) {
      responsables.set(responsable.userId, { userId: responsable.userId, name: responsable.name });
    }
  }
  return {
    responsables: [...responsables.values()].sort(
      (a, b) => nameOrder(a.name, b.name) || cmp(a.userId, b.userId),
    ),
    taxTypes: [...taxTypes.values()]
      .sort((a, b) => collator.compare(a.name, b.name))
      .map(({ id, name }) => ({ id, name })),
    periods: [...periods.values()]
      .sort((a, b) => cmp(b.start, a.start) || collator.compare(a.label, b.label))
      .map(({ id, label }) => ({ id, label })),
    grupos,
  };
}

/** Etiqueta comprimida de un conjunto de terminaciones: «0123» → «0-3»; «0159» → «0-1, 5, 9». */
export function compressDigits(key: string): string {
  const digits = [...new Set(key.split("").map(Number))].sort((a, b) => a - b);
  const parts: string[] = [];
  let runStart: number | null = null;
  let previous: number | null = null;
  const flush = () => {
    if (runStart !== null && previous !== null) {
      parts.push(runStart === previous ? `${runStart}` : `${runStart}-${previous}`);
    }
  };
  for (const digit of digits) {
    if (previous === null || digit !== previous + 1) {
      flush();
      runStart = digit;
    }
    previous = digit;
  }
  flush();
  return parts.join(", ");
}

/** Grupos de terminación a partir de las celdas publicadas del impuesto (celdas ENDING_DIGITS, S4-4). */
export function endingGroupsFrom(values: string[]): { key: string; label: string }[] {
  const keys = new Set<string>();
  for (const value of values) {
    keys.add([...new Set(value.split(""))].sort().join(""));
  }
  return [...keys].sort(cmp).map((key) => ({ key, label: compressDigits(key) }));
}

async function loadBatch(
  tx: Prisma.TransactionClient,
  firmId: string,
  obligations: PanelObligation[],
): Promise<PanelBatch> {
  const clientIds = unique(obligations.map((o) => o.clientId));
  const obligationIds = obligations.map((o) => o.obligationId);
  const periodIds = unique(obligations.map((o) => o.periodId));
  const ends = obligations.map((o) => o.periodEnd).sort(cmp);
  const minEnd = ends[0] ?? "";
  const maxEnd = ends[ends.length - 1] ?? "";
  const [linkRows, workpaperRows, filingRows, settlementRows, assignmentRows] = await Promise.all([
    tx.workpaperSettlement.findMany({
      where: {
        firmId,
        clientId: { in: clientIds },
        obligationId: { in: obligationIds },
        workpaper: { status: { not: "SUPERSEDED" } },
      },
      select: {
        obligationId: true,
        workpaper: {
          select: {
            id: true,
            clientId: true,
            status: true,
            revision: true,
            periodStart: true,
            periodEnd: true,
          },
        },
      },
    }),
    tx.monthlyTaxWorkpaper.findMany({
      where: {
        firmId,
        clientId: { in: clientIds },
        status: { not: "SUPERSEDED" },
        periodEnd: { gte: utcDay(minEnd) },
        periodStart: { lte: utcDay(maxEnd) },
      },
      select: {
        id: true,
        clientId: true,
        status: true,
        revision: true,
        periodStart: true,
        periodEnd: true,
      },
    }),
    tx.taxFiling.findMany({
      where: {
        firmId,
        clientId: { in: clientIds },
        obligationId: { in: obligationIds },
        status: { in: ["FILED", "PENDING"] },
      },
      select: {
        id: true,
        obligationId: true,
        status: true,
        filedAt: true,
        createdAt: true,
        evidenceDocumentId: true,
      },
    }),
    tx.taxSettlement.findMany({
      where: {
        firmId,
        clientId: { in: clientIds },
        periodId: { in: periodIds },
        status: "FINALIZED",
        filings: { none: { status: "FILED" } },
      },
      select: { clientId: true, regimeId: true, periodId: true },
    }),
    tx.clientAssignment.findMany({
      where: { firmId, clientId: { in: clientIds } },
      select: { clientId: true, userId: true },
    }),
  ]);
  const userIds = unique(assignmentRows.map((a) => a.userId));
  const userRows =
    userIds.length > 0
      ? await tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : [];
  return {
    links: linkRows.map((l) => ({
      obligationId: l.obligationId,
      workpaper: {
        workpaperId: l.workpaper.id,
        clientId: l.workpaper.clientId,
        status: l.workpaper.status,
        revision: l.workpaper.revision,
        periodStart: calendarDay(l.workpaper.periodStart),
        periodEnd: calendarDay(l.workpaper.periodEnd),
      },
    })),
    workpapers: workpaperRows.map((w) => ({
      workpaperId: w.id,
      clientId: w.clientId,
      status: w.status,
      revision: w.revision,
      periodStart: calendarDay(w.periodStart),
      periodEnd: calendarDay(w.periodEnd),
    })),
    filings: filingRows.map((f) => ({
      filingId: f.id,
      obligationId: f.obligationId,
      status: f.status,
      filedAt: calendarDay(f.filedAt),
      createdAt: f.createdAt.toISOString(),
      hasReceipt: f.evidenceDocumentId !== null,
    })),
    finalized: new Set(
      settlementRows.map((s) => settlementKey(s.clientId, s.regimeId, s.periodId)),
    ),
    assignments: assignmentRows,
    names: new Map(userRows.map((u) => [u.id, u.name] as const)),
  };
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

/**
 * Ejecutor de la transacción del panel. Por defecto abre withTenantContext con la
 * sesión; las pruebas de RLS lo sustituyen por el rol runtime (lib/prisma.ts usa el
 * superusuario de DATABASE_URL en NODE_ENV=test, sin RLS).
 */
export type TaxPanelRunner = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

export class TaxPanelService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Listado del panel: una consulta de obligaciones y seis lecturas por lote, sin N+1. */
  async list(
    ctx: TenantContext,
    query: TaxPanelQuery,
    runTx: TaxPanelRunner = (fn) => withTenantContext(ctx, fn),
  ): Promise<TaxPanelResponse> {
    const asOf = argentinaToday(this.now());
    const responsables = query.responsable?.map((item) => (item === "me" ? ctx.userId : item));
    const dueFrom = query.dueFrom ?? addDays(asOf, -TAX_PANEL_DEFAULT_LOOKBACK_DAYS);
    const estado = query.estado ? new Set<TaxPanelDjState>(query.estado) : null;
    const excludedStatuses = query.estado ? NOT_APPLICABLE_ONLY : PRESENTED_OR_CLOSED;

    return runTx(async (tx) => {
      const dueRange = {
        gte: utcDay(dueFrom),
        ...(query.dueTo ? { lte: utcDay(query.dueTo) } : {}),
      };
      const conditions: Prisma.TaxObligationWhereInput[] = [
        // Sin vencimiento siempre visible: P1, no se oculta lo que hay que resolver (S4-13).
        { OR: [{ dueDate: null }, { dueDate: dueRange }] },
      ];
      if (responsables) {
        conditions.push({
          client: { assignments: { some: { firmId: ctx.firmId, userId: { in: responsables } } } },
        });
      }
      if (query.terminacion) {
        conditions.push({
          client: { OR: query.terminacion.map((digit) => ({ cuit: { endsWith: digit } })) },
        });
      }
      if (query.grupo) {
        conditions.push({
          client: { OR: query.grupo.map((digit) => ({ cuit: { endsWith: digit } })) },
        });
      }

      const found = await tx.taxObligation.findMany({
        where: { firmId: ctx.firmId, status: { notIn: excludedStatuses }, AND: conditions },
        select: {
          id: true,
          clientId: true,
          regimeId: true,
          periodId: true,
          dueDate: true,
          calculatedDueDate: true,
          dueDateSource: true,
          client: { select: { legalName: true, cuit: true } },
          regime: {
            select: {
              name: true,
              taxTypeId: true,
              jurisdictionId: true,
              taxType: { select: { name: true } },
              jurisdiction: { select: { name: true } },
            },
          },
          period: { select: { label: true, startDate: true, endDate: true } },
        },
        take: TAX_PANEL_CANDIDATE_CAP + 1,
      });
      if (found.length > TAX_PANEL_CANDIDATE_CAP) {
        throw new TaxPanelError(
          "TAX_PANEL_TOO_MANY_OBLIGATIONS",
          `Hay más de ${CAP_LABEL} obligaciones con estos filtros: acotá el rango de vencimiento o el responsable`,
          422,
          "dueFrom",
        );
      }

      const obligations: PanelObligation[] = found.map((o) => ({
        obligationId: o.id,
        clientId: o.clientId,
        clientName: o.client.legalName,
        cuit: o.client.cuit,
        taxTypeId: o.regime.taxTypeId,
        taxTypeName: o.regime.taxType.name,
        regimeId: o.regimeId,
        regimeName: o.regime.name,
        jurisdictionId: o.regime.jurisdictionId,
        jurisdictionName: o.regime.jurisdiction.name,
        periodId: o.periodId,
        periodLabelRaw: o.period.label,
        periodStart: calendarDay(o.period.startDate),
        periodEnd: calendarDay(o.period.endDate),
        dueDate: o.dueDate ? calendarDay(o.dueDate) : null,
        dueDateSource: o.dueDateSource,
        calculatedDueDate: o.calculatedDueDate ? calendarDay(o.calculatedDueDate) : null,
      }));

      const batch =
        obligations.length > 0 ? await loadBatch(tx, ctx.firmId, obligations) : EMPTY_BATCH;
      const linkedBy = groupBy(batch.links, (l) => l.obligationId);
      const workpapersBy = groupBy(batch.workpapers, (w) => w.clientId);
      const filingsBy = groupBy(batch.filings, (f) => f.obligationId);
      const assigneesBy = groupBy(batch.assignments, (a) => a.clientId);

      const rows = obligations.map((o) => {
        const filings = filingsBy.get(o.obligationId) ?? [];
        const legajo = pickLegajo(
          o,
          (linkedBy.get(o.obligationId) ?? []).map((l) => l.workpaper),
          workpapersBy.get(o.clientId) ?? [],
        );
        const djState = deriveDjState({
          hasFiled: filings.some((f) => f.status === "FILED"),
          hasPending: filings.some((f) => f.status === "PENDING"),
          hasFinalizedSettlement: batch.finalized.has(
            settlementKey(o.clientId, o.regimeId, o.periodId),
          ),
          legajoStatus: legajo?.status ?? null,
        });
        const responsablesOf = responsablesFor(
          assigneesBy.get(o.clientId) ?? [],
          batch.names,
          ctx.userId,
        );
        return buildRow(o, legajo, pickFiling(filings), djState, responsablesOf, asOf);
      });

      const endingRows =
        query.taxTypeId !== undefined
          ? await tx.taxCalendarEntry.findMany({
              where: {
                firmId: ctx.firmId,
                taxTypeId: query.taxTypeId,
                groupingKind: "ENDING_DIGITS",
                endingDigits: { not: null },
                calendar: { status: "PUBLISHED" },
              },
              select: { endingDigits: true },
              distinct: ["endingDigits"],
            })
          : [];
      const grupos = endingGroupsFrom(
        endingRows.flatMap((r) => (r.endingDigits ? [r.endingDigits] : [])),
      );

      const filtered = rows.filter(
        (row) =>
          (query.taxTypeId === undefined || row.taxTypeId === query.taxTypeId) &&
          (query.regimeId === undefined || row.regimeId === query.regimeId) &&
          (query.periodId === undefined || row.periodId === query.periodId) &&
          (estado === null || estado.has(row.djState)),
      );
      const grouping = query.agrupar ? buildGroups(filtered, query.agrupar) : null;
      const sorted = sortPanelRows(
        filtered,
        query.orden,
        query.dir,
        grouping ? grouping.orderOf : null,
      );

      return {
        data: sorted.slice(query.offset, query.offset + query.limit),
        meta: {
          total: filtered.length,
          limit: query.limit,
          offset: query.offset,
          asOf,
          groups: grouping ? grouping.groups : null,
          groupsComplete: true,
          options: buildOptions(rows, grupos),
        },
      };
    });
  }
}
