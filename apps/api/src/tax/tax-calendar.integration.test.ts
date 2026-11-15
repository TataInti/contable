import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { TaxCalendarError, TaxCalendarRegistryService } from "./tax-calendar-service.js";
import { taxCalendarRoutes } from "./tax-calendar-routes.js";
import { assertCapability, requiredCapability } from "../auth/guard.js";
import { capabilitiesForRole } from "@contable/permissions";

/**
 * Calendarios fiscales contra PostgreSQL desechable (corte 2a-i): flujo de
 * versiones, cobertura al publicar, índice parcial, RLS por firma, grants sin
 * borrado y rutas. Las pruebas de RLS usan el rol de runtime, como las demás.
 */

const OWNER = "c1a10000-0000-4000-8000-000000000001";
const OTHER_OWNER = "c1a10000-0000-4000-8000-000000000002";
const FIRM = "c1a20000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "c1a20000-0000-4000-8000-00000000000b";
const JURISDICTION_CODE = "CAL2A-TEST-NAC";
const AUTHORITY_CODE = "CAL2A-TEST-ORG";

const runtimePrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.RUNTIME_DATABASE_URL ?? "" }),
});

const service = new TaxCalendarRegistryService();
const ctx = { userId: OWNER, firmId: FIRM, actorKind: "USER" as const };

let jurisdictionId = "";
let taxAuthorityId = "";

async function setupFixtures() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER}', 'owner.cal2a@test.local', 'Titular Cal', 'x', now()),
           ('${OTHER_OWNER}', 'owner.other.cal2a@test.local', 'Titular Otro', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM}', 'Estudio Cal 2a', 'Estudio Cal 2a', now()),
           ('${OTHER_FIRM}', 'Estudio Otro Cal 2a', 'Estudio Otro Cal 2a', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM}', '${OWNER}', 'OWNER', 'ACTIVE', now()),
           (gen_random_uuid()::text, '${OTHER_FIRM}', '${OTHER_OWNER}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
  const jurisdiction = await prisma.jurisdiction.upsert({
    where: { code: JURISDICTION_CODE },
    create: { code: JURISDICTION_CODE, name: "Nación (prueba calendarios 2a-i)", kind: "NATIONAL" },
    update: {},
  });
  const authority = await prisma.taxAuthority.upsert({
    where: { code: AUTHORITY_CODE },
    create: { code: AUTHORITY_CODE, name: "Organismo de prueba 2a-i", jurisdictionId: jurisdiction.id },
    update: {},
  });
  jurisdictionId = jurisdiction.id;
  taxAuthorityId = authority.id;
}

/** Borra los calendarios del estudio de prueba: celdas primero, luego calendarios (autorreferencia en una sentencia). */
async function clearCalendars() {
  await prisma.$executeRawUnsafe(`DELETE FROM tax_calendar_entries WHERE "firmId" IN ('${FIRM}', '${OTHER_FIRM}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM tax_calendars WHERE "firmId" IN ('${FIRM}', '${OTHER_FIRM}')`);
}

function row(endingDigits: string, dueDate: string, extra: Partial<{ start: string; end: string }> = {}) {
  return {
    conceptLabel: "IVA — DDJJ",
    groupingKind: "ENDING_DIGITS" as const,
    endingDigits,
    referencePeriodStart: extra.start ?? "2026-01-01",
    referencePeriodEnd: extra.end ?? "2026-01-31",
    referenceLabel: "IVA enero",
    dueDate,
  };
}

const COBERTURA_COMPLETA = [
  row("01", "2026-01-19"),
  row("23", "2026-01-20"),
  row("45", "2026-01-21"),
  row("67", "2026-01-22"),
  row("89", "2026-01-23"),
];

async function newDraft(year: number, title = "Calendario de prueba") {
  return service.create(ctx, { taxAuthorityId, jurisdictionId, year, title });
}

async function fillDraft(calendarId: string, entries: ReturnType<typeof row>[]) {
  let calendar = await service.get(ctx, calendarId);
  for (const entry of entries) {
    calendar = await service.addEntry(ctx, calendarId, entry);
  }
  return calendar;
}

async function runAsRuntime<T>(
  userId: string,
  firmId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  actorKind = "USER",
) {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${userId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${firmId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', '${actorKind}', true)`);
    return fn(tx);
  });
}

beforeEach(async () => {
  await setupFixtures();
  await clearCalendars();
});

afterAll(async () => {
  await clearCalendars();
  await prisma.taxAuthority.deleteMany({ where: { code: AUTHORITY_CODE } });
  await prisma.jurisdiction.deleteMany({ where: { code: JURISDICTION_CODE } });
  await runtimePrisma.$disconnect();
});

describe("calendarios: borrador, cobertura y publicación", () => {
  it("crea un borrador, carga celdas, valida y publica con cobertura completa", async () => {
    const draft = await newDraft(2026);
    expect(draft).toMatchObject({ status: "DRAFT", version: 1, year: 2026, supersedesId: null });

    const filled = await fillDraft(draft.id, COBERTURA_COMPLETA);
    expect(filled.entries).toHaveLength(5);
    expect(filled.entries.every((entry) => entry.reviewState === "REVIEWED")).toBe(true);

    const report = await service.validate(ctx, draft.id);
    expect(report.canPublish).toBe(true);

    const published = await service.publish(ctx, draft.id);
    expect(published.hiddenCalendarId).toBeNull();
    expect(published.calendar).toMatchObject({ status: "PUBLISHED", publishedByUserId: OWNER });
  });

  it("no publica con cobertura incompleta y devuelve campo y motivo de cada problema", async () => {
    const draft = await newDraft(2026);
    await fillDraft(draft.id, [row("0123", "2026-01-19")]);

    const error = await service.publish(ctx, draft.id).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TaxCalendarError);
    const failure = error as TaxCalendarError;
    expect(failure.code).toBe("CALENDAR_VALIDATION_FAILED");
    expect(failure.problems).toEqual([
      expect.objectContaining({
        field: "entries[0].endingDigits",
        message: expect.stringContaining("faltan los dígitos 4, 5, 6, 7, 8 y 9"),
      }),
    ]);
    const stillDraft = await service.get(ctx, draft.id);
    expect(stillDraft.status).toBe("DRAFT");
  });

  it("una versión publicada no se edita: crear a partir de este genera una versión nueva con copia", async () => {
    const v1 = await newDraft(2026, "Calendario 2026");
    await fillDraft(v1.id, COBERTURA_COMPLETA);
    await service.publish(ctx, v1.id);

    await expect(service.update(ctx, v1.id, { title: "Cambio no permitido" })).rejects.toMatchObject({
      code: "CALENDAR_NOT_DRAFT",
    });
    await expect(
      service.addEntry(ctx, v1.id, row("0123", "2026-01-19")),
    ).rejects.toMatchObject({ code: "CALENDAR_NOT_DRAFT" });

    const v2 = await service.createFrom(ctx, v1.id);
    expect(v2).toMatchObject({ status: "DRAFT", version: 2, supersedesId: v1.id, title: "Calendario 2026" });
    expect(v2.entries).toHaveLength(5);

    const corrected = await service.update(ctx, v2.id, { title: "Calendario 2026 corregido" });
    expect(corrected.title).toBe("Calendario 2026 corregido");

    const published = await service.publish(ctx, v2.id);
    expect(published.hiddenCalendarId).toBe(v1.id);
    const visibles = await prisma.taxCalendar.findMany({
      where: { firmId: FIRM, taxAuthorityId, jurisdictionId, year: 2026, status: "PUBLISHED" },
      select: { id: true },
    });
    expect(visibles.map((c) => c.id)).toEqual([v2.id]);
  });

  it("mostrar una versión oculta intercambia con la visible y lo informa; ocultar es reversible", async () => {
    const v1 = await newDraft(2026);
    await fillDraft(v1.id, COBERTURA_COMPLETA);
    await service.publish(ctx, v1.id);
    const v2 = await service.createFrom(ctx, v1.id);
    await service.publish(ctx, v2.id);

    const shown = await service.show(ctx, v1.id);
    expect(shown.hiddenCalendarId).toBe(v2.id);
    expect(shown.calendar.status).toBe("PUBLISHED");
    expect((await service.get(ctx, v2.id)).status).toBe("HIDDEN");

    const hidden = await service.hide(ctx, v1.id);
    expect(hidden.status).toBe("HIDDEN");
    const shownAgain = await service.show(ctx, v2.id);
    expect(shownAgain.hiddenCalendarId).toBeNull();
    expect(shownAgain.calendar.status).toBe("PUBLISHED");
  });

  it("el índice único parcial impide dos versiones visibles para el mismo alcance", async () => {
    const v1 = await newDraft(2026);
    await fillDraft(v1.id, COBERTURA_COMPLETA);
    await service.publish(ctx, v1.id);
    const v2 = await newDraft(2026);
    await fillDraft(v2.id, COBERTURA_COMPLETA);
    await expect(
      prisma.taxCalendar.update({ where: { id: v2.id }, data: { status: "PUBLISHED" } }),
    ).rejects.toThrow(/tax_calendars_one_published_key|unique/i);
  });

  it("ocultar solo aplica a lo publicado y mostrar solo a lo oculto", async () => {
    const draft = await newDraft(2026);
    await expect(service.hide(ctx, draft.id)).rejects.toMatchObject({ code: "CALENDAR_NOT_PUBLISHED" });
    await expect(service.show(ctx, draft.id)).rejects.toMatchObject({ code: "CALENDAR_NOT_HIDDEN" });
  });
});

describe("calendarios: RLS, grants y rol de runtime", () => {
  it("otra firma no ve el calendario (RLS por firma)", async () => {
    const draft = await newDraft(2026);
    const propia = await runAsRuntime(OWNER, FIRM, (tx) => tx.taxCalendar.count({ where: { id: draft.id } }));
    expect(propia).toBe(1);
    const ajena = await runAsRuntime(OTHER_OWNER, OTHER_FIRM, (tx) => tx.taxCalendar.count({ where: { id: draft.id } }));
    expect(ajena).toBe(0);
  });

  it("el runtime no tiene permiso de borrado sobre tax_calendars", async () => {
    const draft = await newDraft(2026);
    await expect(
      runAsRuntime(OWNER, FIRM, (tx) => tx.$executeRawUnsafe(`DELETE FROM tax_calendars WHERE id = '${draft.id}'`)),
    ).rejects.toThrow(/permission denied|permiso/i);
  });

  it("el portal no escribe calendarios", async () => {
    await expect(
      runAsRuntime(
        OWNER,
        FIRM,
        (tx) =>
          tx.taxCalendar.create({
            data: {
              firmId: FIRM,
              taxAuthorityId,
              jurisdictionId,
              year: 2026,
              title: "Escritura de portal",
              createdByUserId: OWNER,
            },
          }),
        "PORTAL",
      ),
    ).rejects.toThrow(/row-level security|violates row-level/i);
  });

  it("el runtime no puede evadir RLS: sin BYPASSRLS, sin ser dueño de las tablas y sin cambiar de rol (T-009)", async () => {
    const atributos = await runAsRuntime(OWNER, FIRM, (tx) =>
      tx.$queryRawUnsafe<{ rolbypassrls: boolean }[]>("SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user"),
    );
    expect(atributos[0]?.rolbypassrls).toBe(false);
    // Sin DDL: desactivar RLS exige ser dueño de la tabla; el runtime no lo es ni es miembro del dueño.
    const dueno = await runAsRuntime(OWNER, FIRM, (tx) =>
      tx.$queryRawUnsafe<{ esDueno: boolean }[]>(
        "SELECT pg_has_role(current_user, relowner, 'MEMBER') AS \"esDueno\" FROM pg_class WHERE relname = 'tax_calendars'",
      ),
    );
    expect(dueno[0]?.esDueno).toBe(false);
    await expect(
      runAsRuntime(OWNER, FIRM, (tx) => tx.$executeRawUnsafe("SET ROLE contable")),
    ).rejects.toThrow(/permission denied|permiso/i);
  });

});

describe("calendarios: baja de celdas en borrador (corte 2a-ii-a): grant y RLS", () => {
  async function primeraCelda(calendarId: string): Promise<string> {
    const { entries } = await service.get(ctx, calendarId);
    const primera = entries[0];
    if (!primera) throw new Error("el calendario de prueba no tiene celdas");
    return primera.id;
  }

  /** v1 queda oculta al publicar v2; v2 queda publicada; un borrador de 2027 conserva sus celdas. */
  async function escenarioBaja() {
    const v1 = await newDraft(2026, "Calendario 2026 v1");
    await fillDraft(v1.id, COBERTURA_COMPLETA);
    await service.publish(ctx, v1.id);
    const v2 = await service.createFrom(ctx, v1.id);
    await service.publish(ctx, v2.id);
    const borrador = await newDraft(2027, "Calendario 2027");
    await fillDraft(borrador.id, COBERTURA_COMPLETA);
    return {
      celdaOculta: await primeraCelda(v1.id),
      celdaPublicada: await primeraCelda(v2.id),
      celdaBorrador: await primeraCelda(borrador.id),
    };
  }

  it("el runtime tiene borrado solo sobre tax_calendar_entries", async () => {
    const filas = await prisma.$queryRawUnsafe<{ tabla: string; borrado: boolean }[]>(
      `SELECT t.tabla, has_table_privilege('contable_runtime', t.tabla, 'DELETE') AS borrado
       FROM (VALUES ('tax_calendar_sources'), ('tax_calendars'), ('tax_calendar_entries')) AS t(tabla)`,
    );
    expect(Object.fromEntries(filas.map((fila) => [fila.tabla, fila.borrado]))).toEqual({
      tax_calendar_entries: true,
      tax_calendar_sources: false,
      tax_calendars: false,
    });
  });

  it("RLS: un DELETE directo con el rol de runtime no borra celdas publicadas, ocultas ni de otra firma; sí las de un borrador propio", async () => {
    const { celdaOculta, celdaPublicada, celdaBorrador } = await escenarioBaja();

    const enPublicado = await runAsRuntime(OWNER, FIRM, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM tax_calendar_entries WHERE id = '${celdaPublicada}'`),
    );
    expect(enPublicado).toBe(0);
    const enOculto = await runAsRuntime(OWNER, FIRM, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM tax_calendar_entries WHERE id = '${celdaOculta}'`),
    );
    expect(enOculto).toBe(0);
    const deOtraFirma = await runAsRuntime(OTHER_OWNER, OTHER_FIRM, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM tax_calendar_entries WHERE id = '${celdaBorrador}'`),
    );
    expect(deOtraFirma).toBe(0);
    const sobrevivientes = await prisma.taxCalendarEntry.count({
      where: { id: { in: [celdaPublicada, celdaOculta, celdaBorrador] } },
    });
    expect(sobrevivientes).toBe(3);

    const enBorrador = await runAsRuntime(OWNER, FIRM, (tx) =>
      tx.$executeRawUnsafe(`DELETE FROM tax_calendar_entries WHERE id = '${celdaBorrador}'`),
    );
    expect(enBorrador).toBe(1);
    expect(await prisma.taxCalendarEntry.count({ where: { id: celdaBorrador } })).toBe(0);
  });

  it("RLS: el portal no borra celdas, ni siquiera de un borrador de la firma", async () => {
    const borrador = await newDraft(2027);
    await fillDraft(borrador.id, COBERTURA_COMPLETA);
    const celda = await primeraCelda(borrador.id);
    const borradas = await runAsRuntime(
      OWNER,
      FIRM,
      (tx) => tx.$executeRawUnsafe(`DELETE FROM tax_calendar_entries WHERE id = '${celda}'`),
      "PORTAL",
    );
    expect(borradas).toBe(0);
    expect(await prisma.taxCalendarEntry.count({ where: { id: celda } })).toBe(1);
  });
});

describe("calendarios: rutas de la API", () => {
  function buildApp() {
    const app = Fastify({ logger: false });
    app.addHook("preHandler", async (req) => {
      Object.assign(req, { userId: OWNER, firmId: FIRM });
    });
    taxCalendarRoutes(app);
    return app;
  }

  it("crea, carga celdas, valida, publica y responde 422 con motivos y 409 al editar lo publicado", async () => {
    const app = buildApp();
    await app.ready();
    try {
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars`,
        payload: { taxAuthorityId, jurisdictionId, year: 2026, title: "Calendario por API" },
      });
      expect(created.statusCode).toBe(201);
      const calendarId = created.json().data.id as string;

      for (const entry of COBERTURA_COMPLETA) {
        const added = await app.inject({
          method: "POST",
          url: `/api/v1/firms/${FIRM}/tax-calendars/${calendarId}/entries`,
          payload: {
            conceptLabel: entry.conceptLabel,
            groupingKind: entry.groupingKind,
            endingDigits: entry.endingDigits,
            referencePeriodStart: entry.referencePeriodStart,
            referencePeriodEnd: entry.referencePeriodEnd,
            referenceLabel: entry.referenceLabel,
            dueDate: entry.dueDate,
          },
        });
        expect(added.statusCode).toBe(201);
      }

      const validation = await app.inject({
        method: "GET",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${calendarId}/validation`,
      });
      expect(validation.json().data.canPublish).toBe(true);

      const published = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${calendarId}/publish`,
      });
      expect(published.statusCode).toBe(200);
      expect(published.json().data.calendar.status).toBe("PUBLISHED");

      const editPublished = await app.inject({
        method: "PATCH",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${calendarId}`,
        payload: { title: "No se edita" },
      });
      expect(editPublished.statusCode).toBe(409);
      expect(editPublished.json().error.code).toBe("CALENDAR_NOT_DRAFT");

      const invalidDate = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars`,
        payload: { taxAuthorityId, jurisdictionId, year: 2026, title: "Fecha inválida" },
      });
      const other = invalidDate.json().data.id as string;
      const badEntry = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${other}/entries`,
        payload: { conceptLabel: "IVA", groupingKind: "ENDING_DIGITS", endingDigits: "0123", dueDate: "2026-02-30" },
      });
      expect(badEntry.statusCode).toBe(400);
      expect(badEntry.json().error.details[0]).toEqual(expect.objectContaining({ path: ["dueDate"] }));

      const incomplete = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${other}/publish`,
      });
      expect(incomplete.statusCode).toBe(422);
      expect(incomplete.json().error.code).toBe("CALENDAR_VALIDATION_FAILED");
      expect(incomplete.json().error.details.problems.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("otra firma recibe 404 y no revela que el calendario existe por ID conocido (T-003)", async () => {
    const draft = await newDraft(2026, "Calendario de la firma A");
    const app = Fastify({ logger: false });
    app.addHook("preHandler", async (req) => {
      Object.assign(req, { userId: OTHER_OWNER, firmId: OTHER_FIRM, actorKind: "USER" });
    });
    taxCalendarRoutes(app);
    await app.ready();
    try {
      const res = await app.inject({ method: "GET", url: `/api/v1/firms/${OTHER_FIRM}/tax-calendars/${draft.id}` });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("CALENDAR_NOT_FOUND");
    } finally {
      await app.close();
    }
  });
});

describe("calendarios: baja de celdas en borrador (corte 2a-ii-a): servicio y rutas", () => {
  const DUPLICADA = row("01", "2026-01-24");
  const MENSAJE_NO_BORRADOR = "Este calendario está publicado (u oculto): para corregirlo, creá una versión nueva a partir de este.";

  async function celdaCon(calendarId: string, dueDate: string): Promise<string> {
    const celda = await prisma.taxCalendarEntry.findFirst({
      where: { calendarId, dueDate: new Date(`${dueDate}T00:00:00.000Z`) },
      select: { id: true },
    });
    if (!celda) throw new Error(`no hay celda con vencimiento ${dueDate}`);
    return celda.id;
  }

  /** v1 queda oculta al publicar v2; v2 queda publicada. Ambas con cobertura completa. */
  async function publicadaYOculta() {
    const v1 = await newDraft(2026);
    await fillDraft(v1.id, COBERTURA_COMPLETA);
    await service.publish(ctx, v1.id);
    const v2 = await service.createFrom(ctx, v1.id);
    await service.publish(ctx, v2.id);
    return { oculta: v1.id, publicada: v2.id };
  }

  function appComo(userId: string, firmId: string) {
    const app = Fastify({ logger: false });
    app.addHook("preHandler", async (req) => {
      Object.assign(req, { userId, firmId });
    });
    taxCalendarRoutes(app);
    return app;
  }

  it("quita una celda de un borrador: la cobertura cambia, queda auditoría con la celda anterior y el calendario se publica", async () => {
    const draft = await newDraft(2026);
    await fillDraft(draft.id, COBERTURA_COMPLETA);
    await service.addEntry(ctx, draft.id, DUPLICADA);
    const extra = await celdaCon(draft.id, "2026-01-24");
    expect((await service.validate(ctx, draft.id)).canPublish).toBe(false);

    await service.removeEntry(ctx, draft.id, extra);
    expect(await prisma.taxCalendarEntry.count({ where: { id: extra } })).toBe(0);
    expect((await service.validate(ctx, draft.id)).canPublish).toBe(true);
    const { calendar } = await service.publish(ctx, draft.id);
    expect(calendar).toMatchObject({ status: "PUBLISHED" });

    const auditoria = await prisma.auditEvent.findMany({
      where: { firmId: FIRM, action: "tax_calendar.entry_removed", entityId: draft.id },
    });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      userId: OWNER,
      before: expect.objectContaining({ id: extra, endingDigits: "01", dueDate: "2026-01-24" }),
      after: null,
    });
  });

  it("no quita celdas de un calendario publicado ni oculto: responde 409 y dice qué hacer; la celda sigue", async () => {
    const { oculta, publicada } = await publicadaYOculta();
    const celdaPublicada = await celdaCon(publicada, "2026-01-19");
    const celdaOculta = await celdaCon(oculta, "2026-01-19");

    await expect(service.removeEntry(ctx, publicada, celdaPublicada)).rejects.toMatchObject({
      code: "CALENDAR_NOT_DRAFT",
      httpStatus: 409,
      message: MENSAJE_NO_BORRADOR,
      path: ["status"],
    });
    await expect(service.removeEntry(ctx, oculta, celdaOculta)).rejects.toMatchObject({
      code: "CALENDAR_NOT_DRAFT",
      httpStatus: 409,
      message: MENSAJE_NO_BORRADOR,
      path: ["status"],
    });
    expect(await prisma.taxCalendarEntry.count({ where: { id: { in: [celdaPublicada, celdaOculta] } } })).toBe(2);
  });

  it("una celda de otro calendario o de otro estudio responde 404 y no se borra", async () => {
    const a = await newDraft(2026);
    await fillDraft(a.id, COBERTURA_COMPLETA);
    const b = await newDraft(2027);
    await fillDraft(b.id, COBERTURA_COMPLETA);
    const celdaDeA = await celdaCon(a.id, "2026-01-19");
    const celdaDeB = await celdaCon(b.id, "2026-01-19");

    await expect(service.removeEntry(ctx, a.id, celdaDeB)).rejects.toMatchObject({
      code: "CALENDAR_ENTRY_NOT_FOUND",
      httpStatus: 404,
    });
    const otroEstudio = { userId: OTHER_OWNER, firmId: OTHER_FIRM, actorKind: "USER" as const };
    await expect(service.removeEntry(otroEstudio, a.id, celdaDeA)).rejects.toMatchObject({
      code: "CALENDAR_NOT_FOUND",
      httpStatus: 404,
    });
    expect(await prisma.taxCalendarEntry.count({ where: { id: { in: [celdaDeA, celdaDeB] } } })).toBe(2);
  });

  it("DELETE responde 204 y la celda sale del borrador; validación y publicación funcionan después", async () => {
    const draft = await newDraft(2026);
    await fillDraft(draft.id, COBERTURA_COMPLETA);
    await service.addEntry(ctx, draft.id, DUPLICADA);
    const extra = await celdaCon(draft.id, "2026-01-24");
    const app = appComo(OWNER, FIRM);
    await app.ready();
    try {
      const base = `/api/v1/firms/${FIRM}/tax-calendars/${draft.id}`;
      expect((await app.inject({ method: "GET", url: `${base}/validation` })).json().data.canPublish).toBe(false);

      const borrada = await app.inject({ method: "DELETE", url: `${base}/entries/${extra}` });
      expect(borrada.statusCode).toBe(204);
      expect(borrada.body).toBe("");
      expect(await prisma.taxCalendarEntry.count({ where: { id: extra } })).toBe(0);

      expect((await app.inject({ method: "GET", url: `${base}/validation` })).json().data.canPublish).toBe(true);
      const publicado = await app.inject({ method: "POST", url: `${base}/publish` });
      expect(publicado.statusCode).toBe(200);
      expect(publicado.json().data.calendar.status).toBe("PUBLISHED");
    } finally {
      await app.close();
    }
  });

  it("DELETE sobre un calendario publicado responde 409 con código, mensaje y campo; la celda sigue", async () => {
    const { publicada } = await publicadaYOculta();
    const celda = await celdaCon(publicada, "2026-01-19");
    const app = appComo(OWNER, FIRM);
    await app.ready();
    try {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${publicada}/entries/${celda}`,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toEqual({
        code: "CALENDAR_NOT_DRAFT",
        message: MENSAJE_NO_BORRADOR,
        details: { path: ["status"] },
      });
      expect(await prisma.taxCalendarEntry.count({ where: { id: celda } })).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("DELETE desde otra firma responde 404 de calendario; con una celda de otro calendario, 404 de celda", async () => {
    const a = await newDraft(2026);
    await fillDraft(a.id, COBERTURA_COMPLETA);
    const b = await newDraft(2027);
    await fillDraft(b.id, COBERTURA_COMPLETA);
    const celdaDeA = await celdaCon(a.id, "2026-01-19");
    const celdaDeB = await celdaCon(b.id, "2026-01-19");
    const ajena = appComo(OTHER_OWNER, OTHER_FIRM);
    const propia = appComo(OWNER, FIRM);
    await ajena.ready();
    await propia.ready();
    try {
      const otraFirma = await ajena.inject({
        method: "DELETE",
        url: `/api/v1/firms/${OTHER_FIRM}/tax-calendars/${a.id}/entries/${celdaDeA}`,
      });
      expect(otraFirma.statusCode).toBe(404);
      expect(otraFirma.json().error.code).toBe("CALENDAR_NOT_FOUND");

      const otroCalendario = await propia.inject({
        method: "DELETE",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${a.id}/entries/${celdaDeB}`,
      });
      expect(otroCalendario.statusCode).toBe(404);
      expect(otroCalendario.json().error.code).toBe("CALENDAR_ENTRY_NOT_FOUND");
      expect(await prisma.taxCalendarEntry.count({ where: { id: { in: [celdaDeA, celdaDeB] } } })).toBe(2);
    } finally {
      await ajena.close();
      await propia.close();
    }
  });
});

describe("calendarios: baja de celdas: capacidad por rol (tax.calendars.manage)", () => {
  it("quitar una celda exige tax.calendars.manage: OWNER, ADMIN y PREPARER pasan; REVIEWER y AUDITOR_READONLY reciben 403", () => {
    expect(requiredCapability("DELETE", "/api/v1/firms/:p/tax-calendars/:p/entries/:p")).toBe("tax.calendars.manage");
    for (const role of ["OWNER", "ADMIN", "PREPARER"] as const) {
      expect(() => assertCapability({ capabilities: capabilitiesForRole(role) } as never, "tax.calendars.manage"), role).not.toThrow();
    }
    for (const role of ["REVIEWER", "AUDITOR_READONLY"] as const) {
      expect(
        () => assertCapability({ capabilities: capabilitiesForRole(role) } as never, "tax.calendars.manage"),
        role,
      ).toThrow(expect.objectContaining({ statusCode: 403, code: "CAPABILITY_REQUIRED" }));
    }
  });
});
