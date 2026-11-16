import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Saldos del mes siguiente desde la declaración jurada (corte 6a), por la ruta real.
 * Datos sintéticos rotulados «Demo»: un estudio nuevo por corrida y un período por escenario.
 * No se borran filas: las liquidaciones finalizadas tienen triggers inmutables y la base es
 * desechable. En NODE_ENV=test la API usa DATABASE_URL (superusuario, sin RLS); la RLS se
 * verifica con el rol runtime.
 */

const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const OWNER = randomUUID();
const OWNER_OTRO_ESTUDIO = randomUUID();
const PREPARADOR = randomUUID();
const CSRF = "csrf-saldos-6a-test-0123456789abcdef0123456789";
const TOKEN_OWNER = randomBytes(32).toString("base64url");
const TOKEN_OTRO = randomBytes(32).toString("base64url");
const TOKEN_PREPARADOR = randomBytes(32).toString("base64url");

let app: FastifyInstance;
let runtimePrisma: PrismaClient;
let clientId: string;
let profileVersionId: string;
let ivaRegime: { id: string; taxTypeId: string; jurisdictionId: string };
let mes = 0;

interface LoteLibro {
  id: string;
  kind: string;
  originalAmount: string;
  available: string;
  verificationStatus: string;
  reference: string | null;
  history: Array<{ changes: Record<string, unknown>; createdBy: { id: string } | null }>;
  [campo: string]: unknown;
}

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

function clienteUrl(): string {
  return `/api/v1/firms/${FIRM}/clients/${clientId}`;
}

function pedir(
  method: "GET" | "PATCH" | "POST",
  url: string,
  token: string = TOKEN_OWNER,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    ...(payload !== undefined ? { payload } : {}),
  });
}

async function libro(token: string = TOKEN_OWNER): Promise<LoteLibro[]> {
  const res = await pedir("GET", `${clienteUrl()}/tax-credit-ledger`, token);
  expect(res.statusCode).toBe(200);
  return res.json().data as LoteLibro[];
}

async function crearUsuario(id: string, firm: string, role: "OWNER" | "PREPARER", token: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
    id,
    `${id}@saldos6a.test.local`,
    `Usuario sintético 6A (${role})`,
  );
  // El rol va como literal: la columna es del tipo enumerado FirmRole.
  await prisma.$executeRawUnsafe(
    `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'${role}','ACTIVE',now())`,
    firm,
    id,
  );
  await prisma.deviceSession.create({
    data: {
      id: randomUUID(),
      userId: id,
      refreshTokenHash: sha256(token),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

/** Período sintético nuevo para el cliente (uno por escenario). */
async function periodo(taxTypeId: string) {
  mes += 1;
  return prisma.taxPeriod.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId,
      startDate: new Date(Date.UTC(2026, mes - 1, 1)),
      endDate: new Date(Date.UTC(2026, mes, 0)),
      label: `Demo ${String(mes).padStart(2, "0")}/2026`,
    },
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
  ivaRegime = { id: iva.id, taxTypeId: iva.taxTypeId, jurisdictionId: iva.jurisdictionId };

  await prisma.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now()), ($3,$4,$4,now())`,
    FIRM,
    "Estudio sintético saldos 6A",
    OTHER_FIRM,
    "Estudio sintético saldos 6A (otro)",
  );
  await crearUsuario(OWNER, FIRM, "OWNER", TOKEN_OWNER);
  await crearUsuario(OWNER_OTRO_ESTUDIO, OTHER_FIRM, "OWNER", TOKEN_OTRO);
  await crearUsuario(PREPARADOR, FIRM, "PREPARER", TOKEN_PREPARADOR);

  const cliente = await prisma.client.create({
    data: {
      firmId: FIRM,
      legalName: "Cliente sintético saldos 6A",
      tradeName: "Sintético saldos 6A",
      cuit: cuitEndingIn("7"),
      status: "ACTIVE",
    },
  });
  clientId = cliente.id;
  const perfil = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM,
      clientId,
      legalName: "Cliente sintético saldos 6A",
      cuit: cuitEndingIn("7"),
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  profileVersionId = perfil.id;
});

afterAll(async () => {
  await app?.close();
  await runtimePrisma?.$disconnect();
});

describe("libro de saldos: caracterización de lo vigente (corte 6a, antes de cambiar nada)", () => {
  it("caracterización: el saldo manual sin verificar aparece como PENDING_VERIFICATION con su disponible", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const alta = await pedir("POST", `${clienteUrl()}/tax-credit-ledger/opening`, TOKEN_OWNER, {
      taxTypeId: ivaRegime.taxTypeId,
      regimeId: ivaRegime.id,
      jurisdictionId: ivaRegime.jurisdictionId,
      periodId: per.id,
      kind: "IVA_TECNICO",
      amount: "1000.00",
      reference: "Demo saldo inicial 6A",
    });
    expect(alta.statusCode).toBe(201);
    const lote = (await libro()).find((item) => item.id === alta.json().data.id);
    expect(lote).toMatchObject({
      kind: "IVA_TECNICO",
      originalAmount: "1000.0000",
      available: "1000.0000",
      verificationStatus: "PENDING_VERIFICATION",
      reference: "Demo saldo inicial 6A",
    });
  });

  it("caracterización: editar la referencia de un lote deja el cambio en el historial con el usuario", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const alta = await pedir("POST", `${clienteUrl()}/tax-credit-ledger/opening`, TOKEN_OWNER, {
      taxTypeId: ivaRegime.taxTypeId,
      regimeId: ivaRegime.id,
      jurisdictionId: ivaRegime.jurisdictionId,
      periodId: per.id,
      kind: "IVA_LIBRE",
      amount: "250.00",
    });
    const id = alta.json().data.id as string;
    const edicion = await pedir("PATCH", `${clienteUrl()}/tax-credit-ledger/${id}`, TOKEN_OWNER, {
      reference: "Demo referencia editada 6A",
    });
    expect(edicion.statusCode).toBe(200);
    const lote = (await libro()).find((item) => item.id === id);
    const ultimo = lote?.history.at(-1);
    expect(ultimo?.changes).toMatchObject({ reference: { to: "Demo referencia editada 6A" } });
    expect(ultimo?.createdBy?.id).toBe(OWNER);
  });

  it("caracterización (T-003): un titular de otro estudio recibe 404 al leer el libro y al editar un lote", async () => {
    const lectura = await pedir("GET", `${clienteUrl()}/tax-credit-ledger`, TOKEN_OTRO);
    expect(lectura.statusCode).toBe(404);
    const per = await periodo(ivaRegime.taxTypeId);
    const alta = await pedir("POST", `${clienteUrl()}/tax-credit-ledger/opening`, TOKEN_OWNER, {
      taxTypeId: ivaRegime.taxTypeId,
      regimeId: ivaRegime.id,
      jurisdictionId: ivaRegime.jurisdictionId,
      periodId: per.id,
      kind: "IVA_TECNICO",
      amount: "90.00",
    });
    const edicion = await pedir(
      "PATCH",
      `${clienteUrl()}/tax-credit-ledger/${alta.json().data.id as string}`,
      TOKEN_OTRO,
      { reference: "intento ajeno" },
    );
    expect(edicion.statusCode).toBe(404);
  });

  it("caracterización: un preparador sin asignación al cliente recibe 404 en el libro", async () => {
    const lectura = await pedir("GET", `${clienteUrl()}/tax-credit-ledger`, TOKEN_PREPARADOR);
    expect(lectura.statusCode).toBe(404);
  });
});

// -- fin de caracterización (commit 1) --
