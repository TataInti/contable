import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Prisma, PrismaClient } from "@prisma/client";
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

// ---------------------------------------------------------------------------
// Saldos de la DJ en el libro (corte 6a). Pruebas nuevas, escritas antes del código.
// Cifras sintéticas «Demo»: cierre de P IVA técnico 48.000,00 y libre 20.000,00; DJ de P con
// técnico 50.000,00 y libre 20.000,00 (advertencia de diferencia de 2.000,00).
// ---------------------------------------------------------------------------

const DJ = "DECLARACION_JURADA";
const TOTALES = {
  TOTAL_A_INGRESAR: "1500.00",
  SALDO_TECNICO_AFTER: "48000.0000",
  SALDO_LIBRE_AFTER: "20000.0000",
};
const CUERPO_DJ = {
  impuestoDeterminado: "1500.00",
  saldoFavorTecnico: "50000.0000",
  saldoLibreDisponibilidad: "20000.0000",
  totalAPagar: "1500.00",
};
const MOTIVO_YA_USADO = /El saldo de .+ ya se usó en el cierre de .+: rectificá ese cierre primero/;

interface Escenario {
  periodId: string;
  obligationId: string;
  settlementId: string;
  filingId: string;
}

interface ResultadoLote {
  status: string;
  kind: string;
  taxTypeId: string;
  regimeId: string | null;
  jurisdictionId: string | null;
  amount: string;
  lotId: string | null;
  reemplazaLotId?: string | null;
  motivo?: string;
}

interface Regimen {
  id: string;
  taxTypeId: string;
  jurisdictionId: string;
}

async function documento(category: string): Promise<string> {
  const doc = await prisma.document.create({
    data: { firmId: FIRM, clientId, category, status: "READY" },
  });
  return doc.id;
}

/** Período, obligación, liquidación finalizada y presentación FILED con su acuse (sintéticos). */
async function escenario(opts: { regimen?: Regimen } = {}): Promise<Escenario> {
  const regimen = opts.regimen ?? ivaRegime;
  const per = await periodo(regimen.taxTypeId);
  const obligacion = await prisma.taxObligation.create({
    data: {
      firmId: FIRM,
      clientId,
      profileVersionId,
      regimeId: regimen.id,
      periodId: per.id,
      status: "FILED",
    },
  });
  const liquidacion = await prisma.taxSettlement.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regimen.taxTypeId,
      regimeId: regimen.id,
      jurisdictionId: regimen.jurisdictionId,
      periodId: per.id,
      cutoff: new Date(Date.UTC(2026, mes, 0)),
      version: 1,
      engineVersion: "sintetico-6a",
      rulesHash: "sintetico-6a",
      inputHash: "sintetico-6a",
      outputHash: "sintetico-6a",
      status: "FINALIZED",
      totals: TOTALES,
      preparedByUserId: OWNER,
      finalizedByUserId: OWNER,
      finalizedAt: new Date(),
    },
  });
  const acuse = await prisma.document.create({
    data: { firmId: FIRM, clientId, category: "ACUSE", status: "READY" },
  });
  const presentacion = await prisma.taxFiling.create({
    data: {
      firmId: FIRM,
      clientId,
      obligationId: obligacion.id,
      settlementId: liquidacion.id,
      filedAt: new Date(Date.UTC(2026, mes, 10)),
      amountFiled: "1500.00",
      status: "FILED",
      evidenceDocumentId: acuse.id,
      createdByUserId: OWNER,
    },
  });
  return {
    periodId: per.id,
    obligationId: obligacion.id,
    settlementId: liquidacion.id,
    filingId: presentacion.id,
  };
}

function declarar(e: Escenario, cuerpo: Record<string, unknown>, filingId: string = e.filingId) {
  return pedir(
    "PATCH",
    `${clienteUrl()}/tax-obligations/${e.obligationId}/filings/${filingId}/declaration`,
    TOKEN_OWNER,
    cuerpo,
  );
}

/** Cierre simulado con el mismo formato que rollForwardClosingCredits (nace VERIFIED). */
async function cierre(e: Escenario, kind: string, amount: string, regimen: Regimen = ivaRegime) {
  return prisma.taxCreditLot.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regimen.taxTypeId,
      regimeId: regimen.id,
      jurisdictionId: regimen.jurisdictionId,
      periodId: e.periodId,
      kind,
      originalAmount: amount,
      sourceSettlementId: e.settlementId,
      reference: `Cierre ${e.settlementId} · versión 1`,
      verificationStatus: "VERIFIED",
      verifiedByUserId: OWNER,
      verifiedAt: new Date(),
      createdByUserId: OWNER,
    },
  });
}

/** Simula que el cierre del período siguiente consumió el lote (movimiento ROLLED_FORWARD). */
async function consumidoPor(lotId: string, siguiente: Escenario, amount: string) {
  await prisma.taxCreditMovement.create({
    data: {
      firmId: FIRM,
      clientId,
      lotId,
      kind: "ROLLED_FORWARD",
      amount,
      settlementId: siguiente.settlementId,
      reference: `Cierre ${siguiente.settlementId}`,
      createdByUserId: OWNER,
    },
  });
}

async function lotesDeLaDJ(filingId: string) {
  return prisma.taxCreditLot.findMany({
    where: { sourceFilingId: filingId },
    orderBy: { createdAt: "asc" },
  });
}

async function loteVigente(filingId: string, kind: string) {
  const lote = (await lotesDeLaDJ(filingId)).find(
    (item) => item.kind === kind && item.verificationStatus === "VERIFIED",
  );
  if (!lote) throw new Error(`falta el lote ${kind} de la presentación ${filingId}`);
  return lote;
}

/**
 * Disponible que tomaría la liquidación siguiente por el saldo de un período: lotes VERIFIED que
 * arrastran, del impuesto y régimen de IVA, con el período de la liquidación que se cierra. Se acota
 * por período para no sumar los saldos de otros escenarios del mismo cliente.
 */
async function disponibleParaSiguiente(kind: string, periodId: string): Promise<string> {
  const lotes = await prisma.taxCreditLot.findMany({
    where: {
      clientId,
      periodId,
      taxTypeId: ivaRegime.taxTypeId,
      regimeId: ivaRegime.id,
      kind,
      verificationStatus: "VERIFIED",
      carryForward: true,
    },
    include: { movements: true },
  });
  const total = lotes.reduce(
    (suma, lote) =>
      suma
        .plus(lote.originalAmount)
        .minus(lote.movements.reduce((usado, m) => usado.plus(m.amount), new Prisma.Decimal(0))),
    new Prisma.Decimal(0),
  );
  return total.toFixed(4);
}

/** Transacción con el rol runtime y el contexto RLS del estudio (como withTenantContext). */
function comoRuntime<T>(firm: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${firm}, true)`;
    await tx.$queryRaw`SELECT set_config('app.client_id', '', true)`;
    await tx.$queryRaw`SELECT set_config('app.actor_kind', 'USER', true)`;
    return fn(tx);
  });
}

describe("saldos de la DJ en el libro (corte 6a): pruebas nuevas", () => {
  it("R1 la DJ de IVA genera el lote técnico y el libre VERIFIED, con su presentación y sin liquidación en el origen", async () => {
    const e = await escenario();
    const res = await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    expect(res.statusCode).toBe(200);
    const lotes = await lotesDeLaDJ(e.filingId);
    expect(lotes.map((lote) => lote.kind).sort()).toEqual(["IVA_LIBRE", "IVA_TECNICO"]);
    expect(lotes.find((lote) => lote.kind === "IVA_TECNICO")).toMatchObject({
      verificationStatus: "VERIFIED",
      verifiedByUserId: OWNER,
      periodId: e.periodId,
      sourceSettlementId: null,
      carryForward: true,
    });
    const tecnico = await loteVigente(e.filingId, "IVA_TECNICO");
    expect(tecnico.originalAmount.toFixed(4)).toBe("50000.0000");
    const generados = res.json().data.saldosGenerados as ResultadoLote[];
    expect(
      generados
        .filter((g) => g.status === "CREADO")
        .map((g) => g.kind)
        .sort(),
    ).toEqual(["IVA_LIBRE", "IVA_TECNICO"]);
  });

  it("R2 (golden) al cargar la DJ el cierre de P queda SUPERSEDED sin cambiar su importe; P+1 toma 50.000,00 para IVA técnico (ni 98.000,00 ni 48.000,00) y 20.000,00 para el libre", async () => {
    const e = await escenario();
    const cierreTecnico = await cierre(e, "IVA_TECNICO", "48000.0000");
    await cierre(e, "IVA_LIBRE", "20000.0000");
    expect(await disponibleParaSiguiente("IVA_TECNICO", e.periodId)).toBe("48000.0000");
    const res = await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.warnings.map((w: { code: string }) => w.code)).toContain(
      "SALDO_TECNICO_DISTINTO_DE_LIQUIDACION",
    );
    const tras = await prisma.taxCreditLot.findUniqueOrThrow({ where: { id: cierreTecnico.id } });
    expect(tras.verificationStatus).toBe("SUPERSEDED");
    expect(tras.originalAmount.toFixed(4)).toBe("48000.0000");
    expect(await disponibleParaSiguiente("IVA_TECNICO", e.periodId)).toBe("50000.0000");
    expect(await disponibleParaSiguiente("IVA_LIBRE", e.periodId)).toBe("20000.0000");
  });

  it("R3 DJ en cero: no crea lote para el técnico (NO_CREADO, saldo en cero), el cierre de ese saldo queda SUPERSEDED y P+1 toma cero", async () => {
    const e = await escenario();
    const cierreTecnico = await cierre(e, "IVA_TECNICO", "48000.0000");
    const res = await declarar(e, {
      declarationDocumentId: await documento(DJ),
      ...CUERPO_DJ,
      saldoFavorTecnico: "0.0000",
    });
    expect(res.statusCode).toBe(200);
    expect((await lotesDeLaDJ(e.filingId)).map((lote) => lote.kind)).toEqual(["IVA_LIBRE"]);
    const generados = res.json().data.saldosGenerados as ResultadoLote[];
    expect(generados).toContainEqual(
      expect.objectContaining({
        kind: "IVA_TECNICO",
        status: "NO_CREADO",
        motivo: expect.stringMatching(/saldo en cero/),
      }),
    );
    const tras = await prisma.taxCreditLot.findUniqueOrThrow({ where: { id: cierreTecnico.id } });
    expect(tras.verificationStatus).toBe("SUPERSEDED");
    expect(await disponibleParaSiguiente("IVA_TECNICO", e.periodId)).toBe("0.0000");
  });

  it("R4 un saldo del detalle de otro impuesto no genera lote en esta obligación y se informa con su motivo", async () => {
    const e = await escenario();
    const otro = await prisma.taxType.findFirstOrThrow({ where: { code: { not: "IVA" } } });
    const res = await declarar(e, {
      declarationDocumentId: await documento(DJ),
      ...CUERPO_DJ,
      saldosFavorDetalle: [{ taxTypeId: otro.id, amount: "250.5000" }],
    });
    expect(res.statusCode).toBe(200);
    expect(
      (await lotesDeLaDJ(e.filingId)).filter((lote) => lote.kind === "SALDO_A_FAVOR"),
    ).toHaveLength(0);
    const generados = res.json().data.saldosGenerados as ResultadoLote[];
    expect(generados).toContainEqual(
      expect.objectContaining({
        kind: "SALDO_A_FAVOR",
        taxTypeId: otro.id,
        status: "NO_CREADO",
        motivo: expect.stringMatching(/otro impuesto o régimen/),
      }),
    );
  });

  it("R5 saldosFavorDetalle con dos jurisdicciones (CM): dos lotes SALDO_A_FAVOR con su régimen y su jurisdicción", async () => {
    const cm = await prisma.taxRegime.findFirstOrThrow({ where: { code: "CM_ART2" } });
    const [j1, j2] = await prisma.jurisdiction.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      take: 2,
    });
    if (!j1 || !j2) throw new Error("el seed necesita dos jurisdicciones activas");
    const e = await escenario({
      regimen: { id: cm.id, taxTypeId: cm.taxTypeId, jurisdictionId: cm.jurisdictionId },
    });
    const res = await declarar(e, {
      declarationDocumentId: await documento(DJ),
      impuestoDeterminado: "1500.00",
      saldoFavorTecnico: "0.0000",
      saldoLibreDisponibilidad: "0.0000",
      totalAPagar: "1500.00",
      saldosFavorDetalle: [
        { taxTypeId: cm.taxTypeId, regimeId: cm.id, jurisdictionId: j1.id, amount: "100.0000" },
        { taxTypeId: cm.taxTypeId, regimeId: cm.id, jurisdictionId: j2.id, amount: "40.5000" },
      ],
    });
    expect(res.statusCode).toBe(200);
    const lotes = (await lotesDeLaDJ(e.filingId)).filter((lote) => lote.kind === "SALDO_A_FAVOR");
    expect(
      lotes
        .map((lote) => [lote.jurisdictionId, lote.regimeId, lote.originalAmount.toFixed(4)])
        .sort(),
    ).toEqual(
      [
        [j1.id, cm.id, "100.0000"],
        [j2.id, cm.id, "40.5000"],
      ].sort(),
    );
  });

  it("R6 la DJ de una liquidación reemplazada por una versión posterior se registra y no crea lotes", async () => {
    const e = await escenario();
    const liquidacion = await prisma.taxSettlement.findUniqueOrThrow({
      where: { id: e.settlementId },
    });
    await prisma.taxSettlement.create({
      data: {
        firmId: FIRM,
        clientId,
        taxTypeId: liquidacion.taxTypeId,
        regimeId: liquidacion.regimeId,
        jurisdictionId: liquidacion.jurisdictionId,
        periodId: liquidacion.periodId,
        cutoff: liquidacion.cutoff,
        version: 2,
        engineVersion: "sintetico-6a",
        rulesHash: "sintetico-6a",
        inputHash: "sintetico-6a",
        outputHash: "sintetico-6a",
        status: "DRAFT",
        totals: TOTALES,
        preparedByUserId: OWNER,
        supersedesId: e.settlementId,
      },
    });
    const res = await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    expect(res.statusCode).toBe(200);
    expect(await lotesDeLaDJ(e.filingId)).toHaveLength(0);
    const generados = res.json().data.saldosGenerados as ResultadoLote[];
    expect(generados.length).toBeGreaterThan(0);
    expect(generados.every((g) => g.status === "NO_CREADO")).toBe(true);
    expect(generados.every((g) => /reemplazad/.test(g.motivo ?? ""))).toBe(true);
  });

  it("R7 registrar la misma DJ dos veces no duplica lotes: la segunda carga responde SIN_CAMBIOS", async () => {
    const e = await escenario();
    const documentoDJ = await documento(DJ);
    await declarar(e, { declarationDocumentId: documentoDJ, ...CUERPO_DJ });
    const antes = (await lotesDeLaDJ(e.filingId)).map((lote) => lote.id).sort();
    const res = await declarar(e, { declarationDocumentId: documentoDJ, ...CUERPO_DJ });
    expect(res.statusCode).toBe(200);
    expect((await lotesDeLaDJ(e.filingId)).map((lote) => lote.id).sort()).toEqual(antes);
    const generados = res.json().data.saldosGenerados as ResultadoLote[];
    expect(generados.map((g) => g.status).sort()).toEqual(["SIN_CAMBIOS", "SIN_CAMBIOS"]);
  });

  it("R8 corregir una DJ cuyo lote ya se usó en el cierre siguiente responde 409 con el motivo en lenguaje llano", async () => {
    const e = await escenario();
    const documentoDJ = await documento(DJ);
    await declarar(e, { declarationDocumentId: documentoDJ, ...CUERPO_DJ });
    const tecnico = await loteVigente(e.filingId, "IVA_TECNICO");
    await consumidoPor(tecnico.id, await escenario(), "50000.0000");
    const res = await declarar(e, {
      declarationDocumentId: documentoDJ,
      ...CUERPO_DJ,
      saldoFavorTecnico: "45000.0000",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DECLARATION_CREDIT_ALREADY_USED");
    expect(res.json().error.message).toMatch(MOTIVO_YA_USADO);
    const sigue = await prisma.taxCreditLot.findUniqueOrThrow({ where: { id: tecnico.id } });
    expect(sigue.verificationStatus).toBe("VERIFIED");
  });

  it("R9 corregir una DJ sin consumo reemplaza el lote: el anterior queda SUPERSEDED con historial y el nuevo VERIFIED", async () => {
    const e = await escenario();
    const documentoDJ = await documento(DJ);
    await declarar(e, { declarationDocumentId: documentoDJ, ...CUERPO_DJ });
    const anterior = await loteVigente(e.filingId, "IVA_TECNICO");
    const res = await declarar(e, {
      declarationDocumentId: documentoDJ,
      ...CUERPO_DJ,
      saldoFavorTecnico: "45000.0000",
    });
    expect(res.statusCode).toBe(200);
    const nuevo = await loteVigente(e.filingId, "IVA_TECNICO");
    expect(nuevo.id).not.toBe(anterior.id);
    expect(nuevo.originalAmount.toFixed(4)).toBe("45000.0000");
    const generados = res.json().data.saldosGenerados as ResultadoLote[];
    expect(generados).toContainEqual(
      expect.objectContaining({
        kind: "IVA_TECNICO",
        status: "REEMPLAZADO",
        reemplazaLotId: anterior.id,
        lotId: nuevo.id,
      }),
    );
    const viejo = await prisma.taxCreditLot.findUniqueOrThrow({
      where: { id: anterior.id },
      include: { history: true },
    });
    expect(viejo.verificationStatus).toBe("SUPERSEDED");
    expect(viejo.history.some((h) => JSON.stringify(h.changes).includes("SUPERSEDED"))).toBe(true);
  });

  it("R10 DJ tardía: si el cierre de P ya se usó en el cierre de P+1, la DJ responde 409 y no crea nada", async () => {
    const e = await escenario();
    const cierreTecnico = await cierre(e, "IVA_TECNICO", "48000.0000");
    await consumidoPor(cierreTecnico.id, await escenario(), "48000.0000");
    const res = await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("DECLARATION_CREDIT_ALREADY_USED");
    expect(res.json().error.message).toMatch(MOTIVO_YA_USADO);
    expect(await lotesDeLaDJ(e.filingId)).toHaveLength(0);
    const sigue = await prisma.taxCreditLot.findUniqueOrThrow({ where: { id: cierreTecnico.id } });
    expect(sigue.verificationStatus).toBe("VERIFIED");
  });

  it("R11 PATCH carryForward=false: se guarda, queda en el historial con el usuario y sale del disponible de P+1", async () => {
    const e = await escenario();
    await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    const tecnico = await loteVigente(e.filingId, "IVA_TECNICO");
    const res = await pedir(
      "PATCH",
      `${clienteUrl()}/tax-credit-ledger/${tecnico.id}`,
      TOKEN_OWNER,
      {
        carryForward: false,
      },
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().data.carryForward).toBe(false);
    const lote = (await libro()).find((item) => item.id === tecnico.id);
    expect(lote).toMatchObject({ carryForward: false });
    const ultimo = lote?.history.at(-1);
    expect(ultimo?.changes).toMatchObject({ carryForward: { from: true, to: false } });
    expect(ultimo?.createdBy?.id).toBe(OWNER);
    expect(await disponibleParaSiguiente("IVA_TECNICO", e.periodId)).toBe("0.0000");
  });

  it("R12 PATCH carryForward sobre un lote ya usado en un cierre responde 409 con el motivo", async () => {
    const e = await escenario();
    await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    const tecnico = await loteVigente(e.filingId, "IVA_TECNICO");
    await consumidoPor(tecnico.id, await escenario(), "50000.0000");
    const res = await pedir(
      "PATCH",
      `${clienteUrl()}/tax-credit-ledger/${tecnico.id}`,
      TOKEN_OWNER,
      {
        carryForward: false,
      },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(MOTIVO_YA_USADO);
  });

  it("R13 el libro informa el origen de cada lote (DJ, CIERRE o MANUAL), la presentación, el arrastre y la verificación", async () => {
    const e = await escenario();
    const cierreLibre = await cierre(e, "IVA_LIBRE", "10.0000");
    await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    const tecnico = await loteVigente(e.filingId, "IVA_TECNICO");
    const per = await periodo(ivaRegime.taxTypeId);
    const manual = await pedir("POST", `${clienteUrl()}/tax-credit-ledger/opening`, TOKEN_OWNER, {
      taxTypeId: ivaRegime.taxTypeId,
      regimeId: ivaRegime.id,
      jurisdictionId: ivaRegime.jurisdictionId,
      periodId: per.id,
      kind: "IVA_TECNICO",
      amount: "77.00",
    });
    const porId = new Map((await libro()).map((lote) => [lote.id, lote]));
    expect(porId.get(tecnico.id)).toMatchObject({
      origin: "DJ",
      sourceFilingId: e.filingId,
      carryForward: true,
      verificationStatus: "VERIFIED",
    });
    expect(porId.get(cierreLibre.id)).toMatchObject({
      origin: "CIERRE",
      sourceFilingId: null,
      carryForward: true,
      verificationStatus: "SUPERSEDED",
    });
    expect(porId.get(manual.json().data.id as string)).toMatchObject({
      origin: "MANUAL",
      sourceFilingId: null,
      carryForward: true,
      verificationStatus: "PENDING_VERIFICATION",
    });
  });

  it("R14 RLS: el rol runtime ve los lotes de la DJ de su estudio y no los de otro estudio", async () => {
    const e = await escenario();
    await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    const propios = await comoRuntime(FIRM, (tx) =>
      tx.taxCreditLot.findMany({ where: { sourceFilingId: e.filingId } }),
    );
    expect(propios.length).toBeGreaterThan(0);
    const ajenos = await comoRuntime(OTHER_FIRM, (tx) =>
      tx.taxCreditLot.findMany({ where: { sourceFilingId: e.filingId } }),
    );
    expect(ajenos).toHaveLength(0);
  });

  it("R15 un saldo manual del mismo período e impuesto no reemplaza el lote de la DJ", async () => {
    const e = await escenario();
    await declarar(e, { declarationDocumentId: await documento(DJ), ...CUERPO_DJ });
    const tecnico = await loteVigente(e.filingId, "IVA_TECNICO");
    const alta = await pedir("POST", `${clienteUrl()}/tax-credit-ledger/opening`, TOKEN_OWNER, {
      taxTypeId: ivaRegime.taxTypeId,
      regimeId: ivaRegime.id,
      jurisdictionId: ivaRegime.jurisdictionId,
      periodId: e.periodId,
      kind: "IVA_TECNICO",
      amount: "1234.00",
    });
    expect(alta.statusCode).toBe(201);
    const sigue = await prisma.taxCreditLot.findUniqueOrThrow({ where: { id: tecnico.id } });
    expect(sigue.verificationStatus).toBe("VERIFIED");
  });
});

// -- fin de pruebas rojas (commit 2) --
