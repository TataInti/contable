import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";

/**
 * Etapa Saldos (corte 3E): origen del saldo arrastrado, edición con historial, corrección de importe
 * por movimiento compensatorio con motivo, invalidación del mes calculado, rechazo en mes finalizado y
 * permisos. Por la ruta real, con datos sintéticos rotulados «Demo». Un estudio nuevo por corrida y un
 * período por escenario. No se borran filas: la base es desechable.
 */

const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const OWNER = randomUUID();
const OWNER_OTRO_ESTUDIO = randomUUID();
const REVISOR = randomUUID();
const CSRF = "csrf-saldos-3e-test-0123456789abcdef0123456789";
const TOKEN_OWNER = randomBytes(32).toString("base64url");
const TOKEN_OTRO = randomBytes(32).toString("base64url");
const TOKEN_REVISOR = randomBytes(32).toString("base64url");

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
  importeVigente: string;
  available: string;
  origin: string;
  period: { id: string; label: string | null; startDate: string; endDate: string } | null;
  taxType: { id: string; code: string; name: string } | null;
  verificationStatus: string;
  reference: string | null;
  history: Array<{ changes: Record<string, unknown>; createdBy: { id: string } | null }>;
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

async function loteEnLibro(id: string): Promise<LoteLibro> {
  const lote = (await libro()).find((item) => item.id === id);
  if (!lote) throw new Error(`el lote ${id} no está en el libro`);
  return lote;
}

async function crearUsuario(id: string, firm: string, role: "OWNER" | "REVIEWER", token: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
    id,
    `${id}@saldos3e.test.local`,
    `Usuario sintético 3E (${role})`,
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

/** Saldo manual de IVA técnico cargado por la ruta (queda PENDING_VERIFICATION). */
async function altaManual(periodId: string, amount: string): Promise<string> {
  const alta = await pedir("POST", `${clienteUrl()}/tax-credit-ledger/opening`, TOKEN_OWNER, {
    taxTypeId: ivaRegime.taxTypeId,
    regimeId: ivaRegime.id,
    jurisdictionId: ivaRegime.jurisdictionId,
    periodId,
    kind: "IVA_TECNICO",
    amount,
    reference: "Demo saldo 3E",
  });
  expect(alta.statusCode).toBe(201);
  return alta.json().data.id as string;
}

/**
 * Mes de la presentación con su workpaper en el estado dado y una obligación de IVA enlazada.
 * Sintético: el cálculo real se prueba en los tests de liquidación.
 */
async function mesConWorkpaper(
  per: { id: string; startDate: Date; endDate: Date },
  status: "CALCULATED" | "FINALIZED",
) {
  const obligacion = await prisma.taxObligation.create({
    data: {
      firmId: FIRM,
      clientId,
      profileVersionId,
      regimeId: ivaRegime.id,
      periodId: per.id,
      status: "PENDING",
    },
  });
  const wp = await prisma.monthlyTaxWorkpaper.create({
    data: {
      firmId: FIRM,
      clientId,
      periodStart: per.startDate,
      periodEnd: per.endDate,
      status,
    },
  });
  await prisma.workpaperSettlement.create({
    data: {
      firmId: FIRM,
      clientId,
      workpaperId: wp.id,
      obligationId: obligacion.id,
      role: "IVA",
      required: true,
    },
  });
  return wp;
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
    "Estudio sintético saldos 3E",
    OTHER_FIRM,
    "Estudio sintético saldos 3E (otro)",
  );
  await crearUsuario(OWNER, FIRM, "OWNER", TOKEN_OWNER);
  await crearUsuario(OWNER_OTRO_ESTUDIO, OTHER_FIRM, "OWNER", TOKEN_OTRO);
  await crearUsuario(REVISOR, FIRM, "REVIEWER", TOKEN_REVISOR);

  const cliente = await prisma.client.create({
    data: {
      firmId: FIRM,
      legalName: "Cliente sintético saldos 3E",
      tradeName: "Sintético saldos 3E",
      cuit: cuitEndingIn("7"),
      status: "ACTIVE",
    },
  });
  clientId = cliente.id;
  // Un revisor no es de firma completa: el guard exige asignación al cliente (la capacidad sale del rol).
  await prisma.clientAssignment.create({
    data: { firmId: FIRM, userId: REVISOR, clientId, capabilities: [] },
  });
  const perfil = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM,
      clientId,
      legalName: "Cliente sintético saldos 3E",
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

describe("Saldos (3E) · origen, edición e historial", () => {
  it("el libro informa el origen del saldo de cierre con su período y su impuesto", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const cierreId = randomUUID();
    const lote = await prisma.taxCreditLot.create({
      data: {
        firmId: FIRM,
        clientId,
        taxTypeId: ivaRegime.taxTypeId,
        regimeId: ivaRegime.id,
        jurisdictionId: ivaRegime.jurisdictionId,
        periodId: per.id,
        kind: "IVA_TECNICO",
        originalAmount: "1234.00",
        sourceSettlementId: cierreId,
        reference: `Cierre ${cierreId} · versión 1`,
        verificationStatus: "VERIFIED",
        verifiedByUserId: OWNER,
        verifiedAt: new Date(),
        createdByUserId: OWNER,
      },
    });
    const visto = await loteEnLibro(lote.id);
    expect(visto.origin).toBe("CIERRE");
    expect(visto.period).toMatchObject({ id: per.id, label: per.label });
    expect(visto.taxType).toMatchObject({ id: ivaRegime.taxTypeId, code: "IVA" });
    expect(visto.available).toBe("1234.0000");
  });

  it("editar la referencia no pide motivo y deja el cambio en el historial con el usuario", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "250.00");
    const edicion = await pedir("PATCH", `${clienteUrl()}/tax-credit-ledger/${id}`, TOKEN_OWNER, {
      reference: "Demo referencia 3E",
    });
    expect(edicion.statusCode).toBe(200);
    const ultimo = (await loteEnLibro(id)).history.at(-1);
    expect(ultimo?.changes).toMatchObject({ reference: { to: "Demo referencia 3E" } });
    expect(ultimo?.createdBy?.id).toBe(OWNER);
  });

  it("un PATCH que solo cambia el arrastre conserva la referencia y el respaldo", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "275.00");
    const edicion = await pedir("PATCH", `${clienteUrl()}/tax-credit-ledger/${id}`, TOKEN_OWNER, {
      carryForward: false,
    });
    expect(edicion.statusCode).toBe(200);
    const lote = await loteEnLibro(id);
    expect(lote.reference).toBe("Demo saldo 3E");
    expect(lote.history.at(-1)?.changes).toMatchObject({ carryForward: { to: false } });
  });

  it("PATCH con importe responde 400 con la guía de corrección y no cambia el saldo", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "700.00");
    const intento = await pedir("PATCH", `${clienteUrl()}/tax-credit-ledger/${id}`, TOKEN_OWNER, {
      originalAmount: "900.00",
    });
    expect(intento.statusCode).toBe(409);
    expect(JSON.stringify(intento.json())).toContain(
      "Para cambiar el importe usá la corrección con motivo",
    );
    expect((await loteEnLibro(id)).available).toBe("700.0000");
  });
});

describe("Saldos (3E) · corrección de importe con movimiento compensatorio", () => {
  it("corregir el importe con motivo deja el disponible nuevo, un movimiento compensatorio y el historial con antes, después y motivo", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "1000.00");
    const correccion = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OWNER,
      {
        newAmount: "1500.00",
        reason: "Nota de crédito Demo 0001",
      },
    );
    expect(correccion.statusCode).toBe(201);

    const lote = await loteEnLibro(id);
    expect(lote.available).toBe("1500.0000");
    const movimientos = await prisma.taxCreditMovement.findMany({ where: { lotId: id } });
    expect(movimientos).toHaveLength(1);
    expect(movimientos[0]).toMatchObject({ kind: "AMOUNT_CORRECTION" });
    expect(movimientos[0]?.amount.toFixed(4)).toBe("-500.0000");
    const ultimo = lote.history.at(-1);
    expect(ultimo?.changes).toMatchObject({
      originalAmount: { from: "1000.0000", to: "1500.0000" },
      reason: { to: "Nota de crédito Demo 0001" },
    });
    expect(ultimo?.createdBy?.id).toBe(OWNER);
  });

  it("dos correcciones seguidas dejan el último importe, sin duplicar el ajuste anterior", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "1000.00");
    const primera = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OWNER,
      {
        newAmount: "1500.00",
        reason: "Primera corrección Demo",
      },
    );
    expect(primera.statusCode).toBe(201);
    const repetida = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OWNER,
      {
        newAmount: "1500.00",
        reason: "Misma cifra Demo",
      },
    );
    expect(repetida.statusCode).toBe(201);
    expect(repetida.json().data.changed).toBe(false);
    const segunda = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OWNER,
      {
        newAmount: "1200.00",
        reason: "Segunda corrección Demo",
      },
    );
    expect(segunda.statusCode).toBe(201);
    const lote = await loteEnLibro(id);
    expect(lote.originalAmount).toBe("1000.0000");
    expect(lote.importeVigente).toBe("1200.0000");
    expect(lote.available).toBe("1200.0000");
    expect(await prisma.taxCreditMovement.count({ where: { lotId: id } })).toBe(2);
  });

  it("corregir sin motivo responde 400 y no escribe nada", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "800.00");
    const sinMotivo = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OWNER,
      {
        newAmount: "900.00",
        reason: "   ",
      },
    );
    expect(sinMotivo.statusCode).toBe(400);
    expect((await loteEnLibro(id)).available).toBe("800.0000");
    expect(await prisma.taxCreditMovement.count({ where: { lotId: id } })).toBe(0);
  });

  it("corregir el importe de un mes calculado lo devuelve a preparación", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "1000.00");
    const wp = await mesConWorkpaper(per, "CALCULATED");
    const correccion = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OWNER,
      {
        newAmount: "1400.00",
        reason: "Ajuste Demo del saldo",
      },
    );
    expect(correccion.statusCode).toBe(201);
    const despues = await prisma.monthlyTaxWorkpaper.findUniqueOrThrow({ where: { id: wp.id } });
    expect(["COLLECTING_INPUTS", "READY_TO_CALCULATE"]).toContain(despues.status);
  });

  it("corregir el importe de un mes finalizado se rechaza con la guía y no crea movimiento", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "1000.00");
    await mesConWorkpaper(per, "FINALIZED");
    const rechazo = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OWNER,
      {
        newAmount: "1300.00",
        reason: "Intento Demo sobre mes cerrado",
      },
    );
    expect(rechazo.statusCode).toBe(409);
    expect(JSON.stringify(rechazo.json())).toContain(
      "Para cambiar un mes cerrado, rectificá la liquidación",
    );
    expect((await loteEnLibro(id)).available).toBe("1000.0000");
    expect(await prisma.taxCreditMovement.count({ where: { lotId: id } })).toBe(0);
  });

  it("cambiar la referencia de un saldo de un mes finalizado no se rechaza: no altera el cálculo", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "600.00");
    await mesConWorkpaper(per, "FINALIZED");
    const edicion = await pedir("PATCH", `${clienteUrl()}/tax-credit-ledger/${id}`, TOKEN_OWNER, {
      reference: "Referencia Demo en mes cerrado",
    });
    expect(edicion.statusCode).toBe(200);
  });

  it("un revisor sin permiso de cálculo recibe 403 al corregir y el saldo no cambia", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "500.00");
    const intento = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_REVISOR,
      {
        newAmount: "700.00",
        reason: "Intento Demo sin permiso",
      },
    );
    expect(intento.statusCode).toBe(403);
    expect((await loteEnLibro(id)).available).toBe("500.0000");
  });

  it("un titular de otro estudio recibe 404 al corregir y el saldo no cambia", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "450.00");
    const intento = await pedir(
      "POST",
      `${clienteUrl()}/tax-credit-ledger/${id}/corrections`,
      TOKEN_OTRO,
      {
        newAmount: "600.00",
        reason: "Intento Demo ajeno",
      },
    );
    expect(intento.statusCode).toBe(404);
    expect((await loteEnLibro(id)).available).toBe("450.0000");
  });

  it("RLS: el rol runtime no ve el saldo desde otro estudio", async () => {
    const per = await periodo(ivaRegime.taxTypeId);
    const id = await altaManual(per.id, "320.00");
    const visto = await runtimePrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER_OTRO_ESTUDIO}, true)`;
      await tx.$queryRaw`SELECT set_config('app.firm_id', ${OTHER_FIRM}, true)`;
      await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
      await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
      return tx.taxCreditLot.findMany({ where: { id } });
    });
    expect(visto).toHaveLength(0);
  });
});
