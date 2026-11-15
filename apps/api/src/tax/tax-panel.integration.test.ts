import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { taxPanelQuerySchema } from "@contable/contracts";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import {
  addDays,
  argentinaToday,
  daysBetween,
  TaxPanelService,
  type TaxPanelRunner,
} from "./tax-panel-service.js";

/**
 * Panel de trabajo global (corte 4a) por la ruta real y por el servicio con el rol
 * runtime. Datos sintéticos rotulados («Cliente sintético 4A»): un estudio nuevo por
 * corrida, con identificadores aleatorios. No se borran filas: las liquidaciones
 * finalizadas tienen triggers inmutables y la base de pruebas es desechable.
 *
 * En NODE_ENV=test la ruta usa DATABASE_URL (superusuario, sin RLS), así que la
 * visibilidad por asignación se verifica con el rol runtime (sin BYPASSRLS).
 */

const OTHER_OWNER = "22222222-2222-4222-8222-222222222222"; // titular del estudio Beta (sembrado)
const FIRM = randomUUID();
const USERS = {
  owner: { id: randomUUID(), role: "OWNER", name: "Titular 4A" },
  admin: { id: randomUUID(), role: "ADMIN", name: "Administrador 4A" },
  preparer: { id: randomUUID(), role: "PREPARER", name: "Preparador 4A" },
  reviewer: { id: randomUUID(), role: "REVIEWER", name: "Revisor 4A" },
  auditor: { id: randomUUID(), role: "AUDITOR_READONLY", name: "Auditor 4A" },
  unassigned: { id: randomUUID(), role: "PREPARER", name: "Sin asignaciones 4A" },
} as const;
type UserKey = keyof typeof USERS;
const CLIENTS = {
  c1: { name: "Cliente sintético 4A uno", ending: "1" },
  c2: { name: "Cliente sintético 4A dos", ending: "5" },
  c3: { name: "Cliente sintético 4A sin CUIT", ending: null },
} as const;
type ClientKey = keyof typeof CLIENTS;
type ObligationKey = "O1" | "O2" | "O3" | "O4" | "O5" | "O6" | "O7";
type PeriodKey = "aOct1" | "bOct1" | "aNov1" | "aOct2" | "bSep2" | "aOct3" | "bOct3";

const asOf = argentinaToday(new Date());
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const firstDay = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-01`;
const lastDay = (year: number, month: number) =>
  addDays(firstDay(year + (month === 12 ? 1 : 0), (month % 12) + 1), -1);

/** CUIT válido cuyo último dígito (el que usa el panel) es el pedido. */
function cuitEndingIn(ending: string): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce(
      (total, weight, index) => total + Number(base.charAt(index)) * weight,
      0,
    );
    const check = (11 - (sum % 11)) % 11;
    if (check < 10 && String(check) === ending) return `${base}${check}`;
  }
}

interface PanelRowJson {
  obligationId: string;
  clientId: string;
  dueDate: string | null;
  dueDateSource: string;
  daysUntilDue: number | null;
  djState: string;
  legajo: { workpaperId: string; status: string; revision: number } | null;
  filing: { status: string; hasReceipt: boolean } | null;
  assigneeCount: number;
  responsables: { userId: string; name: string | null; isSelf: boolean }[];
}

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
const tokens = {} as Record<UserKey | "other", string>;
const clientId = {} as Record<ClientKey, string>;
const profileId = {} as Record<ClientKey, string>;
const obligationId = {} as Record<ObligationKey, string>;
const periodId = {} as Record<PeriodKey, string>;
const regimeA = { id: "", taxTypeId: "", jurisdictionId: "" };
const regimeB = { id: "", taxTypeId: "" };

/** Transacción con el rol runtime y el contexto RLS de la sesión, como withTenantContext. */
function asRuntime(userId: string): TaxPanelRunner {
  return (fn) =>
    runtimePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${FIRM}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      return fn(tx);
    });
}

/** Listado del servicio con el rol runtime: así se verifica la RLS por asignación de verdad. */
function listAs(key: UserKey, query = "") {
  const parsed = taxPanelQuerySchema.parse(Object.fromEntries(new URLSearchParams(query)));
  return new TaxPanelService().list(
    { userId: USERS[key].id, firmId: FIRM, actorKind: "USER" },
    parsed,
    asRuntime(USERS[key].id),
  );
}

beforeAll(async () => {
  runtimePrisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.RUNTIME_DATABASE_URL ?? "" }),
  });
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  const iva = await prisma.taxRegime.findFirst({
    where: { isActive: true, taxType: { code: "IVA" } },
    orderBy: { code: "asc" },
  });
  const otro = await prisma.taxRegime.findFirst({
    where: { isActive: true, taxType: { code: { not: "IVA" } } },
    orderBy: { code: "asc" },
  });
  if (!iva || !otro) {
    throw new Error(
      "seed-maestros-fiscales no cargado: faltan regímenes activos de IVA y de otro impuesto",
    );
  }
  regimeA.id = iva.id;
  regimeA.taxTypeId = iva.taxTypeId;
  regimeA.jurisdictionId = iva.jurisdictionId;
  regimeB.id = otro.id;
  regimeB.taxTypeId = otro.taxTypeId;

  await prisma.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now())`,
    FIRM,
    "Estudio sintético 4A",
  );
  for (const user of Object.values(USERS)) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
      user.id,
      `${user.id}@panel4a.test.local`,
      user.name,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'${user.role}','ACTIVE',now())`,
      FIRM,
      user.id,
    );
  }

  const sessions: Array<{
    id: string;
    userId: string;
    refreshTokenHash: string;
    familyId: string;
    rotationCounter: number;
    expiresAt: Date;
  }> = [];
  const issue = (key: UserKey | "other", userId: string) => {
    const token = randomBytes(32).toString("base64url");
    tokens[key] = token;
    sessions.push({
      id: randomUUID(),
      userId,
      refreshTokenHash: sha256(token),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  };
  for (const key of Object.keys(USERS) as UserKey[]) issue(key, USERS[key].id);
  issue("other", OTHER_OWNER);
  await prisma.deviceSession.createMany({ data: sessions });

  for (const key of Object.keys(CLIENTS) as ClientKey[]) {
    const spec = CLIENTS[key];
    const cuit = spec.ending === null ? "" : cuitEndingIn(spec.ending);
    const client = await prisma.client.create({
      data: {
        firmId: FIRM,
        legalName: spec.name,
        tradeName: "Sintético 4A",
        cuit,
        status: "ACTIVE",
      },
    });
    clientId[key] = client.id;
    const profile = await prisma.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM,
        clientId: client.id,
        legalName: spec.name,
        cuit,
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: utc("2026-01-01"),
        status: "ACTIVE",
      },
    });
    profileId[key] = profile.id;
  }

  await prisma.clientAssignment.createMany({
    data: [
      { firmId: FIRM, userId: USERS.preparer.id, clientId: clientId.c1 },
      { firmId: FIRM, userId: USERS.reviewer.id, clientId: clientId.c1 },
      { firmId: FIRM, userId: USERS.reviewer.id, clientId: clientId.c2 },
      { firmId: FIRM, userId: USERS.auditor.id, clientId: clientId.c2 },
    ],
  });

  const period = async (client: ClientKey, taxTypeId: string, year: number, month: number) =>
    (
      await prisma.taxPeriod.create({
        data: {
          firmId: FIRM,
          clientId: clientId[client],
          taxTypeId,
          startDate: utc(firstDay(year, month)),
          endDate: utc(lastDay(year, month)),
        },
      })
    ).id;
  periodId.aOct1 = await period("c1", regimeA.taxTypeId, 2026, 10);
  periodId.bOct1 = await period("c1", regimeB.taxTypeId, 2026, 10);
  periodId.aNov1 = await period("c1", regimeA.taxTypeId, 2026, 11);
  periodId.aOct2 = await period("c2", regimeA.taxTypeId, 2026, 10);
  periodId.bSep2 = await period("c2", regimeB.taxTypeId, 2026, 9);
  periodId.aOct3 = await period("c3", regimeA.taxTypeId, 2026, 10);
  periodId.bOct3 = await period("c3", regimeB.taxTypeId, 2026, 10);

  const obligation = async (
    key: ObligationKey,
    client: ClientKey,
    regimeKey: "A" | "B",
    period: PeriodKey,
    status: "PENDING" | "FILED" | "NOT_APPLICABLE",
    dueDays: number | null,
    source: "CALENDAR" | "MANUAL" = "MANUAL",
  ) => {
    const due = dueDays === null ? null : utc(addDays(asOf, dueDays));
    const created = await prisma.taxObligation.create({
      data: {
        firmId: FIRM,
        clientId: clientId[client],
        profileVersionId: profileId[client],
        regimeId: regimeKey === "A" ? regimeA.id : regimeB.id,
        periodId: periodId[period],
        status,
        dueDate: due,
        dueDateSource: source,
        calculatedDueDate: source === "CALENDAR" ? due : null,
      },
    });
    obligationId[key] = created.id;
  };
  await obligation("O1", "c1", "A", "aOct1", "PENDING", -5, "CALENDAR");
  await obligation("O2", "c1", "B", "bOct1", "PENDING", 10);
  await obligation("O3", "c2", "A", "aOct2", "PENDING", 40);
  await obligation("O4", "c2", "B", "bSep2", "PENDING", null);
  await obligation("O5", "c3", "A", "aOct3", "FILED", -60);
  await obligation("O6", "c1", "A", "aNov1", "NOT_APPLICABLE", 3);
  await obligation("O7", "c3", "B", "bOct3", "PENDING", 5);

  // Legajo de octubre de c1 (en revisión) vinculado a O1; legajo de octubre de c2 (finalizado) vinculado a O3;
  // legajo de septiembre-octubre de c2 sin vínculo, que cubre el cierre de O4 (en curso).
  const w1 = await prisma.monthlyTaxWorkpaper.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c1,
      periodStart: utc("2026-10-01"),
      periodEnd: utc("2026-10-31"),
      revision: 1,
      status: "IN_REVIEW",
    },
  });
  await prisma.workpaperSettlement.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c1,
      workpaperId: w1.id,
      obligationId: obligationId.O1,
      role: "CALCULO",
      statusAtLink: "LINKED",
    },
  });
  const w3 = await prisma.monthlyTaxWorkpaper.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c2,
      periodStart: utc("2026-10-01"),
      periodEnd: utc("2026-10-31"),
      revision: 1,
      status: "FINALIZED",
    },
  });
  await prisma.workpaperSettlement.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c2,
      workpaperId: w3.id,
      obligationId: obligationId.O3,
      role: "CALCULO",
      statusAtLink: "LINKED",
    },
  });
  await prisma.monthlyTaxWorkpaper.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c2,
      periodStart: utc("2026-09-01"),
      periodEnd: utc("2026-10-31"),
      revision: 1,
      status: "COLLECTING_INPUTS",
    },
  });

  // Liquidación finalizada de O1 sin presentación: DJ pendiente. Presentación sin acuse en O3; presentada en O5.
  await prisma.taxSettlement.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c1,
      taxTypeId: regimeA.taxTypeId,
      regimeId: regimeA.id,
      jurisdictionId: regimeA.jurisdictionId,
      periodId: periodId.aOct1,
      cutoff: utc("2026-10-31"),
      engineVersion: "panel-4a-test",
      rulesHash: "panel-4a",
      inputHash: "panel-4a",
      outputHash: "panel-4a",
      preparedByUserId: USERS.owner.id,
      status: "FINALIZED",
      finalizedAt: new Date(),
      finalizedByUserId: USERS.owner.id,
      version: 1,
    },
  });
  await prisma.taxFiling.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c2,
      obligationId: obligationId.O3,
      filedAt: utc(addDays(asOf, -1)),
      amountFiled: new Prisma.Decimal("0"),
      status: "PENDING",
      createdByUserId: USERS.owner.id,
    },
  });
  await prisma.taxFiling.create({
    data: {
      firmId: FIRM,
      clientId: clientId.c3,
      obligationId: obligationId.O5,
      filedAt: utc(addDays(asOf, -62)),
      amountFiled: new Prisma.Decimal("0"),
      status: "FILED",
      createdByUserId: USERS.owner.id,
    },
  });
});

afterAll(async () => {
  await app?.close();
  await runtimePrisma?.$disconnect();
});

const base = () => `/api/v1/firms/${FIRM}/portfolio/tax-worklist/obligations`;
const list = (token: string, query = "") =>
  app.inject({ method: "GET", url: `${base()}${query}`, cookies: { refresh_token: token } });
const idsOf = (rows: PanelRowJson[]) => rows.map((r) => r.obligationId);
const keysToIds = (keys: ObligationKey[]) => keys.map((k) => obligationId[k]);

describe("panel de trabajo 4a: lectura agregada por la ruta real", () => {
  it("el titular ve la vista inicial del estudio: no presentadas, dentro de la ventana, con la fecha de referencia del servidor", async () => {
    const res = await list(tokens.owner);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta.asOf).toBe(argentinaToday(new Date()));
    expect(body.meta.total).toBe(5);
    expect(new Set(idsOf(body.data))).toEqual(new Set(keysToIds(["O1", "O2", "O3", "O4", "O7"])));
    expect(body.meta.options.taxTypes).toHaveLength(2);
    expect(body.meta.options.taxTypes.map((t: { id: string }) => t.id)).toContain(
      regimeA.taxTypeId,
    );
    expect(body.meta.options.periods).toEqual(
      expect.arrayContaining([{ id: periodId.aOct1, label: "10/2026" }]),
    );
  });

  it("deriva el estado de DJ y los días corridos de cada obligación", async () => {
    const data = (await list(tokens.owner)).json().data as PanelRowJson[];
    const byId = new Map(data.map((r) => [r.obligationId, r]));
    expect(byId.get(obligationId.O1)).toMatchObject({
      djState: "DJ_PENDIENTE",
      dueDateSource: "CALENDAR",
      daysUntilDue: -5,
    });
    expect(byId.get(obligationId.O1)?.legajo).toMatchObject({ status: "IN_REVIEW", revision: 1 });
    // Sin vínculo, el legajo del cliente que cubre el cierre del período: en curso (plan §4.4, S4-7).
    expect(byId.get(obligationId.O2)).toMatchObject({
      djState: "LEGAJO_EN_CURSO",
      daysUntilDue: 10,
    });
    expect(byId.get(obligationId.O3)).toMatchObject({
      djState: "PRESENTACION_SIN_ACUSE",
      daysUntilDue: 40,
    });
    expect(byId.get(obligationId.O3)?.filing).toMatchObject({
      status: "PENDING",
      hasReceipt: false,
    });
    expect(byId.get(obligationId.O3)?.legajo).toMatchObject({ status: "FINALIZED" });
    expect(byId.get(obligationId.O4)).toMatchObject({
      djState: "LEGAJO_EN_CURSO",
      dueDate: null,
      daysUntilDue: null,
    });
    expect(byId.get(obligationId.O7)).toMatchObject({
      djState: "SIN_LEGAJO",
      daysUntilDue: 5,
      legajo: null,
    });
  });

  it("ordena por vencimiento y deja las obligaciones sin fecha al final", async () => {
    const data = (await list(tokens.owner)).json().data as PanelRowJson[];
    expect(idsOf(data)).toEqual(keysToIds(["O1", "O7", "O2", "O3", "O4"]));
  });

  it("RLS por asignación: el preparador (rol runtime) ve solo sus clientes asignados", async () => {
    const result = await listAs("preparer");
    expect(new Set(idsOf(result.data as PanelRowJson[]))).toEqual(new Set(keysToIds(["O1", "O2"])));
    expect(result.data.every((r) => r.clientId === clientId.c1)).toBe(true);
    expect(result.meta.total).toBe(2);
  });

  it("RLS por asignación: el revisor ve sus dos clientes y el auditor, solo el suyo", async () => {
    const reviewer = await listAs("reviewer");
    expect(reviewer.meta.total).toBe(4);
    const auditor = await listAs("auditor");
    expect(new Set(idsOf(auditor.data as PanelRowJson[]))).toEqual(
      new Set(keysToIds(["O3", "O4"])),
    );
  });

  it("el administrador ve todo el estudio; «me» sin asignaciones devuelve vacío y no inventa filas", async () => {
    expect((await list(tokens.admin)).json().meta.total).toBe(5);
    const mine = await list(tokens.owner, "?responsable=me");
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ data: [], meta: { total: 0 } });
  });

  it("filtra por responsable (identificador), terminación, grupo, impuesto, régimen y período", async () => {
    const byAuditor = (await list(tokens.owner, `?responsable=${USERS.auditor.id}`)).json()
      .data as PanelRowJson[];
    expect(new Set(idsOf(byAuditor))).toEqual(new Set(keysToIds(["O3", "O4"])));
    expect((await list(tokens.owner, "?terminacion=1")).json().meta.total).toBe(2);
    const grupo = (await list(tokens.owner, "?grupo=05")).json().data as PanelRowJson[];
    expect(new Set(idsOf(grupo))).toEqual(new Set(keysToIds(["O3", "O4"])));
    expect((await list(tokens.owner, `?taxTypeId=${regimeA.taxTypeId}`)).json().meta.total).toBe(2);
    expect((await list(tokens.owner, `?regimeId=${regimeB.id}`)).json().meta.total).toBe(3);
    const periodo = (await list(tokens.owner, `?periodId=${periodId.bSep2}`)).json()
      .data as PanelRowJson[];
    expect(idsOf(periodo)).toEqual(keysToIds(["O4"]));
  });

  it("filtra por estado (con su propia vista de presentadas) y por rango de vencimiento", async () => {
    const presentadas = (
      await list(tokens.owner, `?estado=PRESENTADO&dueFrom=${addDays(asOf, -90)}`)
    ).json().data as PanelRowJson[];
    expect(idsOf(presentadas)).toEqual(keysToIds(["O5"]));
    expect(presentadas[0]).toMatchObject({
      djState: "PRESENTADO",
      filing: { status: "FILED", hasReceipt: false },
    });
    expect(idsOf((await list(tokens.owner, "?estado=DJ_PENDIENTE")).json().data)).toEqual(
      keysToIds(["O1"]),
    );
    const lejos = (await list(tokens.owner, `?dueFrom=${addDays(asOf, 20)}`)).json()
      .data as PanelRowJson[];
    expect(new Set(idsOf(lejos))).toEqual(new Set(keysToIds(["O3", "O4"])));
  });

  it("agrupa por terminación con conteos que suman el total y «Sin CUIT» al final", async () => {
    const body = (await list(tokens.owner, "?agrupar=terminacion")).json();
    expect(
      body.meta.groups.map((g: { label: string; count: number }) => [g.label, g.count]),
    ).toEqual([
      ["Terminación 1", 2],
      ["Terminación 5", 2],
      ["Sin CUIT", 1],
    ]);
    expect(body.meta.groupsComplete).toBe(true);
    expect(body.meta.groups.reduce((sum: number, g: { count: number }) => sum + g.count, 0)).toBe(
      body.meta.total,
    );
  });

  it("pagina con offset y límite sin perder ni repetir filas", async () => {
    const segunda = (await list(tokens.owner, "?limit=2&offset=2")).json().data as PanelRowJson[];
    expect(idsOf(segunda)).toEqual(keysToIds(["O2", "O3"]));
    const ultima = await list(tokens.owner, "?limit=2&offset=4");
    expect(idsOf(ultima.json().data)).toEqual(keysToIds(["O4"]));
    expect(ultima.json().meta).toMatchObject({ total: 5, limit: 2, offset: 4 });
  });

  it("los nombres de los asignados siguen la RLS de usuarios: el preparador no ve el nombre del revisor", async () => {
    const preparer = (await listAs("preparer")).data.find(
      (r) => r.obligationId === obligationId.O1,
    );
    expect(preparer?.assigneeCount).toBe(2);
    expect(preparer?.responsables).toEqual([
      { userId: USERS.preparer.id, name: USERS.preparer.name, isSelf: true },
      { userId: USERS.reviewer.id, name: null, isSelf: false },
    ]);
    const owner = (await list(tokens.owner)).json().data as PanelRowJson[];
    const o1 = owner.find((r) => r.obligationId === obligationId.O1);
    expect(o1?.responsables.map((r) => r.name)).toEqual([USERS.preparer.name, USERS.reviewer.name]);
  });

  it("parámetros inválidos responden 400 con el campo y el motivo", async () => {
    const res = await list(tokens.owner, "?terminacion=10");
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details[0].path).toEqual(["terminacion"]);
    for (const query of [
      "?responsable=juan",
      "?dueFrom=2026-02-30",
      "?estado=PAGADO",
      "?dueFrom=2026-05-01&dueTo=2026-04-01",
      "?foo=1",
    ]) {
      expect((await list(tokens.owner, query)).statusCode, query).toBe(400);
    }
  });

  it("los cinco roles con tax.settlements.read responden 200; sin asignaciones, vacío (rol runtime); otro estudio, 404", async () => {
    for (const key of ["owner", "admin", "preparer", "reviewer", "auditor"] as const) {
      expect((await list(tokens[key])).statusCode, key).toBe(200);
    }
    const sinAsignar = await listAs("unassigned");
    expect(sinAsignar).toMatchObject({ data: [], meta: { total: 0 } });
    expect((await list(tokens.other)).statusCode).toBe(404);
  });

  it("los días corridos del servidor coinciden con la fecha de referencia devuelta", async () => {
    const body = (await list(tokens.owner)).json();
    const o7 = (body.data as PanelRowJson[]).find((r) => r.obligationId === obligationId.O7);
    expect(o7?.daysUntilDue).toBe(daysBetween(body.meta.asOf, o7?.dueDate ?? body.meta.asOf));
  });
});
