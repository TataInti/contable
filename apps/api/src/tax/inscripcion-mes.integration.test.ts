import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Corte 1F: inscripción con fecha «Desde» y «Abrir mes» de un mes anterior.
 * Datos sintéticos (clientes «T-…», CUIT inventados con dígito verificador válido). Base real:
 * ruta, servicio y auditoría. Requiere DATABASE_URL de una base descartable con los maestros fiscales.
 */

const RUN = randomUUID();
const FIRM = randomUUID();
const FIRM_AJENA = randomUUID();
const OWNER = randomUUID();
const OWNER_AJENO = randomUUID();
const AUDITOR = randomUUID();
const CSRF = `csrf-1f-${RUN}`;
const BASE = `/api/v1/firms/${FIRM}`;

let app: FastifyInstance | null = null;
let ownerToken = "";
let ownerAjenoToken = "";
let auditorToken = "";
let regimeIibb = "";
let regimeTem = "";
let taxTypeIibb = "";

type ApiResponse = { statusCode: number; body: string; json(): unknown };
type Dato<T> = { data: T };
type Falla = { error: { code: string; message: string; details?: { path?: string[] } } };

function fallo(response: ApiResponse): Falla["error"] {
  return (response.json() as Falla).error;
}
function dato<T>(response: ApiResponse): T {
  return (response.json() as Dato<T>).data;
}
async function pedir(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: Record<string, unknown>, token = ownerToken) {
  return app!.inject({
    method,
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    ...(payload ? { payload } : {}),
  }) as Promise<ApiResponse>;
}

function cuitSintetico() {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = [...base].reduce((total, digit, index) => total + Number(digit) * weights[index]!, 0);
    const check = (11 - (sum % 11)) % 11;
    if (check < 10) return `${base}${check}`;
  }
}

async function sesion(userId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.deviceSession.create({
    data: {
      id: randomUUID(),
      userId,
      refreshTokenHash: sha256(token),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return token;
}

async function maestro(path: string, code: string) {
  const response = await pedir("GET", path);
  expect(response.statusCode, `catálogo ${path}: ${response.body}`).toBe(200);
  const row = dato<Array<{ id: string; code: string }>>(response).find((item) => item.code === code);
  expect(row, `maestro ${code} sembrado`).toBeTruthy();
  return row!.id;
}

/** Cliente nuevo con perfil activo; es el «alta de hoy» del recorrido. */
async function clienteConPerfil() {
  const cuit = cuitSintetico();
  const created = await pedir("POST", `${BASE}/clients`, { legalName: `T-Cliente 1F ${randomUUID().slice(0, 8)}`, cuit });
  expect(created.statusCode, created.body).toBe(201);
  const clientId = dato<{ id: string }>(created).id;
  const base = `${BASE}/clients/${clientId}`;
  const profile = await pedir("POST", `${base}/tax-profile-versions`, {
    legalName: "T-Cliente 1F",
    cuit,
    personType: "FISICA",
    nationalCondition: "MONOTRIBUTISTA",
    validFrom: "2026-01-01",
  });
  expect(profile.statusCode, profile.body).toBe(201);
  const profileId = dato<{ id: string }>(profile).id;
  expect((await pedir("POST", `${base}/tax-profile-versions/${profileId}/submit-review`)).statusCode).toBe(200);
  expect((await pedir("POST", `${base}/tax-profile-versions/${profileId}/activate`)).statusCode).toBe(200);
  await prisma.clientAssignment.create({ data: { firmId: FIRM, userId: AUDITOR, clientId } });
  return { clientId, base, profileId };
}

async function inscribir(c: { base: string; profileId: string }, regimeId: string, validFrom: string) {
  const response = await pedir("POST", `${c.base}/tax-registrations`, { profileVersionId: c.profileId, regimeId, validFrom });
  expect(response.statusCode, response.body).toBe(201);
  return dato<{ id: string }>(response).id;
}

beforeAll(async () => {
  app = await buildServer({
    postgres: async () => true,
    valkey: async () => true,
    minio: async () => true,
    ai: async () => true,
  });
  await app.ready();

  for (const firmId of [FIRM, FIRM_AJENA]) {
    await prisma.firm.create({
      data: { id: firmId, legalName: `T-Estudio 1F ${firmId.slice(0, 8)}`, displayName: `T-Estudio 1F ${firmId.slice(0, 8)}`, allowSelfReview: false },
    });
  }
  for (const [userId, firmId, role, nombre] of [
    [OWNER, FIRM, "OWNER", "owner"],
    [OWNER_AJENO, FIRM_AJENA, "OWNER", "ajeno"],
    [AUDITOR, FIRM, "AUDITOR_READONLY", "auditor"],
  ] as const) {
    await prisma.user.create({ data: { id: userId, emailNormalized: `t-1f-${nombre}-${RUN}@example.invalid`, name: `T-${nombre} 1F`, passwordHash: "-" } });
    await prisma.firmMembership.create({ data: { firmId, userId, role, status: "ACTIVE", acceptedAt: new Date() } });
  }
  ownerToken = await sesion(OWNER);
  ownerAjenoToken = await sesion(OWNER_AJENO);
  auditorToken = await sesion(AUDITOR);

  regimeIibb = await maestro("/api/v1/tax/regimes", "IIBB_LOCAL_TUC");
  regimeTem = await maestro("/api/v1/tax/regimes", "TEM_SMT");
  taxTypeIibb = await maestro("/api/v1/tax/types", "IIBB");
});

afterAll(async () => {
  try {
    await prisma.deviceSession.deleteMany({ where: { userId: { in: [OWNER, OWNER_AJENO, AUDITOR] } } });
  } finally {
    await app?.close();
    app = null;
  }
});

describe("1F · «Abrir mes» de un mes anterior con inscripción desde el pasado", () => {
  it("crea un período y una obligación por régimen en octubre cuando la inscripción empieza el 1/10", async () => {
    const c = await clienteConPerfil();
    await inscribir(c, regimeIibb, "2026-10-01");
    await inscribir(c, regimeTem, "2026-10-01");

    const abierto = await pedir("POST", `${c.base}/tax-periods/open-month`, { month: "2026-10" });
    expect(abierto.statusCode, abierto.body).toBe(201);
    expect(dato<Record<string, unknown>>(abierto)).toMatchObject({ regimes: 2, periodsCreated: 2, obligationsCreated: 2 });

    const obligaciones = dato<Array<{ regimeId: string; period: { startDate: string; endDate: string } }>>(await pedir("GET", `${c.base}/tax-obligations`));
    expect(obligaciones.map((o) => o.regimeId).sort()).toEqual([regimeIibb, regimeTem].sort());
    for (const o of obligaciones) {
      expect(o.period.startDate.slice(0, 10)).toBe("2026-10-01");
      expect(o.period.endDate.slice(0, 10)).toBe("2026-10-31");
    }
  });

  it("4L — con la inscripción de hoy también se abre octubre: la fecha «Desde» no bloquea el mes", async () => {
    const c = await clienteConPerfil();
    await inscribir(c, regimeIibb, "2026-11-21");

    const abierto = await pedir("POST", `${c.base}/tax-periods/open-month`, { month: "2026-10" });
    expect(abierto.statusCode, abierto.body).toBe(201);
    expect(dato<Record<string, unknown>>(abierto)).toMatchObject({ periodsCreated: 1, obligationsCreated: 1 });
  });

  it("4L — un cliente sin inscripción en ningún régimen no abre el mes (REGISTRATION_REQUIRED con guía)", async () => {
    const c = await clienteConPerfil();
    const rechazado = await pedir("POST", `${c.base}/tax-periods/open-month`, { month: "2026-10" });
    expect(rechazado.statusCode).toBe(409);
    expect(fallo(rechazado).code).toBe("REGISTRATION_REQUIRED");
    expect(fallo(rechazado).message).toContain("Registrá la inscripción");
  });

  it("4L — la corrección del «Desde» sigue disponible y no cambia la apertura del mes", async () => {
    const c = await clienteConPerfil();
    const regId = await inscribir(c, regimeIibb, "2026-11-21");

    const corregida = await pedir("PATCH", `${c.base}/tax-registrations/${regId}`, { validFrom: "2026-10-01" });
    expect(corregida.statusCode, corregida.body).toBe(200);
    expect(dato<{ validFrom: string }>(corregida).validFrom.slice(0, 10)).toBe("2026-10-01");

    const abierto = await pedir("POST", `${c.base}/tax-periods/open-month`, { month: "2026-10" });
    expect(abierto.statusCode, abierto.body).toBe(201);
    expect(dato<Record<string, unknown>>(abierto)).toMatchObject({ periodsCreated: 1, obligationsCreated: 1 });
  });
});

describe("1F · corregir la fecha «Desde» de una inscripción", () => {
  it("queda en la auditoría con la fecha anterior y la nueva", async () => {
    const c = await clienteConPerfil();
    const regId = await inscribir(c, regimeIibb, "2026-11-21");
    expect((await pedir("PATCH", `${c.base}/tax-registrations/${regId}`, { validFrom: "2026-10-01" })).statusCode).toBe(200);
    const evento = await prisma.auditEvent.findFirst({ where: { firmId: FIRM, entityType: "TaxRegistration", entityId: regId, action: "tax.registration.updated" } });
    expect(evento).toBeTruthy();
    expect(evento?.before).toMatchObject({ validFrom: "2026-11-21T00:00:00.000Z" });
    expect(evento?.after).toMatchObject({ validFrom: "2026-10-01T00:00:00.000Z" });
  });

  it("rechaza una fecha posterior al cierre de una obligación ya creada, con el campo y el motivo", async () => {
    const c = await clienteConPerfil();
    const regId = await inscribir(c, regimeIibb, "2026-10-01");
    expect((await pedir("POST", `${c.base}/tax-periods/open-month`, { month: "2026-10" })).statusCode).toBe(201);

    const rechazado = await pedir("PATCH", `${c.base}/tax-registrations/${regId}`, { validFrom: "2026-11-21" });
    expect(rechazado.statusCode).toBe(422);
    expect(fallo(rechazado).details?.path).toEqual(["validFrom"]);
    expect(fallo(rechazado).message).toContain("31/10/2026");
    const sigue = await prisma.taxRegistration.findUniqueOrThrow({ where: { id: regId } });
    expect(sigue.validFrom.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("rechaza un «Desde» posterior al «Hasta» de la inscripción", async () => {
    const c = await clienteConPerfil();
    const regId = await inscribir(c, regimeIibb, "2026-10-01");
    expect((await pedir("POST", `${c.base}/tax-registrations/${regId}/cancel`, { validTo: "2026-10-31" })).statusCode).toBe(200);
    const rechazado = await pedir("PATCH", `${c.base}/tax-registrations/${regId}`, { validFrom: "2026-11-05" });
    expect([409, 422]).toContain(rechazado.statusCode);
  });

  it("valida el formato de la fecha y que la inscripción exista en este cliente", async () => {
    const c = await clienteConPerfil();
    const otro = await clienteConPerfil();
    const regId = await inscribir(c, regimeIibb, "2026-11-21");
    expect((await pedir("PATCH", `${c.base}/tax-registrations/${regId}`, { validFrom: "01/10/2026" })).statusCode).toBe(400);
    const ajena = await pedir("PATCH", `${otro.base}/tax-registrations/${regId}`, { validFrom: "2026-10-01" });
    expect(ajena.statusCode).toBe(404);
    expect(fallo(ajena).code).toBe("REGISTRATION_NOT_FOUND");
  });

  it("solo quien puede escribir el perfil fiscal la corrige; otro estudio no la ve", async () => {
    const c = await clienteConPerfil();
    const regId = await inscribir(c, regimeIibb, "2026-11-21");
    const soloLectura = await pedir("PATCH", `${c.base}/tax-registrations/${regId}`, { validFrom: "2026-10-01" }, auditorToken);
    expect(soloLectura.statusCode).toBe(403);
    const ajeno = await pedir("PATCH", `${c.base}/tax-registrations/${regId}`, { validFrom: "2026-10-01" }, ownerAjenoToken);
    expect([403, 404]).toContain(ajeno.statusCode);
    const intacta = await prisma.taxRegistration.findUniqueOrThrow({ where: { id: regId } });
    expect(intacta.validFrom.toISOString().slice(0, 10)).toBe("2026-11-21");
  });
});

describe("1F · corregir o anular un período sin obligación", () => {
  async function periodoMalCargado(c: { base: string }) {
    const response = await pedir("POST", `${c.base}/tax-periods`, { taxTypeId: taxTypeIibb, startDate: "2026-11-21", endDate: "2026-11-21" });
    expect(response.statusCode, response.body).toBe(201);
    return dato<{ id: string }>(response).id;
  }

  it("corrige las fechas y la etiqueta, y lo deja en la auditoría", async () => {
    const c = await clienteConPerfil();
    const periodId = await periodoMalCargado(c);
    const corregido = await pedir("PATCH", `${c.base}/tax-periods/${periodId}`, { startDate: "2026-10-01", endDate: "2026-10-31", label: "Octubre 2026" });
    expect(corregido.statusCode, corregido.body).toBe(200);
    expect(dato<{ startDate: string; endDate: string; label: string }>(corregido)).toMatchObject({
      startDate: "2026-10-01T00:00:00.000Z",
      endDate: "2026-10-31T00:00:00.000Z",
      label: "Octubre 2026",
    });
    const evento = await prisma.auditEvent.findFirst({ where: { firmId: FIRM, entityType: "TaxPeriod", entityId: periodId, action: "tax.period.updated" } });
    expect(evento?.before).toMatchObject({ startDate: "2026-11-21T00:00:00.000Z" });
    expect(evento?.after).toMatchObject({ startDate: "2026-10-01T00:00:00.000Z" });
  });

  it("rechaza fechas invertidas o superpuestas con otro período del mismo impuesto", async () => {
    const c = await clienteConPerfil();
    const periodId = await periodoMalCargado(c);
    const invertido = await pedir("PATCH", `${c.base}/tax-periods/${periodId}`, { startDate: "2026-10-31", endDate: "2026-10-01" });
    expect(invertido.statusCode).toBe(422);
    expect(fallo(invertido).details?.path).toEqual(["endDate"]);

    const otro = await pedir("POST", `${c.base}/tax-periods`, { taxTypeId: taxTypeIibb, startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(otro.statusCode).toBe(201);
    const superpuesto = await pedir("PATCH", `${c.base}/tax-periods/${periodId}`, { startDate: "2026-09-15", endDate: "2026-10-15" });
    expect(superpuesto.statusCode).toBe(409);
    expect(fallo(superpuesto).code).toBe("PERIOD_OVERLAP");
  });

  it("anula un período sin obligación y queda en la auditoría", async () => {
    const c = await clienteConPerfil();
    const periodId = await periodoMalCargado(c);
    const anulado = await pedir("DELETE", `${c.base}/tax-periods/${periodId}`);
    expect(anulado.statusCode, anulado.body).toBe(200);
    expect(await prisma.taxPeriod.findUnique({ where: { id: periodId } })).toBeNull();
    const evento = await prisma.auditEvent.findFirst({ where: { firmId: FIRM, entityType: "TaxPeriod", entityId: periodId, action: "tax.period.deleted" } });
    expect(evento?.before).toMatchObject({ startDate: "2026-11-21T00:00:00.000Z", endDate: "2026-11-21T00:00:00.000Z" });
  });

  it("un período con obligación no se corrige ni se anula, y el mensaje lo explica", async () => {
    const c = await clienteConPerfil();
    await inscribir(c, regimeIibb, "2026-10-01");
    expect((await pedir("POST", `${c.base}/tax-periods/open-month`, { month: "2026-10" })).statusCode).toBe(201);
    const periodo = await prisma.taxPeriod.findFirstOrThrow({ where: { clientId: c.clientId } });

    const edicion = await pedir("PATCH", `${c.base}/tax-periods/${periodo.id}`, { startDate: "2026-10-02" });
    expect(edicion.statusCode).toBe(409);
    expect(fallo(edicion).code).toBe("PERIOD_IN_USE");
    expect(fallo(edicion).message).toContain("obligación");

    const baja = await pedir("DELETE", `${c.base}/tax-periods/${periodo.id}`);
    expect(baja.statusCode).toBe(409);
    expect(fallo(baja).code).toBe("PERIOD_IN_USE");

    const intacto = await prisma.taxPeriod.findUniqueOrThrow({ where: { id: periodo.id } });
    expect(intacto.startDate.toISOString().slice(0, 10)).toBe("2026-10-01");
    expect(await prisma.taxObligation.count({ where: { periodId: periodo.id } })).toBe(1);
  });

  it("un período con comprobantes asociados tampoco se anula", async () => {
    const c = await clienteConPerfil();
    const periodId = await periodoMalCargado(c);
    await prisma.importBatch.create({
      data: {
        firmId: FIRM,
        clientId: c.clientId,
        origin: "MANUAL",
        adapterVersion: "t-1f",
        taxTypeId: taxTypeIibb,
        periodId,
        fileHash: randomUUID().replaceAll("-", ""),
        fileName: "t-sintetico.csv",
        status: "COMMITTED",
        createdByUserId: OWNER,
      },
    });
    const baja = await pedir("DELETE", `${c.base}/tax-periods/${periodId}`);
    expect(baja.statusCode).toBe(409);
    expect(fallo(baja).code).toBe("PERIOD_IN_USE");
  });

  it("exige permiso de escritura, y el período debe ser de este cliente", async () => {
    const c = await clienteConPerfil();
    const otro = await clienteConPerfil();
    const periodId = await periodoMalCargado(c);
    expect((await pedir("PATCH", `${c.base}/tax-periods/${periodId}`, { label: "X" }, auditorToken)).statusCode).toBe(403);
    expect((await pedir("DELETE", `${c.base}/tax-periods/${periodId}`, undefined, auditorToken)).statusCode).toBe(403);
    expect((await pedir("DELETE", `${otro.base}/tax-periods/${periodId}`)).statusCode).toBe(404);
    expect((await pedir("PATCH", `${c.base}/tax-periods/${periodId}`, { startDate: "2026-10-01" }, ownerAjenoToken)).statusCode).toBeGreaterThanOrEqual(403);
    expect(await prisma.taxPeriod.findUnique({ where: { id: periodId } })).not.toBeNull();
  });
});
