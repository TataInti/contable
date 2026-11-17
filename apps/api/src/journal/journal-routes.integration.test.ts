import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/*
 * Corte C1 de seguridad: asientos por HTTP con la ruta del cliente del propio asiento.
 *
 * Fija lo vigente que el corte no cambia (ciclo completo, rechazo por estado inválido,
 * idempotencia de post, capacidades por rol, 401 y 404 de la guardia). Corre la API real
 * (buildServer, guardia y RLS) con el rol de producción contable_runtime, sin BYPASSRLS:
 * en NODE_ENV=test lib/prisma.ts toma DATABASE_URL, así que se la apunta al rol runtime
 * antes de cargar el servidor y los datos se cargan con el cliente administrador.
 * Datos sintéticos rotulados «Demo», con identificadores aleatorios por corrida. La base de
 * pruebas es desechable: no se borran filas (un asiento contabilizado es inmutable).
 */
const { ADMIN_DATABASE_URL } = vi.hoisted(() => {
  const runtime = process.env.RUNTIME_DATABASE_URL;
  const admin = process.env.DATABASE_URL;
  if (!runtime || !admin) {
    throw new Error("Faltan DATABASE_URL y RUNTIME_DATABASE_URL de la base de pruebas");
  }
  process.env.DATABASE_URL = runtime;
  return { ADMIN_DATABASE_URL: admin };
});

import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import type { TenantContext } from "../auth/tenant.js";
import { JournalService } from "./journal-service.js";

type Login = "owner" | "admin" | "preparerA" | "reviewerA" | "preparerB" | "outsider";
type Actor = Login | "maker" | "checker";
type State = "DRAFT" | "IN_REVIEW" | "REVIEWED" | "POSTED";
type Route = "submit" | "review" | "reject" | "post" | "reverse";

interface EntryRef {
  id: string;
  rowVersion: number;
}
interface ClientFx {
  id: string;
  fiscalYearId: string;
  periodId: string;
  cajaId: string;
  capitalId: string;
}
interface EntryData {
  id: string;
  clientId: string;
  status: string;
  rowVersion: number;
  sequenceNumber: number | null;
  reversalOfId: string | null;
}
interface Reply {
  status: number;
  body: { data?: unknown; error?: { code: string; message: string } };
}

const LOGINS: readonly Login[] = [
  "owner",
  "admin",
  "preparerA",
  "reviewerA",
  "preparerB",
  "outsider",
];
const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const ID: Record<Actor, string> = {
  owner: randomUUID(),
  admin: randomUUID(),
  maker: randomUUID(),
  checker: randomUUID(),
  preparerA: randomUUID(),
  reviewerA: randomUUID(),
  preparerB: randomUUID(),
  outsider: randomUUID(),
};
const CSRF = randomBytes(24).toString("base64url");

/** Estado del asiento desde el que cada ruta es válida. */
const FROM: Record<Route, State> = {
  submit: "DRAFT",
  review: "IN_REVIEW",
  reject: "IN_REVIEW",
  post: "REVIEWED",
  reverse: "POSTED",
};

let app: FastifyInstance;
let admin: PrismaClient;
let A: ClientFx;
let B: ClientFx;
let counter = 0;
const tokens = {} as Record<Login, string>;
const journal = new JournalService();

function validTestCuit(): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce((total, weight, index) => total + Number(base[index]) * weight, 0);
    const check = (11 - (sum % 11)) % 11;
    if (check < 10) return `${base}${check}`;
  }
}

const journalUrl = (clientId: string) =>
  `/api/v1/firms/${FIRM}/clients/${clientId}/journal-entries`;
const newKey = () => `demo-c1-${randomUUID()}`;
const ctxOf = (userId: string, clientId: string): TenantContext => ({
  userId,
  firmId: FIRM,
  clientId,
  actorKind: "USER",
});
const entryOf = (reply: Reply) => reply.body.data as EntryData;

async function http(
  login: Login | null,
  method: "GET" | "POST",
  url: string,
  options: { payload?: object; key?: string } = {},
): Promise<Reply> {
  const response = await app.inject({
    method,
    url,
    ...(login ? { cookies: { refresh_token: tokens[login], csrf_token: CSRF } } : {}),
    headers: {
      ...(login && method === "POST" ? { "x-csrf-token": CSRF } : {}),
      ...(options.key ? { "idempotency-key": options.key } : {}),
    },
    ...(options.payload ? { payload: options.payload } : {}),
  });
  return { status: response.statusCode, body: response.json() as Reply["body"] };
}

const callRoute = (login: Login | null, clientId: string, entry: EntryRef, route: Route) =>
  http(
    login,
    "POST",
    `${journalUrl(clientId)}/${entry.id}/${route}`,
    route === "post" ? { payload: { expectedRowVersion: entry.rowVersion }, key: newKey() } : {},
  );

const lines = (client: ClientFx, amount: string) => [
  {
    accountId: client.cajaId,
    currencyCode: "ARS",
    debitOriginal: amount,
    creditOriginal: "0.00",
    debitFunctional: amount,
    creditFunctional: "0.00",
  },
  {
    accountId: client.capitalId,
    currencyCode: "ARS",
    debitOriginal: "0.00",
    creditOriginal: amount,
    debitFunctional: "0.00",
    creditFunctional: amount,
  },
];

/** Deja un asiento del cliente en el estado pedido, por el servicio y con el rol runtime. */
async function entryIn(
  client: ClientFx,
  state: State,
  preparer: Actor = "maker",
): Promise<EntryRef> {
  counter += 1;
  const draft = await journal.createDraft(ctxOf(ID[preparer], client.id), {
    clientId: client.id,
    fiscalYearId: client.fiscalYearId,
    periodId: client.periodId,
    entryDate: "2026-01-15",
    description: `Demo asiento ${counter} (${state})`,
    sourceType: "MANUAL",
    lines: lines(client, "100.00"),
  });
  if (state === "DRAFT") return { id: draft.id, rowVersion: draft.rowVersion };
  await journal.submit(ctxOf(ID[preparer], client.id), draft.id);
  if (state === "IN_REVIEW") return { id: draft.id, rowVersion: draft.rowVersion };
  const reviewed = await journal.review(ctxOf(ID.checker, client.id), draft.id);
  if (state === "REVIEWED") return { id: draft.id, rowVersion: reviewed.rowVersion };
  const posted = await journal.post(ctxOf(ID.checker, client.id), draft.id, reviewed.rowVersion);
  return { id: draft.id, rowVersion: posted.rowVersion };
}

/** Lectura con el cliente administrador: lo que quedó guardado, sin pasar por la API. */
async function snapshot(entryId: string) {
  const row = await admin.journalEntry.findUniqueOrThrow({ where: { id: entryId } });
  return {
    status: row.status,
    rowVersion: row.rowVersion,
    sequenceNumber: row.sequenceNumber,
    submittedAt: row.submittedAt,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt,
    postedByUserId: row.postedByUserId,
    postedAt: row.postedAt,
    reversedByEntryId: row.reversedByEntryId,
  };
}

async function createClient(label: string): Promise<ClientFx> {
  const client = await admin.client.create({
    data: {
      firmId: FIRM,
      legalName: `Demo cliente ${label} (C1)`,
      cuit: validTestCuit(),
      status: "ACTIVE",
    },
  });
  const fiscalYear = await admin.fiscalYear.create({
    data: {
      firmId: FIRM,
      clientId: client.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      label: `Demo ${label} 2026`,
      status: "OPEN",
    },
  });
  const period = await admin.accountingPeriod.create({
    data: {
      firmId: FIRM,
      clientId: client.id,
      fiscalYearId: fiscalYear.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-01-31"),
      ordinal: 1,
      status: "OPEN",
    },
  });
  const caja = await admin.account.create({
    data: {
      firmId: FIRM,
      clientId: client.id,
      code: "1.1.1",
      name: `Caja Demo ${label}`,
      type: "ASSET",
      normalBalance: "DEBIT",
      isPostable: true,
      path: "1.1.1",
    },
  });
  const capital = await admin.account.create({
    data: {
      firmId: FIRM,
      clientId: client.id,
      code: "3.1.1",
      name: `Capital Demo ${label}`,
      type: "EQUITY",
      normalBalance: "CREDIT",
      isPostable: true,
      path: "3.1.1",
    },
  });
  return {
    id: client.id,
    fiscalYearId: fiscalYear.id,
    periodId: period.id,
    cajaId: caja.id,
    capitalId: capital.id,
  };
}

beforeAll(async () => {
  admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: ADMIN_DATABASE_URL }) });
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  await admin.firm.createMany({
    data: [
      {
        id: FIRM,
        legalName: "Demo estudio C1 (asientos por cliente)",
        displayName: "Demo estudio C1",
      },
      { id: OTHER_FIRM, legalName: "Demo estudio C1 ajeno", displayName: "Demo estudio C1 ajeno" },
    ],
  });
  await admin.user.createMany({
    data: (Object.keys(ID) as Actor[]).map((actor) => ({
      id: ID[actor],
      emailNormalized: `${ID[actor]}@asientos.demo.test.local`,
      name: `Demo ${actor}`,
      passwordHash: "x",
    })),
  });
  const memberships = [
    { firmId: FIRM, userId: ID.owner, role: "OWNER" },
    { firmId: FIRM, userId: ID.admin, role: "ADMIN" },
    { firmId: FIRM, userId: ID.maker, role: "PREPARER" },
    { firmId: FIRM, userId: ID.checker, role: "REVIEWER" },
    { firmId: FIRM, userId: ID.preparerA, role: "PREPARER" },
    { firmId: FIRM, userId: ID.reviewerA, role: "REVIEWER" },
    { firmId: FIRM, userId: ID.preparerB, role: "PREPARER" },
    { firmId: OTHER_FIRM, userId: ID.outsider, role: "OWNER" },
  ] as const;
  await admin.firmMembership.createMany({
    data: memberships.map((m) => ({ ...m, status: "ACTIVE" as const, acceptedAt: new Date() })),
  });

  A = await createClient("A");
  B = await createClient("B");
  // preparerA y reviewerA solo están asignados al cliente A; preparerB, solo al B.
  // maker y checker (preparan y aprueban los datos de prueba) están asignados a los dos.
  await admin.clientAssignment.createMany({
    data: [
      { firmId: FIRM, userId: ID.preparerA, clientId: A.id },
      { firmId: FIRM, userId: ID.reviewerA, clientId: A.id },
      { firmId: FIRM, userId: ID.preparerB, clientId: B.id },
      { firmId: FIRM, userId: ID.maker, clientId: A.id },
      { firmId: FIRM, userId: ID.maker, clientId: B.id },
      { firmId: FIRM, userId: ID.checker, clientId: A.id },
      { firmId: FIRM, userId: ID.checker, clientId: B.id },
    ],
  });

  for (const login of LOGINS) tokens[login] = randomBytes(32).toString("base64url");
  await admin.deviceSession.createMany({
    data: LOGINS.map((login) => ({
      id: randomUUID(),
      userId: ID[login],
      refreshTokenHash: sha256(tokens[login]),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })),
  });
});

afterAll(async () => {
  await app.close();
  await admin.$disconnect();
});

describe("asientos por HTTP con la ruta del cliente del propio asiento (lo vigente)", () => {
  it("la API corre con el rol de producción: contable_runtime, sin superusuario ni BYPASSRLS", async () => {
    const [role] = await prisma.$queryRaw<{ name: string; super: boolean; bypass: boolean }[]>`
      SELECT current_user::text AS name, r.rolsuper AS super, r.rolbypassrls AS bypass
      FROM pg_roles r WHERE r.rolname = current_user`;
    expect(role).toEqual({ name: "contable_runtime", super: false, bypass: false });
  });

  it("ciclo completo: crea, envía, aprueba, contabiliza y revierte con la ruta del cliente", async () => {
    const created = await http("preparerA", "POST", journalUrl(A.id), {
      payload: {
        fiscalYearId: A.fiscalYearId,
        periodId: A.periodId,
        entryDate: "2026-01-20",
        description: "Demo ciclo completo por HTTP",
        sourceType: "MANUAL",
        lines: lines(A, "250.00"),
      },
    });
    expect(created.status).toBe(201);
    expect(entryOf(created).status).toBe("DRAFT");
    expect(entryOf(created).clientId).toBe(A.id);
    const entry: EntryRef = { id: entryOf(created).id, rowVersion: entryOf(created).rowVersion };

    const submitted = await callRoute("preparerA", A.id, entry, "submit");
    expect([submitted.status, entryOf(submitted).status]).toEqual([200, "IN_REVIEW"]);
    const reviewed = await callRoute("reviewerA", A.id, entry, "review");
    expect([reviewed.status, entryOf(reviewed).status]).toEqual([200, "REVIEWED"]);
    const posted = await callRoute("reviewerA", A.id, entry, "post");
    expect([posted.status, entryOf(posted).status]).toEqual([200, "POSTED"]);
    expect(entryOf(posted).sequenceNumber).toBeGreaterThan(0);
    expect(entryOf(posted).rowVersion).toBe(entry.rowVersion + 1);

    const reversed = await http("reviewerA", "POST", `${journalUrl(A.id)}/${entry.id}/reverse`, {
      payload: { description: "Demo reversión del ciclo completo" },
    });
    expect([reversed.status, entryOf(reversed).status]).toEqual([200, "POSTED"]);
    expect(entryOf(reversed).reversalOfId).toBe(entry.id);
    expect((await snapshot(entry.id)).status).toBe("REVERSED");
  });

  it("rechazar un asiento en revisión lo deja en REJECTED", async () => {
    const entry = await entryIn(A, "IN_REVIEW");
    const rejected = await callRoute("reviewerA", A.id, entry, "reject");
    expect([rejected.status, entryOf(rejected).status]).toEqual([200, "REJECTED"]);
    expect((await snapshot(entry.id)).status).toBe("REJECTED");
  });

  it.each([
    ["submit", "IN_REVIEW", "preparerA", "ENTRY_NOT_EDITABLE"],
    ["review", "DRAFT", "reviewerA", "ENTRY_NOT_REVIEWABLE"],
    ["reject", "DRAFT", "reviewerA", "ENTRY_NOT_REVIEWABLE"],
    ["post", "IN_REVIEW", "reviewerA", "ENTRY_NOT_POSTABLE"],
    ["reverse", "REVIEWED", "reviewerA", "ENTRY_NOT_REVERSIBLE"],
  ] as const)(
    "%s con el asiento en estado %s: 400 %s sin tocar el asiento",
    async (route, state, login, code) => {
      const entry = await entryIn(A, state);
      const before = await snapshot(entry.id);
      const reply = await callRoute(login, A.id, entry, route);
      expect([reply.status, reply.body.error?.code]).toEqual([400, code]);
      expect(await snapshot(entry.id)).toEqual(before);
    },
  );

  it("maker-checker: quien preparó el asiento no lo aprueba (400)", async () => {
    const entry = await entryIn(A, "IN_REVIEW", "owner");
    const reply = await callRoute("owner", A.id, entry, "review");
    expect([reply.status, reply.body.error?.code]).toEqual([400, "ENTRY_NOT_REVIEWABLE"]);
    expect((await snapshot(entry.id)).status).toBe("IN_REVIEW");
  });

  it("post con una versión desactualizada: 409 ROW_VERSION_CONFLICT", async () => {
    const entry = await entryIn(A, "REVIEWED");
    const reply = await http("reviewerA", "POST", `${journalUrl(A.id)}/${entry.id}/post`, {
      payload: { expectedRowVersion: entry.rowVersion + 5 },
      key: newKey(),
    });
    expect([reply.status, reply.body.error?.code]).toEqual([409, "ROW_VERSION_CONFLICT"]);
    expect((await snapshot(entry.id)).status).toBe("REVIEWED");
  });

  it("post sin una clave de idempotencia válida: 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const entry = await entryIn(A, "REVIEWED");
    const reply = await http("reviewerA", "POST", `${journalUrl(A.id)}/${entry.id}/post`, {
      payload: { expectedRowVersion: entry.rowVersion },
      key: "corta",
    });
    expect([reply.status, reply.body.error?.code]).toEqual([400, "IDEMPOTENCY_KEY_REQUIRED"]);
    expect((await snapshot(entry.id)).status).toBe("REVIEWED");
  });

  it("idempotencia de post: repetir la misma clave no contabiliza dos veces", async () => {
    const entry = await entryIn(A, "REVIEWED");
    const key = newKey();
    const send = () =>
      http("reviewerA", "POST", `${journalUrl(A.id)}/${entry.id}/post`, {
        payload: { expectedRowVersion: entry.rowVersion },
        key,
      });
    const first = await send();
    expect([first.status, entryOf(first).status]).toEqual([200, "POSTED"]);
    const sequence = (await snapshot(entry.id)).sequenceNumber;
    const repeated = await send();
    expect([repeated.status, repeated.body.error?.code]).toEqual([400, "ENTRY_NOT_POSTABLE"]);
    const after = await snapshot(entry.id);
    expect([after.status, after.rowVersion, after.sequenceNumber]).toEqual([
      "POSTED",
      entry.rowVersion + 1,
      sequence,
    ]);
  });

  it("post concurrente con la misma clave: una sola contabilización y un solo registro de idempotencia", async () => {
    const entry = await entryIn(A, "REVIEWED");
    const key = newKey();
    const replies = await Promise.all(
      [0, 1].map(() =>
        http("reviewerA", "POST", `${journalUrl(A.id)}/${entry.id}/post`, {
          payload: { expectedRowVersion: entry.rowVersion },
          key,
        }),
      ),
    );
    for (const reply of replies) {
      const done = reply.status === 200 && entryOf(reply).status === "POSTED";
      const late = reply.status === 400 && reply.body.error?.code === "ENTRY_NOT_POSTABLE";
      expect(done || late).toBe(true);
    }
    expect(replies.some((reply) => reply.status === 200)).toBe(true);
    const after = await snapshot(entry.id);
    expect([after.status, after.rowVersion]).toEqual(["POSTED", entry.rowVersion + 1]);
    const records = await admin.idempotencyRecord.findMany({
      where: { firmId: FIRM, scope: `journal.post:${entry.id}`, key },
    });
    expect(records.map((record) => record.status)).toEqual(["COMPLETED"]);
  });

  it.each([
    ["preparerA", "review"],
    ["preparerA", "reject"],
    ["preparerA", "post"],
    ["preparerA", "reverse"],
    ["reviewerA", "submit"],
  ] as const)(
    "capacidades por rol: %s no puede %s (403 CAPABILITY_REQUIRED)",
    async (login, route) => {
      const entry = await entryIn(A, FROM[route]);
      const before = await snapshot(entry.id);
      const reply = await callRoute(login, A.id, entry, route);
      expect([reply.status, reply.body.error?.code]).toEqual([403, "CAPABILITY_REQUIRED"]);
      expect(await snapshot(entry.id)).toEqual(before);
    },
  );

  it("sin sesión: 401 UNAUTHENTICATED", async () => {
    const entry = await entryIn(A, "DRAFT");
    const reply = await callRoute(null, A.id, entry, "submit");
    expect([reply.status, reply.body.error?.code]).toEqual([401, "UNAUTHENTICATED"]);
    expect((await snapshot(entry.id)).status).toBe("DRAFT");
  });

  it("ajeno al estudio o no asignado al cliente de la ruta: 404 RESOURCE_NOT_FOUND de la guardia", async () => {
    const entry = await entryIn(A, "DRAFT");
    const outsider = await callRoute("outsider", A.id, entry, "submit");
    expect([outsider.status, outsider.body.error?.code]).toEqual([404, "RESOURCE_NOT_FOUND"]);
    const otherClient = await callRoute("preparerB", A.id, entry, "submit");
    expect([otherClient.status, otherClient.body.error?.code]).toEqual([404, "RESOURCE_NOT_FOUND"]);
    expect((await snapshot(entry.id)).status).toBe("DRAFT");
  });

  it("el listado de un cliente trae solo los asientos de ese cliente", async () => {
    const inA = await entryIn(A, "DRAFT");
    const inB = await entryIn(B, "DRAFT");
    const reply = await http("owner", "GET", journalUrl(A.id));
    const rows = reply.body.data as EntryData[];
    expect(reply.status).toBe(200);
    expect(rows.every((row) => row.clientId === A.id)).toBe(true);
    expect(rows.map((row) => row.id)).toContain(inA.id);
    expect(rows.map((row) => row.id)).not.toContain(inB.id);
  });

  it("la base, con el rol runtime y app.client_id de A, todavía devuelve un asiento de B", async () => {
    // vigente: cambia con A16 D16-3 (migración de políticas RLS de asientos, fila aparte)
    const inB = await entryIn(B, "DRAFT");
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${ID.preparerA}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${FIRM}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', ${A.id}, true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM journal_entries WHERE id = ${inB.id}`;
    });
    expect(rows).toEqual([{ id: inB.id }]);
  });
});

// --- fin de la caracterización ---

/*
 * Corte C1: el asiento se carga por el cliente de la ruta. Un asiento llamado con la ruta de
 * otro cliente del mismo estudio responde 404, con el mismo texto que un id que no existe.
 */
const ROUTES: readonly Route[] = ["submit", "review", "reject", "post", "reverse"];
/** Estado que muestra la respuesta de cada ruta cuando sale bien. */
const RESULT: Record<Route, string> = {
  submit: "IN_REVIEW",
  review: "REVIEWED",
  reject: "REJECTED",
  post: "POSTED",
  reverse: "POSTED",
};
/** Quién llama a cada ruta: el rol de menor privilegio con la capacidad, el Titular y el Administrador. */
const CALLS: ReadonlyArray<readonly [Login, Route]> = [
  ["preparerA", "submit"],
  ["reviewerA", "review"],
  ["reviewerA", "reject"],
  ["reviewerA", "post"],
  ["reviewerA", "reverse"],
  ...ROUTES.map((route) => ["owner", route] as const),
  ...ROUTES.map((route) => ["admin", route] as const),
];
/** Las mismas llamadas con la ruta del propio cliente del asiento; Titular y Administrador, también en B. */
const OWN_CLIENT_CALLS: ReadonlyArray<readonly [Login, Route, "A" | "B"]> = [
  ...CALLS.map(([login, route]) => [login, route, "A"] as const),
  ...ROUTES.flatMap((route) =>
    (["owner", "admin"] as const).map((login) => [login, route, "B"] as const),
  ),
];
const NOT_FOUND_IN_CLIENT = [
  404,
  "RESOURCE_NOT_FOUND",
  "No encontramos el asiento en este cliente. Abrilo desde la ficha del cliente donde está.",
];
const shape = (reply: Reply) => [reply.status, reply.body.error?.code, reply.body.error?.message];

describe("asientos acotados por el cliente de la ruta (corte C1)", () => {
  it.each(CALLS)(
    "%s llama a %s con la ruta de A y el id de un asiento de B: 404 y el asiento queda intacto",
    async (login, route) => {
      const entry = await entryIn(B, FROM[route]);
      const before = await snapshot(entry.id);
      const reply = await callRoute(login, A.id, entry, route);
      expect(shape(reply)).toEqual(NOT_FOUND_IN_CLIENT);
      expect(await snapshot(entry.id)).toEqual(before);
    },
  );

  it.each(OWN_CLIENT_CALLS)(
    "%s llama a %s con la ruta del cliente %s y el id de su propio asiento: se opera",
    async (login, route, which) => {
      const client = which === "A" ? A : B;
      const entry = await entryIn(client, FROM[route]);
      const reply = await callRoute(login, client.id, entry, route);
      expect([reply.status, entryOf(reply).status]).toEqual([200, RESULT[route]]);
    },
  );

  it.each(CALLS.slice(0, 5))(
    "%s, %s: un id que no existe y un asiento de otro cliente responden lo mismo",
    async (login, route) => {
      const foreign = await entryIn(B, FROM[route]);
      const missing = await callRoute(login, A.id, { id: randomUUID(), rowVersion: 1 }, route);
      expect(shape(missing)).toEqual(NOT_FOUND_IN_CLIENT);
      expect(shape(await callRoute(login, A.id, foreign, route))).toEqual(shape(missing));
    },
  );

  it("sin cliente en el contexto, el servicio no opera ningún asiento", async () => {
    const entry = await entryIn(A, "DRAFT");
    const withoutClient: TenantContext = { userId: ID.owner, firmId: FIRM, actorKind: "USER" };
    await expect(journal.submit(withoutClient, entry.id)).rejects.toThrow(
      "requiere el cliente de la ruta",
    );
    expect((await snapshot(entry.id)).status).toBe("DRAFT");
  });
});
