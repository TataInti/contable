import { Prisma } from "@prisma/client";
import { validateCalendarCoverage, type CalendarCoverageEntry, type CalendarProblem } from "@contable/tax-engine";
import {
  taxCalendarEntryInputSchema,
  type CreateTaxCalendarInput,
  type ImportTaxCalendarEntriesInput,
  type TaxCalendarEntriesImportReport,
  type TaxCalendarEntryInput,
  type TaxCalendarEntryPatch,
  type TaxCalendarListQuery,
  type UpdateTaxCalendarInput,
} from "@contable/contracts";
import { withTenantContext, type TenantContext } from "../auth/tenant.js";
import { isPrismaUniqueViolation } from "../lib/prisma-errors.js";
import {
  ArchivoCsvInvalidoError,
  claveDeCelda,
  leerCsvCalendario,
  mapearImportacion,
  type CeldaMapeada,
  type LecturaCsv,
} from "./tax-calendar-csv.js";

/**
 * Calendarios fiscales del estudio (corte 2a-i).
 *
 * Invariantes:
 * - Un calendario pertenece a un estudio (firmId) y se lee solo con su firma (RLS).
 * - Solo un borrador se edita. Lo publicado es inmutable: se corrige con
 *   «crear a partir de este», que genera una versión nueva en borrador.
 * - A lo sumo una versión PUBLISHED por (estudio, organismo, jurisdicción, año).
 *   Publicar oculta la visible anterior en la misma transacción; mostrar una
 *   oculta intercambia con la visible y lo informa en la respuesta.
 * - «Ocultar» es reversible. No hay ruta para quitar celdas publicadas.
 * - Una celda se quita solo de un borrador, y la baja queda auditada con la celda anterior.
 * - Cada escritura deja AuditEvent con antes y después.
 */

export type TaxCalendarErrorCode =
  | "CALENDAR_NOT_FOUND"
  | "CALENDAR_ENTRY_NOT_FOUND"
  | "CALENDAR_REFERENCE_NOT_FOUND"
  | "CALENDAR_NOT_DRAFT"
  | "CALENDAR_NOT_PUBLISHED"
  | "CALENDAR_NOT_HIDDEN"
  | "CALENDAR_VALIDATION_FAILED"
  | "CALENDAR_SOURCE_INVALID"
  | "CALENDAR_VERSION_CONFLICT";

/** Estado HTTP de cada error: 404 no existe; 422 el contenido no cumple; 409 el estado no admite la acción. */
const CALENDAR_ERROR_HTTP_STATUS: Readonly<Record<TaxCalendarErrorCode, number>> = {
  CALENDAR_NOT_FOUND: 404,
  CALENDAR_ENTRY_NOT_FOUND: 404,
  CALENDAR_REFERENCE_NOT_FOUND: 422,
  CALENDAR_VALIDATION_FAILED: 422,
  CALENDAR_SOURCE_INVALID: 422,
  CALENDAR_NOT_DRAFT: 409,
  CALENDAR_NOT_PUBLISHED: 409,
  CALENDAR_NOT_HIDDEN: 409,
  CALENDAR_VERSION_CONFLICT: 409,
};

export class TaxCalendarError extends Error {
  readonly code: TaxCalendarErrorCode;
  readonly httpStatus: number;
  readonly path: string[] | undefined;
  readonly problems: CalendarProblem[] | undefined;

  constructor(
    kind: TaxCalendarErrorCode,
    message: string,
    options: { path?: string[]; problems?: CalendarProblem[] } = {},
  ) {
    super(message);
    this.name = "TaxCalendarError";
    this.code = kind;
    this.httpStatus = CALENDAR_ERROR_HTTP_STATUS[kind];
    this.path = options.path;
    this.problems = options.problems;
  }
}

type Tx = Prisma.TransactionClient;

const calendarInclude = {
  taxAuthority: { select: { id: true, code: true, name: true } },
  jurisdiction: { select: { id: true, code: true, name: true } },
  entries: { orderBy: [{ sortOrder: "asc" as const }, { dueDate: "asc" as const }] },
} satisfies Prisma.TaxCalendarInclude;

type CalendarWithEntries = Prisma.TaxCalendarGetPayload<{ include: typeof calendarInclude }>;
type EntryRow = CalendarWithEntries["entries"][number];

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);
const utcDay = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const optionalUtcDay = (iso: string | null | undefined): Date | null => (iso ? utcDay(iso) : null);

function notFound(): TaxCalendarError {
  return new TaxCalendarError("CALENDAR_NOT_FOUND", "El calendario no existe en este estudio");
}

function entryNotFound(): TaxCalendarError {
  return new TaxCalendarError("CALENDAR_ENTRY_NOT_FOUND", "La celda no existe en este calendario");
}

function snapshot(calendar: {
  id: string;
  status: string;
  version: number;
  title: string;
  year: number;
  taxAuthorityId: string;
  jurisdictionId: string;
  sourceId: string | null;
  supersedesId: string | null;
}): Prisma.InputJsonObject {
  return {
    id: calendar.id,
    status: calendar.status,
    version: calendar.version,
    title: calendar.title,
    year: calendar.year,
    taxAuthorityId: calendar.taxAuthorityId,
    jurisdictionId: calendar.jurisdictionId,
    sourceId: calendar.sourceId,
    supersedesId: calendar.supersedesId,
  };
}

function entrySnapshot(entry: EntryRow): Prisma.InputJsonObject {
  return {
    id: entry.id,
    conceptLabel: entry.conceptLabel,
    taxTypeId: entry.taxTypeId,
    regimeId: entry.regimeId,
    groupingKind: entry.groupingKind,
    endingDigits: entry.endingDigits,
    referencePeriodStart: entry.referencePeriodStart ? isoDay(entry.referencePeriodStart) : null,
    referencePeriodEnd: entry.referencePeriodEnd ? isoDay(entry.referencePeriodEnd) : null,
    referenceLabel: entry.referenceLabel,
    dueDate: isoDay(entry.dueDate),
    adjustment: entry.adjustment,
    reviewState: entry.reviewState,
    sortOrder: entry.sortOrder,
  };
}

async function recordAudit(
  tx: Tx,
  ctx: TenantContext,
  action: string,
  entityId: string,
  before: Prisma.InputJsonObject | null,
  after: Prisma.InputJsonObject | null,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      firmId: ctx.firmId,
      userId: ctx.userId,
      actorKind: "USER",
      action,
      entityType: "tax_calendar",
      entityId,
      ...(before !== null ? { before } : {}),
      ...(after !== null ? { after } : {}),
    },
  });
}

async function loadCalendar(tx: Tx, firmId: string, calendarId: string): Promise<CalendarWithEntries> {
  const calendar = await tx.taxCalendar.findFirst({
    where: { id: calendarId, firmId },
    include: calendarInclude,
  });
  if (!calendar) throw notFound();
  return calendar;
}

async function loadHolidays(tx: Tx, jurisdictionId: string, year: number): Promise<string[]> {
  const holidays = await tx.holiday.findMany({
    where: { jurisdictionId, date: { gte: utcDay(`${year}-01-01`), lte: utcDay(`${year}-12-31`) } },
    select: { date: true },
  });
  return holidays.map((holiday) => isoDay(holiday.date));
}

function coverageEntries(entries: readonly EntryRow[]): CalendarCoverageEntry[] {
  return entries.map((entry) => ({
    conceptLabel: entry.conceptLabel,
    regimeId: entry.regimeId,
    taxTypeId: entry.taxTypeId,
    groupingKind: entry.groupingKind,
    endingDigits: entry.endingDigits,
    zoneCode: entry.zoneCode,
    referencePeriodStart: entry.referencePeriodStart ? isoDay(entry.referencePeriodStart) : null,
    referencePeriodEnd: entry.referencePeriodEnd ? isoDay(entry.referencePeriodEnd) : null,
    referenceLabel: entry.referenceLabel,
    dueDate: isoDay(entry.dueDate),
    adjustment: entry.adjustment,
    reviewState: entry.reviewState,
  }));
}

async function nextVersion(
  tx: Tx,
  firmId: string,
  scope: { taxAuthorityId: string; jurisdictionId: string; year: number },
): Promise<number> {
  const last = await tx.taxCalendar.findFirst({
    where: { firmId, ...scope },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return (last?.version ?? 0) + 1;
}

async function assertReferences(
  tx: Tx,
  input: { taxTypeId?: string | null | undefined; regimeId?: string | null | undefined },
): Promise<void> {
  if (input.taxTypeId) {
    const taxType = await tx.taxType.findUnique({ where: { id: input.taxTypeId }, select: { id: true } });
    if (!taxType) {
      throw new TaxCalendarError("CALENDAR_REFERENCE_NOT_FOUND", "El tipo de impuesto no existe en el catálogo", {
        path: ["taxTypeId"],
      });
    }
  }
  if (input.regimeId) {
    const regime = await tx.taxRegime.findUnique({ where: { id: input.regimeId }, select: { id: true } });
    if (!regime) {
      throw new TaxCalendarError("CALENDAR_REFERENCE_NOT_FOUND", "El régimen no existe en el catálogo", {
        path: ["regimeId"],
      });
    }
  }
}

function assertDraft(calendar: { status: string }): void {
  if (calendar.status === "DRAFT") return;
  throw new TaxCalendarError(
    "CALENDAR_NOT_DRAFT",
    calendar.status === "PUBLISHED"
      ? "El calendario está publicado y no se edita. Creá a partir de este una versión nueva para corregirlo."
      : "El calendario está oculto y no se edita. Mostralo o creá a partir de este una versión nueva.",
    { path: ["status"] },
  );
}

/** Quitar una celda solo es posible en un borrador: lo publicado u oculto se corrige con una versión nueva. */
function assertDraftForEntryRemoval(calendar: { status: string }): void {
  if (calendar.status === "DRAFT") return;
  throw new TaxCalendarError(
    "CALENDAR_NOT_DRAFT",
    "Este calendario está publicado (u oculto): para corregirlo, creá una versión nueva a partir de este.",
    { path: ["status"] },
  );
}

type EntryScalarFields = Pick<
  Prisma.TaxCalendarEntryUncheckedCreateInput,
  | "conceptLabel"
  | "taxTypeId"
  | "regimeId"
  | "groupingKind"
  | "endingDigits"
  | "referencePeriodStart"
  | "referencePeriodEnd"
  | "referenceLabel"
  | "dueDate"
  | "dueDateRaw"
  | "adjustment"
  | "noteRef"
  | "noteText"
  | "sortOrder"
  | "reviewState"
  | "reviewedByUserId"
  | "reviewedAt"
>;

/** Campos escalares de una celda a partir de la entrada validada. */
function entryFields(ctx: TenantContext, input: TaxCalendarEntryInput, sortOrder: number): EntryScalarFields {
  return {
    conceptLabel: input.conceptLabel,
    taxTypeId: input.taxTypeId ?? null,
    regimeId: input.regimeId ?? null,
    groupingKind: input.groupingKind,
    endingDigits: input.groupingKind === "ENDING_DIGITS" ? (input.endingDigits ?? null) : null,
    referencePeriodStart: optionalUtcDay(input.referencePeriodStart),
    referencePeriodEnd: optionalUtcDay(input.referencePeriodEnd),
    referenceLabel: input.referenceLabel ?? null,
    dueDate: utcDay(input.dueDate),
    dueDateRaw: input.dueDateRaw ?? null,
    adjustment: input.adjustment ?? "NONE",
    noteRef: input.noteRef ?? null,
    noteText: input.noteText ?? null,
    sortOrder: input.sortOrder ?? sortOrder,
    // Una celda cargada a mano queda revisada por quien la guarda.
    reviewState: "REVIEWED",
    reviewedByUserId: ctx.userId,
    reviewedAt: new Date(),
  };
}

function entryAsInput(entry: EntryRow): Record<string, unknown> {
  return {
    conceptLabel: entry.conceptLabel,
    taxTypeId: entry.taxTypeId,
    regimeId: entry.regimeId,
    groupingKind: entry.groupingKind,
    endingDigits: entry.endingDigits,
    referencePeriodStart: entry.referencePeriodStart ? isoDay(entry.referencePeriodStart) : null,
    referencePeriodEnd: entry.referencePeriodEnd ? isoDay(entry.referencePeriodEnd) : null,
    referenceLabel: entry.referenceLabel,
    dueDate: isoDay(entry.dueDate),
    dueDateRaw: entry.dueDateRaw,
    adjustment: entry.adjustment,
    noteRef: entry.noteRef,
    noteText: entry.noteText,
    sortOrder: entry.sortOrder,
  };
}

/** Celdas por INSERT en una importación; toda la importación va en una sola transacción. */
const LOTE_IMPORTACION = 500;

/**
 * Campos de una celda importada desde CSV: como una carga a mano, pero la revisión sigue la duda
 * del archivo (dudosa o revisada) y guarda la procedencia (página, extracción y fila).
 */
function importedEntryFields(ctx: TenantContext, celda: CeldaMapeada, sortOrder: number) {
  const revisada = celda.revision === "REVIEWED";
  return {
    ...entryFields(ctx, celda.entrada, sortOrder),
    reviewState: celda.revision,
    reviewedByUserId: revisada ? ctx.userId : null,
    reviewedAt: revisada ? new Date() : null,
    sourcePage: celda.paginaOrigen,
    extraction: celda.extraccion,
  };
}

export class TaxCalendarRegistryService {
  /** Lista los calendarios del estudio con sus filtros. */
  async list(ctx: TenantContext, query: TaxCalendarListQuery) {
    return withTenantContext(ctx, (tx) =>
      tx.taxCalendar.findMany({
        where: {
          firmId: ctx.firmId,
          ...(query.year !== undefined ? { year: query.year } : {}),
          ...(query.taxAuthorityId ? { taxAuthorityId: query.taxAuthorityId } : {}),
          ...(query.jurisdictionId ? { jurisdictionId: query.jurisdictionId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        include: {
          taxAuthority: { select: { id: true, code: true, name: true } },
          jurisdiction: { select: { id: true, code: true, name: true } },
          _count: { select: { entries: true } },
        },
        orderBy: [{ year: "desc" }, { taxAuthorityId: "asc" }, { jurisdictionId: "asc" }, { version: "desc" }],
      }),
    );
  }

  async get(ctx: TenantContext, calendarId: string) {
    return withTenantContext(ctx, (tx) => loadCalendar(tx, ctx.firmId, calendarId));
  }

  /** Crea un calendario en borrador para organismo, jurisdicción y año. */
  async create(ctx: TenantContext, input: CreateTaxCalendarInput) {
    try {
      return await withTenantContext(ctx, async (tx) => {
        const authority = await tx.taxAuthority.findUnique({ where: { id: input.taxAuthorityId }, select: { id: true } });
        if (!authority) {
          throw new TaxCalendarError("CALENDAR_REFERENCE_NOT_FOUND", "El organismo no existe en el catálogo", {
            path: ["taxAuthorityId"],
          });
        }
        const jurisdiction = await tx.jurisdiction.findUnique({ where: { id: input.jurisdictionId }, select: { id: true } });
        if (!jurisdiction) {
          throw new TaxCalendarError("CALENDAR_REFERENCE_NOT_FOUND", "La jurisdicción no existe en el catálogo", {
            path: ["jurisdictionId"],
          });
        }
        const scope = { taxAuthorityId: input.taxAuthorityId, jurisdictionId: input.jurisdictionId, year: input.year };
        const version = await nextVersion(tx, ctx.firmId, scope);
        const created = await tx.taxCalendar.create({
          data: {
            firmId: ctx.firmId,
            ...scope,
            title: input.title,
            version,
            status: "DRAFT",
            createdByUserId: ctx.userId,
          },
          include: calendarInclude,
        });
        await recordAudit(tx, ctx, "tax_calendar.created", created.id, null, snapshot(created));
        return created;
      });
    } catch (err) {
      if (isPrismaUniqueViolation(err)) {
        throw new TaxCalendarError("CALENDAR_VERSION_CONFLICT", "Otro cambio tomó esa versión. Volvé a intentarlo.");
      }
      throw err;
    }
  }

  /** Edita los metadatos de un borrador. */
  async update(ctx: TenantContext, calendarId: string, input: UpdateTaxCalendarInput) {
    return withTenantContext(ctx, async (tx) => {
      const current = await loadCalendar(tx, ctx.firmId, calendarId);
      assertDraft(current);
      const updated = await tx.taxCalendar.update({
        where: { id: calendarId },
        data: { title: input.title },
        include: calendarInclude,
      });
      await recordAudit(tx, ctx, "tax_calendar.updated", calendarId, snapshot(current), snapshot(updated));
      return updated;
    });
  }

  /** Agrega una celda a un borrador. */
  async addEntry(ctx: TenantContext, calendarId: string, input: TaxCalendarEntryInput) {
    return withTenantContext(ctx, async (tx) => {
      const calendar = await loadCalendar(tx, ctx.firmId, calendarId);
      assertDraft(calendar);
      await assertReferences(tx, input);
      const last = calendar.entries.reduce((max, entry) => Math.max(max, entry.sortOrder), -1);
      const entry = await tx.taxCalendarEntry.create({
        data: { ...entryFields(ctx, input, last + 1), firmId: ctx.firmId, calendarId },
      });
      await recordAudit(tx, ctx, "tax_calendar.entry_added", calendarId, null, entrySnapshot(entry));
      return loadCalendar(tx, ctx.firmId, calendarId);
    });
  }

  /**
   * Importa celdas desde un CSV a un borrador (corte 2b-1). Con `dryRun` valida y devuelve el informe
   * sin escribir nada. Sin `dryRun`, las filas válidas se crean en una sola transacción; las inválidas o
   * repetidas se informan y no se importan. Si importa al menos una fila, deja un registro de auditoría resumen.
   */
  async importEntries(
    ctx: TenantContext,
    calendarId: string,
    input: ImportTaxCalendarEntriesInput,
  ): Promise<TaxCalendarEntriesImportReport> {
    return withTenantContext(
      ctx,
      async (tx) => {
        if (!input.dryRun) {
          // Una importación real bloquea el calendario: el control de repetidos lee las celdas dentro de la misma transacción.
          await tx.$queryRaw`SELECT id FROM tax_calendars WHERE id = ${calendarId} FOR UPDATE`;
        }
        const calendar = await loadCalendar(tx, ctx.firmId, calendarId);
        assertDraft(calendar);
        let lectura: LecturaCsv;
        try {
          lectura = leerCsvCalendario(input.csv);
        } catch (err) {
          if (err instanceof ArchivoCsvInvalidoError) {
            throw new TaxCalendarError("CALENDAR_VALIDATION_FAILED", err.message, {
              path: ["csv"],
            });
          }
          throw err;
        }
        const existentes = new Set(
          calendar.entries.map((entry) =>
            claveDeCelda({
              conceptLabel: entry.conceptLabel,
              groupingKind: entry.groupingKind,
              endingDigits: entry.endingDigits,
              referencePeriodStart: entry.referencePeriodStart
                ? isoDay(entry.referencePeriodStart)
                : null,
              referenceLabel: entry.referenceLabel,
            }),
          ),
        );
        const resultado = mapearImportacion(lectura, existentes);
        const informe = {
          dryRun: input.dryRun,
          totalFilas: resultado.totalFilas,
          validas: resultado.celdas.length,
          rechazadas: resultado.rechazadas,
          avisos: resultado.avisos,
          columnasIgnoradas: lectura.columnasIgnoradas,
          encabezadosFaltantes: [] as string[],
        };
        if (input.dryRun || resultado.celdas.length === 0) return { ...informe, importadas: 0 };

        const ultimoOrden = calendar.entries.reduce(
          (max, entry) => Math.max(max, entry.sortOrder),
          -1,
        );
        if (input.taxTypeId) {
          const impuesto = await tx.taxType.findUnique({ where: { id: input.taxTypeId }, select: { id: true } });
          if (!impuesto) {
            throw new TaxCalendarError("CALENDAR_REFERENCE_NOT_FOUND", "El impuesto elegido no existe en el catálogo", {
              path: ["taxTypeId"],
            });
          }
        }
        const filas = resultado.celdas.map((celda, indice) => ({
          ...importedEntryFields(ctx, celda, ultimoOrden + 1 + indice),
          // Sin impuesto elegido, la celda queda sin impuesto (como hasta ahora) y no liga obligaciones.
          taxTypeId: input.taxTypeId ?? null,
          firmId: ctx.firmId,
          calendarId,
        }));
        for (let inicio = 0; inicio < filas.length; inicio += LOTE_IMPORTACION) {
          await tx.taxCalendarEntry.createMany({
            data: filas.slice(inicio, inicio + LOTE_IMPORTACION),
          });
        }
        await recordAudit(tx, ctx, "tax_calendar.entries_imported", calendarId, null, {
          filas: resultado.totalFilas,
          importadas: filas.length,
          filasRechazadas: new Set(resultado.rechazadas.map((rechazo) => rechazo.fila)).size,
        });
        return { ...informe, importadas: filas.length };
      },
      { timeout: 30_000 },
    );
  }

  /** Edita una celda de un borrador. Se valida el resultado combinado. */
  async updateEntry(ctx: TenantContext, calendarId: string, entryId: string, patch: TaxCalendarEntryPatch) {
    return withTenantContext(ctx, async (tx) => {
      const calendar = await loadCalendar(tx, ctx.firmId, calendarId);
      assertDraft(calendar);
      const current = calendar.entries.find((entry) => entry.id === entryId);
      if (!current) {
        throw new TaxCalendarError("CALENDAR_ENTRY_NOT_FOUND", "La celda no existe en este calendario");
      }
      const input = taxCalendarEntryInputSchema.parse({ ...entryAsInput(current), ...patch });
      await assertReferences(tx, input);
      const updated = await tx.taxCalendarEntry.update({
        where: { id: entryId },
        data: entryFields(ctx, input, current.sortOrder),
      });
      await recordAudit(tx, ctx, "tax_calendar.entry_updated", calendarId, entrySnapshot(current), entrySnapshot(updated));
      return loadCalendar(tx, ctx.firmId, calendarId);
    });
  }

  /**
   * Quita una celda de un borrador (corte 2a-ii-a). Lo publicado u oculto no se
   * quita: se corrige con una versión nueva. Lectura, auditoría y borrado van en
   * la misma transacción.
   */
  async removeEntry(ctx: TenantContext, calendarId: string, entryId: string): Promise<void> {
    await withTenantContext(ctx, async (tx) => {
      const calendar = await loadCalendar(tx, ctx.firmId, calendarId);
      assertDraftForEntryRemoval(calendar);
      const entry = calendar.entries.find((item) => item.id === entryId);
      if (!entry) throw entryNotFound();
      await recordAudit(tx, ctx, "tax_calendar.entry_removed", calendarId, entrySnapshot(entry), null);
      const removed = await tx.taxCalendarEntry.deleteMany({
        where: { id: entryId, calendarId, firmId: ctx.firmId },
      });
      if (removed.count !== 1) {
        // Otra operación cambió el estado o la celda después de leerlos: se informa cuál.
        assertDraftForEntryRemoval(await loadCalendar(tx, ctx.firmId, calendarId));
        throw entryNotFound();
      }
    });
  }

  /** Informe de cobertura sin publicar: lo que la pantalla usa para decir qué falta (P1). */
  async validate(ctx: TenantContext, calendarId: string) {
    return withTenantContext(ctx, async (tx) => {
      const calendar = await loadCalendar(tx, ctx.firmId, calendarId);
      const holidays = await loadHolidays(tx, calendar.jurisdictionId, calendar.year);
      const report = validateCalendarCoverage(coverageEntries(calendar.entries), { year: calendar.year, holidays });
      return { calendarId, status: calendar.status, entries: calendar.entries.length, ...report };
    });
  }

  /**
   * Publica un borrador si la validación pasa. Oculta, en la misma transacción,
   * la versión visible anterior del mismo organismo, jurisdicción y año.
   */
  async publish(ctx: TenantContext, calendarId: string) {
    return withTenantContext(ctx, async (tx) => {
      const calendar = await loadCalendar(tx, ctx.firmId, calendarId);
      if (calendar.status !== "DRAFT") {
        throw new TaxCalendarError(
          "CALENDAR_NOT_DRAFT",
          calendar.status === "PUBLISHED"
            ? "El calendario ya está publicado"
            : "El calendario está oculto: mostralo para volver a usarlo",
          { path: ["status"] },
        );
      }
      const holidays = await loadHolidays(tx, calendar.jurisdictionId, calendar.year);
      const report = validateCalendarCoverage(coverageEntries(calendar.entries), { year: calendar.year, holidays });
      if (!report.canPublish) {
        const pending = report.problems.filter((problem) => problem.severity === "ERROR").length;
        throw new TaxCalendarError(
          "CALENDAR_VALIDATION_FAILED",
          `El calendario no se puede publicar: quedan ${pending} problema${pending === 1 ? "" : "s"} por resolver`,
          { problems: report.problems },
        );
      }

      const previous = await tx.taxCalendar.findFirst({
        where: {
          firmId: ctx.firmId,
          taxAuthorityId: calendar.taxAuthorityId,
          jurisdictionId: calendar.jurisdictionId,
          year: calendar.year,
          status: "PUBLISHED",
        },
      });
      const now = new Date();
      if (previous) {
        const hidden = await tx.taxCalendar.update({
          where: { id: previous.id },
          data: { status: "HIDDEN", hiddenByUserId: ctx.userId, hiddenAt: now },
        });
        await recordAudit(tx, ctx, "tax_calendar.hidden_on_publish", previous.id, snapshot(previous), snapshot(hidden));
      }
      const published = await tx.taxCalendar.update({
        where: { id: calendarId },
        data: { status: "PUBLISHED", publishedByUserId: ctx.userId, publishedAt: now },
        include: calendarInclude,
      });
      await recordAudit(tx, ctx, "tax_calendar.published", calendarId, snapshot(calendar), snapshot(published));
      return { calendar: published, hiddenCalendarId: previous?.id ?? null };
    }).catch((err: unknown) => {
      if (isPrismaUniqueViolation(err)) {
        throw new TaxCalendarError(
          "CALENDAR_VERSION_CONFLICT",
          "Otra versión de este calendario se publicó al mismo tiempo. Actualizá y volvé a intentarlo.",
        );
      }
      throw err;
    });
  }

  /** Crea una versión nueva en borrador con las celdas copiadas y supersedesId. */
  async createFrom(ctx: TenantContext, calendarId: string) {
    return withTenantContext(ctx, async (tx) => {
      const source = await loadCalendar(tx, ctx.firmId, calendarId);
      const scope = { taxAuthorityId: source.taxAuthorityId, jurisdictionId: source.jurisdictionId, year: source.year };
      const version = await nextVersion(tx, ctx.firmId, scope);
      const created = await tx.taxCalendar.create({
        data: {
          firmId: ctx.firmId,
          ...scope,
          title: source.title,
          version,
          status: "DRAFT",
          sourceId: source.sourceId,
          supersedesId: source.id,
          createdByUserId: ctx.userId,
        },
      });
      if (source.entries.length > 0) {
        await tx.taxCalendarEntry.createMany({
          data: source.entries.map((entry) => ({
            firmId: ctx.firmId,
            calendarId: created.id,
            conceptLabel: entry.conceptLabel,
            taxTypeId: entry.taxTypeId,
            regimeId: entry.regimeId,
            groupingKind: entry.groupingKind,
            endingDigits: entry.endingDigits,
            zoneCode: entry.zoneCode,
            referencePeriodStart: entry.referencePeriodStart,
            referencePeriodEnd: entry.referencePeriodEnd,
            referenceLabel: entry.referenceLabel,
            dueDate: entry.dueDate,
            dueDateRaw: entry.dueDateRaw,
            adjustment: entry.adjustment,
            noteRef: entry.noteRef,
            noteText: entry.noteText,
            sortOrder: entry.sortOrder,
            reviewState: entry.reviewState,
            reviewedByUserId: entry.reviewedByUserId,
            reviewedAt: entry.reviewedAt,
          })),
        });
      }
      const result = await loadCalendar(tx, ctx.firmId, created.id);
      await recordAudit(tx, ctx, "tax_calendar.version_created", created.id, null, {
        ...snapshot(result),
        copiedFrom: source.id,
        entries: result.entries.length,
      });
      return result;
    });
  }

  /** Oculta un calendario publicado. Es reversible. */
  async hide(ctx: TenantContext, calendarId: string) {
    return withTenantContext(ctx, async (tx) => {
      const current = await loadCalendar(tx, ctx.firmId, calendarId);
      if (current.status !== "PUBLISHED") {
        throw new TaxCalendarError("CALENDAR_NOT_PUBLISHED", "Solo se oculta un calendario publicado", {
          path: ["status"],
        });
      }
      const hidden = await tx.taxCalendar.update({
        where: { id: calendarId },
        data: { status: "HIDDEN", hiddenByUserId: ctx.userId, hiddenAt: new Date() },
        include: calendarInclude,
      });
      await recordAudit(tx, ctx, "tax_calendar.hidden", calendarId, snapshot(current), snapshot(hidden));
      return hidden;
    });
  }

  /**
   * Vuelve a mostrar una versión oculta. Si hay una visible del mismo alcance,
   * esa pasa a oculta en la misma transacción y la respuesta lo informa.
   */
  async show(ctx: TenantContext, calendarId: string) {
    return withTenantContext(ctx, async (tx) => {
      const current = await loadCalendar(tx, ctx.firmId, calendarId);
      if (current.status !== "HIDDEN") {
        throw new TaxCalendarError("CALENDAR_NOT_HIDDEN", "Solo se muestra un calendario oculto", {
          path: ["status"],
        });
      }
      const visible = await tx.taxCalendar.findFirst({
        where: {
          firmId: ctx.firmId,
          taxAuthorityId: current.taxAuthorityId,
          jurisdictionId: current.jurisdictionId,
          year: current.year,
          status: "PUBLISHED",
        },
      });
      const now = new Date();
      if (visible) {
        const hiddenVisible = await tx.taxCalendar.update({
          where: { id: visible.id },
          data: { status: "HIDDEN", hiddenByUserId: ctx.userId, hiddenAt: now },
        });
        await recordAudit(tx, ctx, "tax_calendar.hidden_on_show", visible.id, snapshot(visible), snapshot(hiddenVisible));
      }
      const shown = await tx.taxCalendar.update({
        where: { id: calendarId },
        data: { status: "PUBLISHED", publishedByUserId: ctx.userId, publishedAt: now },
        include: calendarInclude,
      });
      await recordAudit(tx, ctx, "tax_calendar.shown", calendarId, snapshot(current), snapshot(shown));
      return { calendar: shown, hiddenCalendarId: visible?.id ?? null };
    }).catch((err: unknown) => {
      if (isPrismaUniqueViolation(err)) {
        throw new TaxCalendarError(
          "CALENDAR_VERSION_CONFLICT",
          "Otra versión se mostró al mismo tiempo. Actualizá y volvé a intentarlo.",
        );
      }
      throw err;
    });
  }
}
