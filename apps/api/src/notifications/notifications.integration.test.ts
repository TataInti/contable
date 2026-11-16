import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  notificationArchiveResponseSchema,
  notificationListResponseSchema,
  notificationReadResponseSchema,
  notificationUnreadCountResponseSchema,
} from "@contable/contracts";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import { NotificationService, type NotificationRunner } from "./service.js";

/**
 * Avisos propios del usuario (corte 3c): rutas /api/v1/me/notifications y servicio con el rol runtime.
 *
 * Datos sintéticos rotulados («Cliente sintético 3C»), con identificadores aleatorios por corrida. La base de
 * pruebas es desechable: no se borran filas. En NODE_ENV=test las rutas usan DATABASE_URL (superusuario, sin
 * RLS): el aislamiento por usuario y por estudio se prueba en las rutas con los filtros de la consulta y, con
 * RLS real, con el rol runtime (RUNTIME_DATABASE_URL), como en el corte 4a.
 *
 * Mapa de avisos (los segundos ordenan por fecha de creación):
 *  - Titular (A) en el estudio uno: f1-1 a f1-25 sobre el cliente 1. Ocultos: f1-22 (obligación en estado FILED sin
 *    presentación registrada), f1-24 (archivado) y f1-25 (presentado). Leído: f1-23. Un aviso de otro tipo (general).
 *  - Titular (A) en el estudio tres (Administrador): f3-a, f3-b, f3-c.
 *  - Titular (A) en el estudio dos (membresía SUSPENDED): f2-a y f2-b. No aparecen nunca.
 *  - Revisor (B) en el estudio uno: b-a y b-b (cliente 2).
 *  - Preparador (P) en el estudio uno, asignado solo al cliente 1: p-c1 (visible) y p-c2 (oculto por la RLS de
 *    tax_obligations con el rol runtime).
 */

type Alert = {
  tag: string;
  userId: string;
  firmId: string;
  clientId: string;
  profileId: string;
  seconds: number;
  type?: "DUE_ALERT" | "DUE_OVERDUE";
  status?: "PENDING" | "FILED";
  filed?: boolean;
  readAt?: number | undefined;
  archivedAt?: number | undefined;
};

const CSRF = randomBytes(24).toString("base64url");
const BASE_MS = Date.parse("2026-11-10T12:00:00.000Z");
const at = (seconds: number) => new Date(BASE_MS + seconds * 1000);
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const monthStart = (k: number) => new Date(Date.UTC(2030, k, 1));
const monthEnd = (k: number) => new Date(Date.UTC(2030, k + 1, 0));
const dueOn = (k: number) => new Date(Date.UTC(2030, k, 20));
const randomCuit = () => String(randomInt(10_000_000_000, 100_000_000_000));

const FIRM = { uno: randomUUID(), dos: randomUUID(), tres: randomUUID() };
const FIRM_NAME = {
  uno: "Estudio sintético 3C uno",
  dos: "Estudio sintético 3C dos (suspendido)",
  tres: "Estudio sintético 3C tres",
};
const USER = { owner: randomUUID(), other: randomUUID(), preparer: randomUUID() };
const CLIENT = { c1: randomUUID(), c2: randomUUID(), c3: randomUUID(), c4: randomUUID() };
const CLIENT_NAME = {
  c1: "Cliente sintético 3C uno",
  c2: "Cliente sintético 3C dos",
  c3: "Cliente sintético 3C tres",
  c4: "Cliente sintético 3C cuatro",
};
const CUIT = { c1: randomCuit(), c2: randomCuit(), c3: randomCuit(), c4: randomCuit() };
const PROFILE = { c1: randomUUID(), c2: randomUUID(), c3: randomUUID(), c4: randomUUID() };

const OWNER_VISIBLE_TAGS = [
  ...Array.from({ length: 21 }, (_, i) => `f1-${i + 1}`),
  "f1-23",
  "f3-a",
  "f3-b",
  "f3-c",
];

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
const tokens = { owner: "", other: "", preparer: "" };
const alertIds: Record<string, string> = {};
const alertMs: Record<string, number> = {};

const get = (url: string, token?: string) =>
  app.inject({ method: "GET", url, ...(token ? { cookies: { refresh_token: token } } : {}) });

const post = (url: string, token: string) =>
  app.inject({
    method: "POST",
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
  });

const listAs = async (token: string, query = "limit=50") =>
  notificationListResponseSchema.parse(
    (await get(`/api/v1/me/notifications?${query}`, token)).json(),
  );

const unreadAs = async (token: string) =>
  notificationUnreadCountResponseSchema.parse(
    (await get("/api/v1/me/notifications/unread-count", token)).json(),
  ).data.count;

const idOf = (tag: string) => alertIds[tag] ?? "";

/** Ids ordenados como la API: fecha de creación descendente y, en empate, id descendente. */
const newestFirst = (tags: string[]) =>
  tags
    .map((tag) => ({ id: idOf(tag), ms: alertMs[tag] ?? 0 }))
    .sort((x, y) => y.ms - x.ms || (x.id < y.id ? 1 : -1))
    .map((x) => x.id);

/** Transacción con el rol runtime y el contexto RLS de la sesión, como withTenantContext. */
function runtimeRunner(userId: string): NotificationRunner {
  return (firmId, fn) =>
    runtimePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${firmId}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      return fn(tx);
    });
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

  const regime = await prisma.taxRegime.findFirst({
    where: { isActive: true, taxType: { code: "IVA" } },
    orderBy: { code: "asc" },
  });
  if (!regime) throw new Error("seed-maestros-fiscales no cargado: falta un régimen activo de IVA");
  const regimeId = regime.id;
  const taxTypeId = regime.taxTypeId;

  await prisma.firm.createMany({
    data: [
      { id: FIRM.uno, legalName: FIRM_NAME.uno, displayName: FIRM_NAME.uno },
      { id: FIRM.dos, legalName: FIRM_NAME.dos, displayName: FIRM_NAME.dos },
      { id: FIRM.tres, legalName: FIRM_NAME.tres, displayName: FIRM_NAME.tres },
    ],
  });
  await prisma.user.createMany({
    data: [
      {
        id: USER.owner,
        emailNormalized: `${USER.owner}@3c.test.local`,
        name: "Titular sintético 3C",
        passwordHash: "x",
      },
      {
        id: USER.other,
        emailNormalized: `${USER.other}@3c.test.local`,
        name: "Revisor sintético 3C",
        passwordHash: "x",
      },
      {
        id: USER.preparer,
        emailNormalized: `${USER.preparer}@3c.test.local`,
        name: "Preparador sintético 3C",
        passwordHash: "x",
      },
    ],
  });
  await prisma.firmMembership.createMany({
    data: [
      { firmId: FIRM.uno, userId: USER.owner, role: "OWNER", status: "ACTIVE", acceptedAt: at(0) },
      {
        firmId: FIRM.dos,
        userId: USER.owner,
        role: "OWNER",
        status: "SUSPENDED",
        acceptedAt: at(0),
      },
      { firmId: FIRM.tres, userId: USER.owner, role: "ADMIN", status: "ACTIVE", acceptedAt: at(0) },
      {
        firmId: FIRM.uno,
        userId: USER.other,
        role: "REVIEWER",
        status: "ACTIVE",
        acceptedAt: at(0),
      },
      {
        firmId: FIRM.uno,
        userId: USER.preparer,
        role: "PREPARER",
        status: "ACTIVE",
        acceptedAt: at(0),
      },
    ],
  });
  await prisma.client.createMany({
    data: [
      {
        id: CLIENT.c1,
        firmId: FIRM.uno,
        legalName: CLIENT_NAME.c1,
        tradeName: "Sintético 3C",
        cuit: CUIT.c1,
        status: "ACTIVE",
      },
      {
        id: CLIENT.c2,
        firmId: FIRM.uno,
        legalName: CLIENT_NAME.c2,
        tradeName: "Sintético 3C",
        cuit: CUIT.c2,
        status: "ACTIVE",
      },
      {
        id: CLIENT.c3,
        firmId: FIRM.tres,
        legalName: CLIENT_NAME.c3,
        tradeName: "Sintético 3C",
        cuit: CUIT.c3,
        status: "ACTIVE",
      },
      {
        id: CLIENT.c4,
        firmId: FIRM.dos,
        legalName: CLIENT_NAME.c4,
        tradeName: "Sintético 3C",
        cuit: CUIT.c4,
        status: "ACTIVE",
      },
    ],
  });
  await prisma.taxpayerProfileVersion.createMany({
    data: [
      {
        id: PROFILE.c1,
        firmId: FIRM.uno,
        clientId: CLIENT.c1,
        legalName: CLIENT_NAME.c1,
        cuit: CUIT.c1,
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: utc("2026-01-01"),
        status: "ACTIVE",
      },
      {
        id: PROFILE.c2,
        firmId: FIRM.uno,
        clientId: CLIENT.c2,
        legalName: CLIENT_NAME.c2,
        cuit: CUIT.c2,
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: utc("2026-01-01"),
        status: "ACTIVE",
      },
      {
        id: PROFILE.c3,
        firmId: FIRM.tres,
        clientId: CLIENT.c3,
        legalName: CLIENT_NAME.c3,
        cuit: CUIT.c3,
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: utc("2026-01-01"),
        status: "ACTIVE",
      },
      {
        id: PROFILE.c4,
        firmId: FIRM.dos,
        clientId: CLIENT.c4,
        legalName: CLIENT_NAME.c4,
        cuit: CUIT.c4,
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: utc("2026-01-01"),
        status: "ACTIVE",
      },
    ],
  });

  const users = ["owner", "other", "preparer"] as const;
  for (const key of users) tokens[key] = randomBytes(32).toString("base64url");
  await prisma.deviceSession.createMany({
    data: users.map((key) => ({
      userId: USER[key],
      refreshTokenHash: sha256(tokens[key]),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })),
  });

  await prisma.clientAssignment.createMany({
    data: [
      { firmId: FIRM.uno, userId: USER.owner, clientId: CLIENT.c1 },
      { firmId: FIRM.uno, userId: USER.owner, clientId: CLIENT.c2 },
      { firmId: FIRM.tres, userId: USER.owner, clientId: CLIENT.c3 },
      { firmId: FIRM.uno, userId: USER.other, clientId: CLIENT.c1 },
      { firmId: FIRM.uno, userId: USER.other, clientId: CLIENT.c2 },
      { firmId: FIRM.uno, userId: USER.preparer, clientId: CLIENT.c1 },
    ],
  });

  const periods: Prisma.TaxPeriodCreateManyInput[] = [];
  const obligations: Prisma.TaxObligationCreateManyInput[] = [];
  const filings: Prisma.TaxFilingCreateManyInput[] = [];
  const notifications: Prisma.UserNotificationCreateManyInput[] = [];
  const nextPeriod = new Map<string, number>();

  const addAlert = (a: Alert) => {
    // Un período por obligación y cliente: la clave única de tax_obligations es (cliente, régimen, período).
    const k = nextPeriod.get(a.clientId) ?? 0;
    nextPeriod.set(a.clientId, k + 1);
    const periodId = randomUUID();
    const obligationId = randomUUID();
    const notificationId = randomUUID();
    const createdAt = at(a.seconds);
    periods.push({
      id: periodId,
      firmId: a.firmId,
      clientId: a.clientId,
      taxTypeId,
      startDate: monthStart(k),
      endDate: monthEnd(k),
    });
    obligations.push({
      id: obligationId,
      firmId: a.firmId,
      clientId: a.clientId,
      profileVersionId: a.profileId,
      regimeId,
      periodId,
      status: a.status ?? "PENDING",
      dueDate: dueOn(k),
    });
    if (a.filed) {
      filings.push({
        id: randomUUID(),
        firmId: a.firmId,
        clientId: a.clientId,
        obligationId,
        filedAt: createdAt,
        amountFiled: 0,
        status: "FILED",
        createdByUserId: a.userId,
      });
    }
    notifications.push({
      id: notificationId,
      userId: a.userId,
      firmId: a.firmId,
      clientId: a.clientId,
      type: a.type ?? "DUE_ALERT",
      severity: "WARNING",
      title: `Vence en 2 días hábiles (sintético 3C ${a.tag})`,
      body: null,
      resourceType: "TAX_OBLIGATION",
      resourceId: obligationId,
      deduplicationKey: `due-alert:${obligationId}:${dueOn(k).toISOString().slice(0, 10)}`,
      readAt: a.readAt === undefined ? null : at(a.readAt),
      archivedAt: a.archivedAt === undefined ? null : at(a.archivedAt),
      createdAt,
    });
    alertIds[a.tag] = notificationId;
    alertMs[a.tag] = createdAt.getTime();
  };

  for (let i = 1; i <= 25; i++) {
    addAlert({
      tag: `f1-${i}`,
      userId: USER.owner,
      firmId: FIRM.uno,
      clientId: CLIENT.c1,
      profileId: PROFILE.c1,
      seconds: i * 60,
      type: i % 2 === 0 ? "DUE_OVERDUE" : "DUE_ALERT",
      status: i === 22 || i === 25 ? "FILED" : "PENDING",
      filed: i === 25,
      readAt: i === 23 ? 23 * 60 + 5 : undefined,
      archivedAt: i === 24 ? 24 * 60 + 5 : undefined,
    });
  }
  const generalId = randomUUID();
  notifications.push({
    id: generalId,
    userId: USER.owner,
    firmId: FIRM.uno,
    clientId: null,
    type: "AVISO_GENERAL",
    severity: "INFO",
    title: "Aviso general sintético 3C",
    body: null,
    resourceType: null,
    resourceId: null,
    deduplicationKey: null,
    createdAt: at(26 * 60),
  });
  alertIds.general = generalId;
  addAlert({
    tag: "f3-a",
    userId: USER.owner,
    firmId: FIRM.tres,
    clientId: CLIENT.c3,
    profileId: PROFILE.c3,
    seconds: 150,
  });
  addAlert({
    tag: "f3-b",
    userId: USER.owner,
    firmId: FIRM.tres,
    clientId: CLIENT.c3,
    profileId: PROFILE.c3,
    seconds: 570,
  });
  addAlert({
    tag: "f3-c",
    userId: USER.owner,
    firmId: FIRM.tres,
    clientId: CLIENT.c3,
    profileId: PROFILE.c3,
    seconds: 1290,
  });
  addAlert({
    tag: "f2-a",
    userId: USER.owner,
    firmId: FIRM.dos,
    clientId: CLIENT.c4,
    profileId: PROFILE.c4,
    seconds: 1800,
  });
  addAlert({
    tag: "f2-b",
    userId: USER.owner,
    firmId: FIRM.dos,
    clientId: CLIENT.c4,
    profileId: PROFILE.c4,
    seconds: 1860,
  });
  addAlert({
    tag: "b-a",
    userId: USER.other,
    firmId: FIRM.uno,
    clientId: CLIENT.c2,
    profileId: PROFILE.c2,
    seconds: 2400,
  });
  addAlert({
    tag: "b-b",
    userId: USER.other,
    firmId: FIRM.uno,
    clientId: CLIENT.c2,
    profileId: PROFILE.c2,
    seconds: 2460,
  });
  addAlert({
    tag: "p-c1",
    userId: USER.preparer,
    firmId: FIRM.uno,
    clientId: CLIENT.c1,
    profileId: PROFILE.c1,
    seconds: 3000,
  });
  addAlert({
    tag: "p-c2",
    userId: USER.preparer,
    firmId: FIRM.uno,
    clientId: CLIENT.c2,
    profileId: PROFILE.c2,
    seconds: 3060,
  });

  await prisma.taxPeriod.createMany({ data: periods });
  await prisma.taxObligation.createMany({ data: obligations });
  await prisma.taxFiling.createMany({ data: filings });
  await prisma.userNotification.createMany({ data: notifications });
});

afterAll(async () => {
  await app.close();
  await runtimePrisma.$disconnect();
});

describe("GET /api/v1/me/notifications: listado", () => {
  it("devuelve 20 avisos por defecto, con el total de los visibles y la forma del contrato", async () => {
    const res = await get("/api/v1/me/notifications", tokens.owner);
    expect(res.statusCode).toBe(200);
    const body = notificationListResponseSchema.parse(res.json());
    expect(body.meta).toEqual({ limit: 20, offset: 0, total: 25 });
    expect(body.data.map((n) => n.id)).toEqual(newestFirst(OWNER_VISIBLE_TAGS).slice(0, 20));
    expect(body.data[0]).toMatchObject({
      type: "DUE_ALERT",
      firmName: FIRM_NAME.uno,
      clientId: CLIENT.c1,
      clientName: CLIENT_NAME.c1,
      obligationId: expect.any(String),
      dueDate: "2031-11-20",
      readAt: expect.any(String),
    });
  });

  it("pagina con límite y desplazamiento", async () => {
    const body = await listAs(tokens.owner, "limit=10&offset=20");
    expect(body.meta).toEqual({ limit: 10, offset: 20, total: 25 });
    expect(body.data.map((n) => n.id)).toEqual(newestFirst(OWNER_VISIBLE_TAGS).slice(20, 30));
  });

  it("el máximo por página es 50 y lo que lo supera se rechaza indicando el campo", async () => {
    const tooMany = await get("/api/v1/me/notifications?limit=51", tokens.owner);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error.code).toBe("VALIDATION_ERROR");
    const max = await listAs(tokens.owner, "limit=50");
    expect(max.meta.limit).toBe(50);
    expect(max.data).toHaveLength(25);
  });

  it("intercala los avisos de dos estudios según la fecha de creación", async () => {
    const body = await listAs(tokens.owner, "limit=3");
    expect(body.data.map((n) => n.firmId)).toEqual([FIRM.uno, FIRM.tres, FIRM.uno]);
    expect(body.data[1]?.firmName).toBe(FIRM_NAME.tres);
  });

  it("no muestra avisos de un estudio con membresía SUSPENDED", async () => {
    const body = await listAs(tokens.owner);
    expect(body.data.some((n) => n.firmId === FIRM.dos)).toBe(false);
    expect(body.meta.total).toBe(25);
  });

  it("no muestra obligaciones presentadas, archivados ni avisos de otro tipo", async () => {
    const body = await listAs(tokens.owner);
    const ids = new Set(body.data.map((n) => n.id));
    expect(ids).toEqual(new Set(OWNER_VISIBLE_TAGS.map(idOf)));
    for (const hidden of ["f1-22", "f1-24", "f1-25", "general"]) {
      expect(ids.has(idOf(hidden))).toBe(false);
    }
  });

  it("un usuario B no ve avisos de A y sí los suyos", async () => {
    const body = await listAs(tokens.other);
    expect(body.meta.total).toBe(2);
    expect(new Set(body.data.map((n) => n.id))).toEqual(new Set([idOf("b-a"), idOf("b-b")]));
  });

  it("sin sesión responde 401 en listado, contador y marcado", async () => {
    for (const url of ["/api/v1/me/notifications", "/api/v1/me/notifications/unread-count"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("UNAUTHENTICATED");
    }
    const marked = await app.inject({
      method: "POST",
      url: `/api/v1/me/notifications/${idOf("f1-20")}/read`,
    });
    expect(marked.statusCode).toBe(401);
  });
});

describe("GET /api/v1/me/notifications/unread-count", () => {
  it("cuenta solo los no leídos visibles: sin presentadas, archivadas ni leídas", async () => {
    const res = await get("/api/v1/me/notifications/unread-count", tokens.owner);
    expect(notificationUnreadCountResponseSchema.parse(res.json())).toEqual({
      data: { count: 24 },
    });
    expect(await unreadAs(tokens.other)).toBe(2);
  });
});

describe("RLS real con el rol runtime (sin BYPASSRLS)", () => {
  it("el rol runtime no tiene BYPASSRLS y, sin contexto de usuario, no ve avisos", async () => {
    const [role] = await runtimePrisma.$queryRaw<{ rolbypassrls: boolean }[]>`
      SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role?.rolbypassrls).toBe(false);
    const [row] = await runtimePrisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM user_notifications`;
    expect(row?.count).toBe(0);
  });

  it("el servicio con el rol runtime lista y cuenta solo lo propio", async () => {
    const service = new NotificationService();
    const owner = await service.list(
      USER.owner,
      { limit: 50, offset: 0 },
      runtimeRunner(USER.owner),
    );
    expect(owner.meta.total).toBe(25);
    expect(await service.unreadCount(USER.other, runtimeRunner(USER.other))).toBe(2);
  });

  it("un preparador no ve avisos de clientes que no tiene asignados", async () => {
    const service = new NotificationService();
    const body = await service.list(
      USER.preparer,
      { limit: 20, offset: 0 },
      runtimeRunner(USER.preparer),
    );
    expect(body.meta.total).toBe(1);
    expect(body.data[0]?.clientId).toBe(CLIENT.c1);
  });
});

describe("POST /api/v1/me/notifications/:id/read y /archive", () => {
  it("marcar como leído devuelve readAt, es idempotente y baja el contador", async () => {
    const before = await unreadAs(tokens.owner);
    const id = idOf("f1-20");
    const first = await post(`/api/v1/me/notifications/${id}/read`, tokens.owner);
    expect(first.statusCode).toBe(200);
    const body = notificationReadResponseSchema.parse(first.json());
    expect(body.data.id).toBe(id);
    const again = notificationReadResponseSchema.parse(
      (await post(`/api/v1/me/notifications/${id}/read`, tokens.owner)).json(),
    );
    expect(again.data.readAt).toBe(body.data.readAt);
    expect(await unreadAs(tokens.owner)).toBe(before - 1);
  });

  it("archivar devuelve archivedAt, es idempotente y saca el aviso de la lista y del contador", async () => {
    const id = idOf("f1-19");
    const beforeTotal = (await listAs(tokens.owner, "limit=1")).meta.total;
    const beforeUnread = await unreadAs(tokens.owner);
    const first = notificationArchiveResponseSchema.parse(
      (await post(`/api/v1/me/notifications/${id}/archive`, tokens.owner)).json(),
    );
    expect(first.data.id).toBe(id);
    const again = notificationArchiveResponseSchema.parse(
      (await post(`/api/v1/me/notifications/${id}/archive`, tokens.owner)).json(),
    );
    expect(again.data.archivedAt).toBe(first.data.archivedAt);
    expect(await unreadAs(tokens.owner)).toBe(beforeUnread - 1);
    const all = await listAs(tokens.owner);
    expect(all.meta.total).toBe(beforeTotal - 1);
    expect(all.data.some((n) => n.id === id)).toBe(false);
  });

  it("responde 404 para avisos ajenos, de otro estudio o inexistentes, y no los modifica", async () => {
    const attempts = [
      await post(`/api/v1/me/notifications/${idOf("b-a")}/read`, tokens.owner),
      await post(`/api/v1/me/notifications/${idOf("f2-a")}/archive`, tokens.owner),
      await post(`/api/v1/me/notifications/${idOf("f1-18")}/read`, tokens.other),
      await post(`/api/v1/me/notifications/${randomUUID()}/read`, tokens.owner),
    ];
    for (const res of attempts) {
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    }
    const suspended = await prisma.userNotification.findUnique({ where: { id: idOf("f2-a") } });
    expect(suspended).toMatchObject({ readAt: null, archivedAt: null });
    const ajeno = await prisma.userNotification.findUnique({ where: { id: idOf("b-a") } });
    expect(ajeno).toMatchObject({ readAt: null, archivedAt: null });
    const ajenoDelTitular = await prisma.userNotification.findUnique({
      where: { id: idOf("f1-18") },
    });
    expect(ajenoDelTitular).toMatchObject({ readAt: null, archivedAt: null });
  });
});
