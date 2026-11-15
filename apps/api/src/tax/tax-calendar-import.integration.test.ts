import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { capabilitiesForRole } from "@contable/permissions";
import { prisma } from "../lib/prisma.js";
import { assertCapability, requiredCapability } from "../auth/guard.js";
import { TaxCalendarError, TaxCalendarRegistryService } from "./tax-calendar-service.js";
import { taxCalendarRoutes } from "./tax-calendar-routes.js";

/**
 * Importación de celdas desde CSV contra PostgreSQL desechable (corte 2b-1): servicio, ruta,
 * dryRun, transacción, duplicados, estado del calendario, permiso, RLS y cobertura posterior.
 * Los extractos son filas reales de los tres CSV verificados (__fixtures__).
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const extracto = (nombre: string) => readFileSync(join(FIXTURES, nombre), "utf8");

const OWNER = "c2b10000-0000-4000-8000-000000000001";
const OTHER_OWNER = "c2b10000-0000-4000-8000-000000000002";
const FIRM = "c2b20000-0000-4000-8000-00000000000a";
const OTHER_FIRM = "c2b20000-0000-4000-8000-00000000000b";
const JURISDICTION_CODE = "CAL2B1-TEST-NAC";
const AUTHORITY_CODE = "CAL2B1-TEST-ORG";
const ENCABEZADO =
  "calendario,bloque,concepto,periodo_referencia,criterio_agrupacion,digitos,fecha_completa,nota,origen_celda,confianza,verificado_en_imagen";

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
    VALUES ('${OWNER}', 'owner.cal2b1@test.local', 'Titular Cal 2b1', 'x', now()),
           ('${OTHER_OWNER}', 'owner.other.cal2b1@test.local', 'Titular Otro 2b1', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM}', 'Estudio Cal 2b1', 'Estudio Cal 2b1', now()),
           ('${OTHER_FIRM}', 'Estudio Otro Cal 2b1', 'Estudio Otro Cal 2b1', now())
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
    create: { code: JURISDICTION_CODE, name: "Nación (prueba calendarios 2b-1)", kind: "NATIONAL" },
    update: {},
  });
  const authority = await prisma.taxAuthority.upsert({
    where: { code: AUTHORITY_CODE },
    create: {
      code: AUTHORITY_CODE,
      name: "Organismo de prueba 2b-1",
      jurisdictionId: jurisdiction.id,
    },
    update: {},
  });
  jurisdictionId = jurisdiction.id;
  taxAuthorityId = authority.id;
}

/** Borra los calendarios de los estudios de prueba: celdas primero, luego calendarios. */
async function clearCalendars() {
  await prisma.$executeRawUnsafe(
    `DELETE FROM tax_calendar_entries WHERE "firmId" IN ('${FIRM}', '${OTHER_FIRM}')`,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM tax_calendars WHERE "firmId" IN ('${FIRM}', '${OTHER_FIRM}')`,
  );
}

async function newDraft(year: number, title = "Calendario de importación 2b-1") {
  return service.create(ctx, { taxAuthorityId, jurisdictionId, year, title });
}

/** Una fila del formato de 11 columnas con valores válidos; cambiá lo que haga falta en `pisa`. */
function fila(concepto: string, pisa: Partial<Record<string, string>> = {}): string {
  const valores: Record<string, string> = {
    calendario: "nacional-2026",
    bloque: "BLOQUE PRUEBA",
    concepto,
    periodo_referencia: "2026-01",
    criterio_agrupacion: "terminación de CUIT",
    digitos: "0-3",
    fecha_completa: "2026-01-19",
    nota: "",
    origen_celda: "pág.1 · fila prueba · col.1 · recorte",
    confianza: "alta",
    verificado_en_imagen: "si",
    ...pisa,
  };
  return ENCABEZADO.split(",")
    .map((columna) => valores[columna] ?? "")
    .join(",");
}

const csvDe = (...filas: string[]) => [ENCABEZADO, ...filas].join("\r\n") + "\r\n";

async function contarCeldas(calendarId: string): Promise<number> {
  return prisma.taxCalendarEntry.count({ where: { calendarId } });
}

/** Cuenta las celdas de un calendario con el rol de runtime y la firma indicada (RLS). */
async function contarComoRuntime(
  userId: string,
  firmId: string,
  calendarId: string,
): Promise<number> {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${userId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${firmId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM tax_calendar_entries WHERE "calendarId" = $1`,
      calendarId,
    );
    return rows[0]?.n ?? 0;
  });
}

function appParaEstudio(userId: string, firmId: string) {
  const app = Fastify({ logger: false });
  app.addHook("preHandler", async (req) => {
    Object.assign(req, { userId, firmId, actorKind: "USER" });
  });
  taxCalendarRoutes(app);
  return app;
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

describe("calendarios: importación, prueba sin escritura (dryRun)", () => {
  it("dryRun devuelve el informe por fila y no escribe celdas ni auditoría", async () => {
    const borrador = await newDraft(2026);
    const informe = await service.importEntries(ctx, borrador.id, {
      csv: extracto("c0a-nacional-extracto.csv"),
      dryRun: true,
    });
    expect(informe).toMatchObject({
      dryRun: true,
      totalFilas: 12,
      validas: 11,
      importadas: 0,
      encabezadosFaltantes: [],
    });
    expect(informe.rechazadas.map((rechazo) => `${rechazo.fila} ${rechazo.columna}`)).toEqual([
      "8 digitos",
      "8 fecha_completa",
    ]);
    expect(informe.avisos).toHaveLength(6);
    expect(await contarCeldas(borrador.id)).toBe(0);
    const auditoria = await prisma.auditEvent.count({
      where: {
        entityType: "tax_calendar",
        entityId: borrador.id,
        action: "tax_calendar.entries_imported",
      },
    });
    expect(auditoria).toBe(0);
  });

  it("informa las columnas que el archivo trae y el importador no usa", async () => {
    const borrador = await newDraft(2026);
    const csv = `${ENCABEZADO},responsable\r\n${fila("IVA — DDJJ", { digitos: "0-9" })},Ana\r\n`;
    const informe = await service.importEntries(ctx, borrador.id, { csv, dryRun: true });
    expect(informe.columnasIgnoradas).toEqual(["responsable"]);
    expect(informe.validas).toBe(1);
  });
});

describe("calendarios: importación real (una transacción, dudosas, procedencia y auditoría)", () => {
  it("importa solo las filas válidas: dudosas en FLAGGED, el resto revisado por quien importa, con procedencia y un registro resumen", async () => {
    const borrador = await newDraft(2026);
    const informe = await service.importEntries(ctx, borrador.id, {
      csv: extracto("c0a-nacional-extracto.csv"),
      dryRun: false,
    });
    expect(informe).toMatchObject({ dryRun: false, totalFilas: 12, validas: 11, importadas: 11 });
    const celdas = await prisma.taxCalendarEntry.findMany({ where: { calendarId: borrador.id } });
    expect(celdas).toHaveLength(11);
    expect(celdas.filter((celda) => celda.reviewState === "FLAGGED")).toHaveLength(4);
    const revisadas = celdas.filter((celda) => celda.reviewState === "REVIEWED");
    expect(revisadas).toHaveLength(7);
    expect(
      revisadas.every((celda) => celda.reviewedByUserId === OWNER && celda.reviewedAt !== null),
    ).toBe(true);
    expect(
      celdas
        .filter((celda) => celda.reviewState === "FLAGGED")
        .every((celda) => celda.reviewedByUserId === null),
    ).toBe(true);
    expect(celdas.every((celda) => celda.sourcePage === 1)).toBe(true);
    expect(celdas[0]?.extraction).toMatchObject({
      origen: "importación CSV",
      fila: expect.any(Number),
    });
    const auditoria = await prisma.auditEvent.findMany({
      where: {
        entityType: "tax_calendar",
        entityId: borrador.id,
        action: "tax_calendar.entries_imported",
      },
    });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({
      userId: OWNER,
      after: { filas: 12, importadas: 11, filasRechazadas: 1 },
    });
  });

  it("marca como repetidas las filas que ya existen en el borrador y la segunda de dos iguales en el archivo", async () => {
    const borrador = await newDraft(2026);
    await service.addEntry(ctx, borrador.id, {
      conceptLabel: "Autónomos (DDJJ y pago)",
      groupingKind: "ENDING_DIGITS",
      endingDigits: "0123",
      referencePeriodStart: "2026-01-01",
      referencePeriodEnd: "2026-01-31",
      referenceLabel: "enero de 2026",
      dueDate: "2026-01-05",
    });
    const existente = await service.importEntries(ctx, borrador.id, {
      csv: extracto("c0a-nacional-extracto.csv"),
      dryRun: true,
    });
    expect(existente.rechazadas).toContainEqual({
      fila: 3,
      columna: null,
      motivo: "Ya existe en este calendario",
      valorRecibido: null,
    });
    const repetidas = await service.importEntries(ctx, borrador.id, {
      csv: csvDe(fila("Concepto repetido en el archivo"), fila("Concepto repetido en el archivo")),
      dryRun: false,
    });
    expect(repetidas).toMatchObject({ validas: 1, importadas: 1 });
    expect(repetidas.rechazadas).toEqual([
      {
        fila: 3,
        columna: null,
        motivo:
          "Repetida: la fila 2 del archivo tiene el mismo concepto, período, agrupación y dígitos",
        valorRecibido: null,
      },
    ]);
  });

  it("no importa nada si ninguna fila es válida, y no deja auditoría", async () => {
    const borrador = await newDraft(2026);
    const informe = await service.importEntries(ctx, borrador.id, {
      csv: csvDe(fila("Sin fecha", { fecha_completa: "" })),
      dryRun: false,
    });
    expect(informe).toMatchObject({ validas: 0, importadas: 0 });
    expect(await contarCeldas(borrador.id)).toBe(0);
    expect(
      await prisma.auditEvent.count({
        where: { entityId: borrador.id, action: "tax_calendar.entries_imported" },
      }),
    ).toBe(0);
  });

  it("si la base falla a mitad de la importación, no queda ninguna celda (una sola transacción en varios lotes)", async () => {
    const borrador = await newDraft(2026);
    const filas = Array.from({ length: 600 }, (_, i) =>
      fila(i === 549 ? "FALLA DE PRUEBA 2b1" : `Concepto de carga masiva ${i + 1}`),
    );
    const trampa = "tax_calendar_entries_falla_prueba_2b1";
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${trampa}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."conceptLabel" = 'FALLA DE PRUEBA 2b1' THEN RAISE EXCEPTION 'falla de prueba 2b1'; END IF;
        RETURN NEW;
      END $$`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${trampa} BEFORE INSERT ON tax_calendar_entries FOR EACH ROW EXECUTE FUNCTION ${trampa}()`,
    );
    try {
      await expect(
        service.importEntries(ctx, borrador.id, { csv: csvDe(...filas), dryRun: false }),
      ).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${trampa} ON tax_calendar_entries`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${trampa}()`);
    }
    expect(await contarCeldas(borrador.id)).toBe(0);
  });
});

describe("calendarios: importación sobre un calendario que no es borrador", () => {
  it("un calendario publicado responde 409 y dice que se crea una versión nueva; no escribe", async () => {
    const borrador = await newDraft(2026);
    await prisma.taxCalendar.update({
      where: { id: borrador.id },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });
    const error = await service
      .importEntries(ctx, borrador.id, { csv: csvDe(fila("IVA")), dryRun: false })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(TaxCalendarError);
    expect(error).toMatchObject({ code: "CALENDAR_NOT_DRAFT", httpStatus: 409 });
    expect((error as TaxCalendarError).message).toContain(
      "Creá a partir de este una versión nueva",
    );
    expect(await contarCeldas(borrador.id)).toBe(0);
  });

  it("un calendario oculto responde 409 con la salida para mostrarlo o crear una versión nueva", async () => {
    const borrador = await newDraft(2026);
    await prisma.taxCalendar.update({
      where: { id: borrador.id },
      data: { status: "HIDDEN", hiddenAt: new Date() },
    });
    const error = await service
      .importEntries(ctx, borrador.id, { csv: csvDe(fila("IVA")), dryRun: true })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({ code: "CALENDAR_NOT_DRAFT", httpStatus: 409 });
    expect((error as TaxCalendarError).message).toContain(
      "Mostralo o creá a partir de este una versión nueva",
    );
  });

  it("un archivo que supera 1 MB responde 422 con el campo csv y no escribe", async () => {
    const borrador = await newDraft(2026);
    const grande = csvDe(fila("Relleno", { nota: "x".repeat(1024 * 1024) }));
    const error = await service
      .importEntries(ctx, borrador.id, { csv: grande, dryRun: false })
      .catch((err: unknown) => err);
    expect(error).toMatchObject({
      code: "CALENDAR_VALIDATION_FAILED",
      httpStatus: 422,
      path: ["csv"],
    });
    expect(await contarCeldas(borrador.id)).toBe(0);
  });

  it("más de 2.000 filas responde 422 con el máximo", async () => {
    const borrador = await newDraft(2026);
    const muchas = csvDe(...Array.from({ length: 2001 }, (_, i) => fila(`Concepto ${i + 1}`)));
    const error = await service
      .importEntries(ctx, borrador.id, { csv: muchas, dryRun: true })
      .catch((err: unknown) => err);
    expect((error as TaxCalendarError).message).toContain(
      "El archivo tiene 2001 filas y el máximo es 2.000",
    );
  });
});

describe("calendarios: rutas de importación", () => {
  it("POST …/entries/import responde 200 con el informe en data (dryRun)", async () => {
    const app = appParaEstudio(OWNER, FIRM);
    await app.ready();
    try {
      const borrador = await newDraft(2026);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${borrador.id}/entries/import`,
        payload: { csv: extracto("c0a-tucuman-extracto.csv"), dryRun: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toMatchObject({
        dryRun: true,
        totalFilas: 11,
        validas: 11,
        importadas: 0,
        rechazadas: [],
      });
      expect(await contarCeldas(borrador.id)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("sin dryRun responde 400 VALIDATION_ERROR con el campo", async () => {
    const app = appParaEstudio(OWNER, FIRM);
    await app.ready();
    try {
      const borrador = await newDraft(2026);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${borrador.id}/entries/import`,
        payload: { csv: csvDe(fila("IVA")) },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
      expect(res.json().error.message).toContain("dryRun");
    } finally {
      await app.close();
    }
  });

  it("otra firma recibe 404 de calendario y no se importa nada", async () => {
    const app = appParaEstudio(OTHER_OWNER, OTHER_FIRM);
    await app.ready();
    try {
      const borrador = await newDraft(2026);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${OTHER_FIRM}/tax-calendars/${borrador.id}/entries/import`,
        payload: { csv: csvDe(fila("IVA")), dryRun: false },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("CALENDAR_NOT_FOUND");
      expect(await contarCeldas(borrador.id)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("acepta un archivo de más de 1 MB en el cuerpo y lo rechaza con 422 por el tope del archivo", async () => {
    const app = appParaEstudio(OWNER, FIRM);
    await app.ready();
    try {
      const borrador = await newDraft(2026);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/firms/${FIRM}/tax-calendars/${borrador.id}/entries/import`,
        payload: { csv: csvDe(fila("Relleno", { nota: "x".repeat(1200 * 1024) })), dryRun: true },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatchObject({
        code: "CALENDAR_VALIDATION_FAILED",
        details: { path: ["csv"] },
      });
    } finally {
      await app.close();
    }
  });
});

describe("calendarios: permiso, RLS y cobertura después de importar", () => {
  it("importar exige tax.calendars.manage, igual que agregar una celda: OWNER, ADMIN y PREPARER pasan; REVIEWER y AUDITOR_READONLY reciben 403", () => {
    const ruta = "/api/v1/firms/:p/tax-calendars/:p/entries/import";
    expect(requiredCapability("POST", ruta)).toBe("tax.calendars.manage");
    expect(requiredCapability("POST", "/api/v1/firms/:p/tax-calendars/:p/entries")).toBe(
      "tax.calendars.manage",
    );
    for (const role of ["OWNER", "ADMIN", "PREPARER"] as const) {
      expect(
        () =>
          assertCapability(
            { capabilities: capabilitiesForRole(role) } as never,
            "tax.calendars.manage",
          ),
        role,
      ).not.toThrow();
    }
    for (const role of ["REVIEWER", "AUDITOR_READONLY"] as const) {
      expect(
        () =>
          assertCapability(
            { capabilities: capabilitiesForRole(role) } as never,
            "tax.calendars.manage",
          ),
        role,
      ).toThrow(expect.objectContaining({ statusCode: 403, code: "CAPABILITY_REQUIRED" }));
    }
  });

  it("RLS: otra firma no ve las celdas importadas; la propia sí", async () => {
    const borrador = await newDraft(2026);
    await service.importEntries(ctx, borrador.id, {
      csv: extracto("c0a-municipal-extracto.csv"),
      dryRun: false,
    });
    expect(await contarComoRuntime(OWNER, FIRM, borrador.id)).toBe(10);
    expect(await contarComoRuntime(OTHER_OWNER, OTHER_FIRM, borrador.id)).toBe(0);
  });

  it("la validación de cobertura cuenta las celdas importadas y sigue diciendo qué falta", async () => {
    const borrador = await newDraft(2026);
    await service.importEntries(ctx, borrador.id, {
      csv: extracto("c0a-tucuman-extracto.csv"),
      dryRun: false,
    });
    const informe = await service.validate(ctx, borrador.id);
    expect(informe.entries).toBe(11);
    expect(informe.canPublish).toBe(false);
    expect(informe.problems.length).toBeGreaterThan(0);
  });
});
