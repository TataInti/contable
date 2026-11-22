import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Cuota fija mensual del Monotributo por HTTP (corte 3F): vigencias, cuota por categoría y tipo,
 * mensajes de lo que falta, pagos con historial, aislamiento por estudio y RLS con el rol runtime.
 * Datos sintéticos: el CUIT y los clientes son de prueba; la escala es la de la migración.
 */

const OWNER_ALFA = "11111111-1111-4111-8111-111111111111";
const OWNER_BETA = "22222222-2222-4222-8222-222222222222";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRM_BETA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CSRF = "csrf-monotributo-test-0123456789abcdef";

let app: FastifyInstance | null = null;
let alfaToken = "";
let betaToken = "";
let clientId = "";
let clientSinMonotributoId = "";
let profileId = "";
let registrationId = "";
let monotributoRegimeTaxTypeId = "";
let previousDefaultFamilyId: string | null = null;
const createdClientIds: string[] = [];

const base = (id: string) => `/api/v1/firms/${FIRM_ALFA}/clients/${id}/monotributo`;

function get(token: string, url: string) {
  return app!.inject({ method: "GET", url, cookies: { refresh_token: token } });
}

function send(method: "PUT" | "POST", token: string, url: string, payload: Record<string, unknown>) {
  return app!.inject({
    method,
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload,
  });
}

/** Lectura con el rol runtime (sin BYPASSRLS): cuenta los pagos del cliente que ve un usuario de un estudio. */
async function pagosVisibles(runtime: PrismaClient, firmId: string, userId: string, id: string) {
  return runtime.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${userId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${firmId}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
    const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM client_monotributo_payments WHERE "clientId" = ${id}`;
    return Number(rows[0]!.n);
  });
}

beforeAll(async () => {
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();
  alfaToken = randomBytes(32).toString("base64url");
  betaToken = randomBytes(32).toString("base64url");
  await prisma.deviceSession.createMany({
    data: [
      [OWNER_ALFA, alfaToken],
      [OWNER_BETA, betaToken],
    ].map(([userId, token]) => ({
      id: randomUUID(),
      userId: userId!,
      refreshTokenHash: sha256(token!),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })),
  });

  // Cliente con inscripción al Monotributo nacional: el tipo de impuesto pertenece a la familia MONOTRIBUTO.
  const regime = await prisma.taxRegime.findUniqueOrThrow({ where: { code: "MONOTRIBUTO" } });
  monotributoRegimeTaxTypeId = regime.taxTypeId;
  const family = await prisma.calcFamily.findFirstOrThrow({ where: { key: "MONOTRIBUTO" } });
  const taxType = await prisma.taxType.findUniqueOrThrow({ where: { id: regime.taxTypeId } });
  previousDefaultFamilyId = taxType.defaultFamilyId;
  await prisma.taxType.update({ where: { id: regime.taxTypeId }, data: { defaultFamilyId: family.id } });

  const client = await prisma.client.create({
    data: { firmId: FIRM_ALFA, legalName: `Cliente Monotributo ${randomUUID()}`, cuit: "30999999961", status: "ACTIVE" },
  });
  clientId = client.id;
  createdClientIds.push(client.id);
  const perfil = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM_ALFA,
      clientId,
      legalName: "Cliente Monotributo sintético",
      cuit: "30999999961",
      personType: "FISICA",
      nationalCondition: "MONOTRIBUTISTA",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  profileId = perfil.id;
  const registro = await prisma.taxRegistration.create({
    data: {
      firmId: FIRM_ALFA,
      clientId,
      profileVersionId: profileId,
      regimeId: regime.id,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  registrationId = registro.id;

  // Cliente sin inscripción al Monotributo (para el mensaje de «no aplica»).
  const sin = await prisma.client.create({
    data: { firmId: FIRM_ALFA, legalName: `Cliente sin Monotributo ${randomUUID()}`, cuit: "30999999962", status: "ACTIVE" },
  });
  clientSinMonotributoId = sin.id;
  createdClientIds.push(sin.id);
});

afterAll(async () => {
  await prisma.clientMonotributoPayment.deleteMany({ where: { clientId: { in: createdClientIds } } });
  await prisma.clientMonotributoCategory.deleteMany({ where: { clientId: { in: createdClientIds } } });
  await prisma.taxRegistration.deleteMany({ where: { id: registrationId } });
  await prisma.taxpayerProfileVersion.deleteMany({ where: { id: profileId } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
  if (monotributoRegimeTaxTypeId) {
    await prisma.taxType.update({
      where: { id: monotributoRegimeTaxTypeId },
      data: { defaultFamilyId: previousDefaultFamilyId },
    });
  }
  await prisma.deviceSession.deleteMany({
    where: { refreshTokenHash: { in: [alfaToken, betaToken].filter(Boolean).map(sha256) } },
  });
  await app?.close();
  app = null;
});

describe("cuota fija mensual del Monotributo — API", () => {
  it("sin categoría, la cuota del mes dice qué falta y lleva el vencimiento del día 20", async () => {
    const response = await get(alfaToken, `${base(clientId)}?month=2026-08`);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      month: "2026-08",
      applies: true,
      status: "SIN_CATEGORIA",
      category: null,
      fee: null,
      dueDate: "2026-08-20",
      paid: "0.00",
      payments: [],
    });
    expect(response.json().data.regimeIds).toHaveLength(1);
  });

  it("elige la categoría desde agosto y toma la cuota oficial del tipo de actividad", async () => {
    const saved = await send("PUT", alfaToken, `${base(clientId)}-categories/2026-08`, { category: "c", activity: "SERVICIOS" });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({
      status: "PENDIENTE",
      category: { validFrom: "2026-08-01", category: "C", activity: "SERVICIOS" },
      fee: "66020.12",
      pending: "66020.12",
    });
    expect(saved.json().data.feeSource).toContain("ARCA");
  });

  it("la venta de bienes cambia la cuota a la de su columna", async () => {
    const saved = await send("PUT", alfaToken, `${base(clientId)}-categories/2026-08`, { category: "C", activity: "BIENES" });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ fee: "64530.58", category: { activity: "BIENES" } });
  });

  it("la categoría cambia en la recategorización de julio y no antes", async () => {
    expect((await send("PUT", alfaToken, `${base(clientId)}-categories/2026-01`, { category: "A", activity: "SERVICIOS" })).statusCode).toBe(200);
    expect((await send("PUT", alfaToken, `${base(clientId)}-categories/2026-07`, { category: "E", activity: "BIENES" })).statusCode).toBe(200);

    const junio = await get(alfaToken, `${base(clientId)}?month=2026-06`);
    expect(junio.json().data.category).toMatchObject({ validFrom: "2026-01-01", category: "A", activity: "SERVICIOS" });
    expect(junio.json().data.fee).toBeNull();
    expect(junio.json().data.status).toBe("SIN_CUOTA");

    const julio = await get(alfaToken, `${base(clientId)}?month=2026-07`);
    expect(julio.json().data.category).toMatchObject({ validFrom: "2026-07-01", category: "E", activity: "BIENES" });

    const agosto = await get(alfaToken, `${base(clientId)}?month=2026-08`);
    expect(agosto.json().data.category).toMatchObject({ category: "C", activity: "BIENES" });
    expect(agosto.json().data.history.map((row: { validFrom: string }) => row.validFrom)).toEqual([
      "2026-08-01",
      "2026-07-01",
      "2026-01-01",
    ]);
  });

  it("una categoría o un tipo que no existen devuelven el campo y el motivo", async () => {
    const categoria = await send("PUT", alfaToken, `${base(clientId)}-categories/2026-08`, { category: "Z", activity: "SERVICIOS" });
    expect(categoria.statusCode).toBe(422);
    expect(categoria.json().error).toMatchObject({ code: "MONOTRIBUTO_CATEGORY_UNKNOWN", details: { path: ["category"] } });

    const tipo = await send("PUT", alfaToken, `${base(clientId)}-categories/2026-08`, { category: "C", activity: "OTRA" });
    expect(tipo.statusCode).toBe(422);
    expect(tipo.json().error).toMatchObject({ code: "MONOTRIBUTO_ACTIVITY_UNKNOWN", details: { path: ["activity"] } });

    const vacia = await send("PUT", alfaToken, `${base(clientId)}-categories/2026-08`, { category: "", activity: "SERVICIOS" });
    expect(vacia.statusCode).toBe(400);
    expect(vacia.json().error.details[0].path).toEqual(["category"]);
  });

  it("un mes con formato inválido devuelve el campo mes", async () => {
    const response = await get(alfaToken, `${base(clientId)}?month=2026-13`);
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatchObject({ code: "MONOTRIBUTO_MONTH_INVALID", details: { path: ["month"] } });
  });

  it("registra pagos del mes, los suma en el historial y la cuota queda pagada al cubrirla", async () => {
    const primero = await send("POST", alfaToken, `${base(clientId)}/payments`, {
      month: "2026-08",
      paidAt: "2026-08-18",
      amount: "30000",
      comprobante: "  REC-0001  ",
    });
    expect(primero.statusCode).toBe(201);
    expect(primero.json().data).toMatchObject({ status: "PENDIENTE", paid: "30000.00", pending: "34530.58" });
    expect(primero.json().data.payments[0]).toMatchObject({ paidAt: "2026-08-18", amount: "30000.00", comprobante: "REC-0001" });

    const segundo = await send("POST", alfaToken, `${base(clientId)}/payments`, {
      month: "2026-08",
      paidAt: "2026-08-19",
      amount: "34530.58",
    });
    expect(segundo.statusCode).toBe(201);
    expect(segundo.json().data).toMatchObject({ status: "PAGADA", paid: "64530.58", pending: "0.00" });
    expect(segundo.json().data.payments).toHaveLength(2);
    expect(segundo.json().data.payments[1].comprobante).toBeNull();
  });

  it("el pago valida fecha e importe y los devuelve con su campo", async () => {
    const importe = await send("POST", alfaToken, `${base(clientId)}/payments`, { month: "2026-08", paidAt: "2026-08-20", amount: "0" });
    expect(importe.statusCode).toBe(422);
    expect(importe.json().error).toMatchObject({ code: "MONOTRIBUTO_AMOUNT_INVALID", details: { path: ["amount"] } });

    const fecha = await send("POST", alfaToken, `${base(clientId)}/payments`, { month: "2026-08", paidAt: "2026-02-30", amount: "100" });
    expect(fecha.statusCode).toBe(422);
    expect(fecha.json().error).toMatchObject({ code: "MONOTRIBUTO_DATE_INVALID", details: { path: ["paidAt"] } });
  });

  it("sin inscripción al Monotributo, la cuota no aplica y no se eligen categorías ni pagos", async () => {
    const lectura = await get(alfaToken, `${base(clientSinMonotributoId)}?month=2026-08`);
    expect(lectura.json().data).toMatchObject({ applies: false, status: "NO_APLICA" });

    const categoria = await send("PUT", alfaToken, `${base(clientSinMonotributoId)}-categories/2026-08`, { category: "A", activity: "SERVICIOS" });
    expect(categoria.statusCode).toBe(422);
    expect(categoria.json().error.code).toBe("MONOTRIBUTO_NOT_REGISTERED");

    const pago = await send("POST", alfaToken, `${base(clientSinMonotributoId)}/payments`, { month: "2026-08", paidAt: "2026-08-20", amount: "100" });
    expect(pago.statusCode).toBe(422);
    expect(pago.json().error.code).toBe("MONOTRIBUTO_NOT_REGISTERED");
  });

  it("otro estudio no lee ni escribe la cuota de este cliente", async () => {
    const read = await get(betaToken, `${base(clientId)}?month=2026-08`);
    expect([403, 404]).toContain(read.statusCode);
    const write = await send("PUT", betaToken, `${base(clientId)}-categories/2026-08`, { category: "E", activity: "SERVICIOS" });
    expect([403, 404]).toContain(write.statusCode);
    const pay = await send("POST", betaToken, `${base(clientId)}/payments`, { month: "2026-08", paidAt: "2026-08-20", amount: "10" });
    expect([403, 404]).toContain(pay.statusCode);
    const stored = await prisma.clientMonotributoCategory.findFirst({ where: { clientId, validFrom: new Date("2026-08-01T00:00:00.000Z") } });
    expect(stored).toMatchObject({ category: "C", activity: "BIENES" });
    expect(await prisma.clientMonotributoPayment.count({ where: { clientId } })).toBe(2);
  });
});

describe("cuota fija mensual del Monotributo — RLS y runtime", () => {
  it("el rol runtime ve los pagos solo al estudio del cliente", async () => {
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.RUNTIME_DATABASE_URL ?? "" }) });
    try {
      expect(await pagosVisibles(runtime, FIRM_ALFA, OWNER_ALFA, clientId)).toBe(2);
      expect(await pagosVisibles(runtime, FIRM_BETA, OWNER_BETA, clientId)).toBe(0);
    } finally {
      await runtime.$disconnect();
    }
  });

  it("el rol runtime no puede borrar ni editar pagos, y solo puede editar categorías", async () => {
    const [privilegios] = await prisma.$queryRaw<{ pagos_delete: boolean; pagos_update: boolean; pagos_insert: boolean; cat_delete: boolean; cat_update: boolean }[]>`
      SELECT
        has_table_privilege('contable_runtime', 'client_monotributo_payments', 'DELETE') AS pagos_delete,
        has_table_privilege('contable_runtime', 'client_monotributo_payments', 'UPDATE') AS pagos_update,
        has_table_privilege('contable_runtime', 'client_monotributo_payments', 'INSERT') AS pagos_insert,
        has_table_privilege('contable_runtime', 'client_monotributo_categories', 'DELETE') AS cat_delete,
        has_table_privilege('contable_runtime', 'client_monotributo_categories', 'UPDATE') AS cat_update`;
    expect(privilegios).toMatchObject({ pagos_delete: false, pagos_update: false, pagos_insert: true, cat_delete: false, cat_update: true });
  });
});
