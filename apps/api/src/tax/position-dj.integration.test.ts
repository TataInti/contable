import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Posición del legajo con la declaración jurada (DJ), corte 5b-2. Datos sintéticos rotulados
 * «Sintético DJ 5B2»: un estudio nuevo por corrida y un período por escenario. No se borran
 * filas: las liquidaciones finalizadas tienen triggers inmutables y la base es descartable.
 */

const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const CSRF = "csrf-dj5b2-test-0123456789abcdef0123456789";
const DJ = "DECLARACION_JURADA";
const ROLES = ["OWNER", "ADMIN", "REVIEWER", "PREPARER", "AUDITOR_READONLY"] as const;
type Rol = (typeof ROLES)[number];
const USUARIOS = Object.fromEntries(ROLES.map((rol) => [rol, randomUUID()])) as Record<Rol, string>;
const OTRO_USUARIO = randomUUID();
const TOKENS = {} as Record<Rol | "OTRO", string>;

const CUERPO_BASE = {
  impuestoDeterminado: "1500.00",
  saldoFavorTecnico: "120.5000",
  saldoLibreDisponibilidad: "30.0000",
  totalAPagar: "1500.00",
};

const TOTALES_LIQUIDACION = {
  TOTAL_A_INGRESAR: "1500.00",
  SALDO_TECNICO_AFTER: "120.5000",
  SALDO_LIBRE_AFTER: "30.0000",
};

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
let clientId: string;
let profileVersionId: string;
let regime: { id: string; taxTypeId: string; jurisdictionId: string };
let mes = 0;

interface Escenario {
  obligationId: string;
  settlementId: string;
  filingId: string;
  periodId: string;
}

function cuitEndingIn(ending: string): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce((total, weight, index) => total + Number(base.charAt(index)) * weight, 0);
    const check = (11 - (sum % 11)) % 11;
    if (check < 10 && String(check) === ending) return `${base}${check}`;
  }
}

async function sesion(userId: string): Promise<string> {
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

async function alta(userId: string, nombre: string, firmId: string, role: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
    userId,
    `${userId}@dj5b2.test.local`,
    nombre,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'${role}','ACTIVE',now())`,
    firmId,
    userId,
  );
}

async function nuevoCliente(nombre: string) {
  return prisma.client.create({
    data: { firmId: FIRM, legalName: nombre, tradeName: nombre, cuit: cuitEndingIn("7"), status: "ACTIVE" },
  });
}

async function crearLiquidacion(
  periodId: string,
  version: number,
  status: "FINALIZED" | "SUPERSEDED",
  totals: Record<string, string> = TOTALES_LIQUIDACION,
  supersedesId?: string,
): Promise<string> {
  const settlement = await prisma.taxSettlement.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regime.taxTypeId,
      regimeId: regime.id,
      jurisdictionId: regime.jurisdictionId,
      periodId,
      cutoff: new Date(Date.UTC(2026, mes, 0)),
      version,
      engineVersion: "sintetico-5b2",
      rulesHash: "sintetico-5b2",
      inputHash: "sintetico-5b2",
      outputHash: "sintetico-5b2",
      status,
      totals,
      preparedByUserId: USUARIOS.OWNER,
      ...(status === "FINALIZED" ? { finalizedByUserId: USUARIOS.OWNER, finalizedAt: new Date() } : {}),
      ...(supersedesId ? { supersedesId } : {}),
    },
  });
  return settlement.id;
}

/** Período, obligación, liquidación v1 y presentación (con acuse) sintéticos. */
async function escenario(opts: {
  settlementStatus: "FINALIZED" | "SUPERSEDED";
  filingStatus: "FILED" | "PENDING";
}): Promise<Escenario> {
  mes += 1;
  const period = await prisma.taxPeriod.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regime.taxTypeId,
      startDate: new Date(Date.UTC(2026, mes - 1, 1)),
      endDate: new Date(Date.UTC(2026, mes, 0)),
      label: `Período sintético DJ 5B2 ${mes}`,
    },
  });
  const obligation = await prisma.taxObligation.create({
    data: {
      firmId: FIRM,
      clientId,
      profileVersionId,
      regimeId: regime.id,
      periodId: period.id,
      status: opts.filingStatus === "FILED" ? "FILED" : "PENDING",
    },
  });
  const settlementId = await crearLiquidacion(period.id, 1, opts.settlementStatus);
  const acuse = await prisma.document.create({
    data: { firmId: FIRM, clientId, category: "ACUSE", status: "READY" },
  });
  const filing = await prisma.taxFiling.create({
    data: {
      firmId: FIRM,
      clientId,
      obligationId: obligation.id,
      settlementId,
      filedAt: new Date(Date.UTC(2026, mes, 10)),
      amountFiled: "1500.00",
      status: opts.filingStatus,
      evidenceDocumentId: acuse.id,
      createdByUserId: USUARIOS.OWNER,
    },
  });
  return { obligationId: obligation.id, settlementId, filingId: filing.id, periodId: period.id };
}

async function documento(category: string): Promise<string> {
  const doc = await prisma.document.create({ data: { firmId: FIRM, clientId, category, status: "READY" } });
  return doc.id;
}

function posicion(rol: Rol | "OTRO", periodId: string, cliente = clientId) {
  return app.inject({
    method: "GET",
    url: `/api/v1/firms/${FIRM}/clients/${cliente}/tax-position?periodId=${periodId}`,
    cookies: { refresh_token: TOKENS[rol] },
  });
}

function declarar(e: Escenario, body: Record<string, unknown>, filingId = e.filingId) {
  return app.inject({
    method: "PATCH",
    url: `/api/v1/firms/${FIRM}/clients/${clientId}/tax-obligations/${e.obligationId}/filings/${filingId}/declaration`,
    cookies: { refresh_token: TOKENS.OWNER, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload: body,
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

  const iva = await prisma.taxRegime.findFirst({
    where: { isActive: true, taxType: { code: "IVA" } },
    orderBy: { code: "asc" },
  });
  if (!iva) throw new Error("seed-maestros-fiscales no cargado: falta un régimen activo de IVA");
  regime = { id: iva.id, taxTypeId: iva.taxTypeId, jurisdictionId: iva.jurisdictionId };

  await prisma.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now()), ($3,$4,$4,now())`,
    FIRM,
    "Estudio sintético DJ 5B2",
    OTHER_FIRM,
    "Estudio sintético DJ 5B2 (otro)",
  );
  for (const rol of ROLES) {
    await alta(USUARIOS[rol], `Usuario sintético ${rol} DJ 5B2`, FIRM, rol);
    TOKENS[rol] = await sesion(USUARIOS[rol]);
  }
  await alta(OTRO_USUARIO, "Titular de otro estudio DJ 5B2", OTHER_FIRM, "OWNER");
  TOKENS.OTRO = await sesion(OTRO_USUARIO);

  const cliente = await nuevoCliente("Cliente sintético DJ 5B2");
  clientId = cliente.id;
  const perfil = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM,
      clientId,
      legalName: "Cliente sintético DJ 5B2",
      cuit: cuitEndingIn("7"),
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  profileVersionId = perfil.id;
  // OWNER y ADMIN son de firma completa; los demás roles necesitan asignación al cliente (guard.ts).
  for (const rol of ["PREPARER", "REVIEWER", "AUDITOR_READONLY"] as const) {
    await prisma.clientAssignment.create({ data: { firmId: FIRM, clientId, userId: USUARIOS[rol] } });
  }
});

afterAll(async () => {
  await app.close();
  await runtimePrisma.$disconnect();
});

describe("posición del legajo sin DJ (caracterización, corte 5b-2)", () => {
  it("con acuse y sin DJ conserva los campos de hoy: presentación, liquidación e importes", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const res = await posicion("OWNER", e.periodId);
    expect(res.statusCode).toBe(200);
    const [item] = res.json().data;
    expect(item.obligationId).toBe(e.obligationId);
    expect(item.filedAt).not.toBeNull();
    expect(item.settlement.id).toBe(e.settlementId);
    expect(item.accrued).toBe("1500.0000");
    expect(item.pending).toBe("1500.0000");
    expect(item.availableCredit).toBe("0.0000");
  });

  it("sin presentación no trae fecha de presentación y conserva el devengado", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "PENDING" });
    const [item] = (await posicion("OWNER", e.periodId)).json().data;
    expect(item.filedAt).toBeNull();
    expect(item.accrued).toBe("1500.0000");
  });

  it("los cinco roles con lectura de la posición reciben el devengado; el preparador sin asignación y otro estudio reciben 404", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    for (const rol of ROLES) {
      const res = await posicion(rol, e.periodId);
      expect(res.statusCode, rol).toBe(200);
      expect(res.json().data[0].accrued, rol).toBe("1500.0000");
    }
    const sinAsignacion = await nuevoCliente("Cliente sintético DJ 5B2 (sin asignar)");
    expect((await posicion("PREPARER", e.periodId, sinAsignacion.id)).statusCode).toBe(404);
    expect((await posicion("OTRO", e.periodId)).statusCode).toBe(404);
  });
});
