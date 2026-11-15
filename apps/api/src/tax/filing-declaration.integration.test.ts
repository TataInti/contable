import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildServer } from "../server.js";
import { prisma } from "../lib/prisma.js";
import { sha256 } from "../auth/sessions.js";
import { requiredCapability } from "../auth/guard.js";

/**
 * Declaración jurada (DJ) de una presentación por la ruta real (corte 5a).
 * Datos sintéticos rotulados («Cliente sintético DJ 5A»): un estudio nuevo por corrida y
 * un período por escenario (una obligación por cliente, régimen y período). No se borran
 * filas: las liquidaciones finalizadas tienen triggers inmutables y la base es desechable.
 * En NODE_ENV=test la ruta usa DATABASE_URL (superusuario, sin RLS); la RLS se verifica con
 * el rol runtime, como en la prueba de integración del Panel de trabajo.
 */

const FIRM = randomUUID();
const OTHER_FIRM = randomUUID();
const OWNER = randomUUID();
const DJ = "DECLARACION_JURADA";
const token = randomBytes(32).toString("base64url");
const CSRF = "csrf-dj5a-test-0123456789abcdef0123456789";

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
let otherClientId: string;
let profileVersionId: string;
let regime: { id: string; taxTypeId: string; jurisdictionId: string };
let documentoOtroEstudio: string;
let mes = 0;

interface Escenario {
  obligationId: string;
  settlementId: string;
  filingId: string;
  acuseId: string;
  periodId: string;
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

/** Crea un período, una obligación, una liquidación y una presentación con su acuse (sintéticos). */
async function escenario(opts: {
  settlementStatus: "FINALIZED" | "SUPERSEDED";
  filingStatus: "FILED" | "PENDING";
  totals?: Record<string, string>;
}): Promise<Escenario> {
  mes += 1;
  const period = await prisma.taxPeriod.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regime.taxTypeId,
      startDate: new Date(Date.UTC(2026, mes - 1, 1)),
      endDate: new Date(Date.UTC(2026, mes, 0)),
      label: `Período sintético DJ 5A ${mes}`,
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
  const settlement = await prisma.taxSettlement.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: regime.taxTypeId,
      regimeId: regime.id,
      jurisdictionId: regime.jurisdictionId,
      periodId: period.id,
      cutoff: new Date(Date.UTC(2026, mes, 0)),
      version: 1,
      engineVersion: "sintetico-5a",
      rulesHash: "sintetico-5a",
      inputHash: "sintetico-5a",
      outputHash: "sintetico-5a",
      status: opts.settlementStatus,
      totals: opts.totals ?? TOTALES_LIQUIDACION,
      preparedByUserId: OWNER,
      ...(opts.settlementStatus === "FINALIZED"
        ? { finalizedByUserId: OWNER, finalizedAt: new Date() }
        : {}),
    },
  });
  const acuse = await prisma.document.create({
    data: { firmId: FIRM, clientId, category: "ACUSE", status: "READY" },
  });
  const filing = await prisma.taxFiling.create({
    data: {
      firmId: FIRM,
      clientId,
      obligationId: obligation.id,
      settlementId: settlement.id,
      filedAt: new Date(Date.UTC(2026, mes, 10)),
      amountFiled: "1500.00",
      status: opts.filingStatus,
      evidenceDocumentId: acuse.id,
      createdByUserId: OWNER,
    },
  });
  return {
    obligationId: obligation.id,
    settlementId: settlement.id,
    filingId: filing.id,
    acuseId: acuse.id,
    periodId: period.id,
  };
}

async function documento(
  category: string,
  status: "READY" | "UPLOADED",
  client = clientId,
): Promise<string> {
  const doc = await prisma.document.create({
    data: { firmId: FIRM, clientId: client, category, status },
  });
  return doc.id;
}

function url(e: Escenario, filingId = e.filingId, obligationId = e.obligationId): string {
  return `/api/v1/firms/${FIRM}/clients/${clientId}/tax-obligations/${obligationId}/filings/${filingId}/declaration`;
}

function declarar(
  e: Escenario,
  body: Record<string, unknown>,
  filingId?: string,
  obligationId?: string,
) {
  return app.inject({
    method: "PATCH",
    url: url(e, filingId, obligationId),
    cookies: { refresh_token: token, csrf_token: CSRF },
    headers: { "x-csrf-token": CSRF },
    payload: body,
  });
}

/** Transacción con el rol runtime y el contexto RLS del estudio, como withTenantContext. */
function comoRuntime<T>(
  firm: string,
  fn: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<T>,
) {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${OWNER}, true)`;
    await tx.$queryRaw`SELECT set_config('app.firm_id', ${firm}, true)`;
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

  const iva = await prisma.taxRegime.findFirst({
    where: { isActive: true, taxType: { code: "IVA" } },
    orderBy: { code: "asc" },
  });
  if (!iva) throw new Error("seed-maestros-fiscales no cargado: falta un régimen activo de IVA");
  regime = { id: iva.id, taxTypeId: iva.taxTypeId, jurisdictionId: iva.jurisdictionId };

  await prisma.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now()), ($3,$4,$4,now())`,
    FIRM,
    "Estudio sintético DJ 5A",
    OTHER_FIRM,
    "Estudio sintético DJ 5A (otro)",
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
    OWNER,
    `${OWNER}@dj5a.test.local`,
    "Titular DJ 5A",
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO firm_memberships ("id","firmId","userId",role,status,"acceptedAt") VALUES (gen_random_uuid()::text,$1,$2,'OWNER','ACTIVE',now())`,
    FIRM,
    OWNER,
  );
  await prisma.deviceSession.create({
    data: {
      id: randomUUID(),
      userId: OWNER,
      refreshTokenHash: sha256(token),
      familyId: randomUUID(),
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const cliente = await prisma.client.create({
    data: {
      firmId: FIRM,
      legalName: "Cliente sintético DJ 5A",
      tradeName: "Sintético DJ 5A",
      cuit: cuitEndingIn("7"),
      status: "ACTIVE",
    },
  });
  clientId = cliente.id;
  const perfil = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM,
      clientId,
      legalName: "Cliente sintético DJ 5A",
      cuit: cuitEndingIn("7"),
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  profileVersionId = perfil.id;
  const otroCliente = await prisma.client.create({
    data: {
      firmId: FIRM,
      legalName: "Cliente sintético DJ 5A (otro del estudio)",
      tradeName: "Sintético DJ 5A otro",
      cuit: cuitEndingIn("3"),
      status: "ACTIVE",
    },
  });
  otherClientId = otroCliente.id;

  const clienteOtroEstudio = await prisma.client.create({
    data: {
      firmId: OTHER_FIRM,
      legalName: "Cliente sintético DJ 5A (otro estudio)",
      tradeName: "Sintético DJ 5A ajeno",
      cuit: cuitEndingIn("5"),
      status: "ACTIVE",
    },
  });
  documentoOtroEstudio = (
    await prisma.document.create({
      data: { firmId: OTHER_FIRM, clientId: clienteOtroEstudio.id, category: DJ, status: "READY" },
    })
  ).id;
});

afterAll(async () => {
  await app?.close();
  await runtimePrisma?.$disconnect();
});

describe("declaración jurada de la presentación: carga, reemplazo y advertencias", () => {
  it("carga la DJ sobre una presentación FILED, responde la presentación y deja auditoría", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj1 = await documento(DJ, "READY");
    const res = await declarar(e, { declarationDocumentId: dj1, ...CUERPO_BASE });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.filing.id).toBe(e.filingId);
    expect(data.filing.declarationDocumentId).toBe(dj1);
    expect(Number(data.filing.totalAPagar)).toBe(1500);
    expect(data.filing.declaredByUserId).toBe(OWNER);
    expect(data.filing.declaredAt).not.toBeNull();
    expect(data.warnings).toEqual([]);

    const auditoria = await prisma.auditEvent.findMany({
      where: { entityId: e.filingId, action: "FILING_DECLARATION_RECORDED" },
      orderBy: { createdAt: "asc" },
    });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]?.before).toBeNull();
    expect(auditoria[0]?.after).toMatchObject({
      declarationDocumentId: dj1,
      totalAPagar: "1500.0000",
    });
  });

  it("reemplaza la DJ anterior, deja el valor previo en la auditoría y advierte si el total no coincide", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj1 = await documento(DJ, "READY");
    const dj2 = await documento(DJ, "READY");
    expect((await declarar(e, { declarationDocumentId: dj1, ...CUERPO_BASE })).statusCode).toBe(
      200,
    );
    const res = await declarar(e, {
      declarationDocumentId: dj2,
      ...CUERPO_BASE,
      totalAPagar: "1500.02",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.filing.declarationDocumentId).toBe(dj2);
    expect(data.warnings.map((w: { code: string }) => w.code)).toEqual([
      "TOTAL_A_PAGAR_DISTINTO_DE_PRESENTADO",
    ]);
    expect(data.warnings[0]).toMatchObject({ field: "totalAPagar" });

    const auditoria = await prisma.auditEvent.findMany({
      where: { entityId: e.filingId, action: "FILING_DECLARATION_RECORDED" },
      orderBy: { createdAt: "asc" },
    });
    expect(auditoria).toHaveLength(2);
    expect(auditoria[1]?.before).toMatchObject({
      declarationDocumentId: dj1,
      totalAPagar: "1500.0000",
    });
    expect(auditoria[1]?.after).toMatchObject({ declarationDocumentId: dj2 });
  });

  it("advierte si el saldo técnico no coincide con la liquidación y tolera 0,01 en el saldo libre", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj = await documento(DJ, "READY");
    const res = await declarar(e, {
      declarationDocumentId: dj,
      ...CUERPO_BASE,
      saldoFavorTecnico: "99.0000",
      saldoLibreDisponibilidad: "30.0100",
    });
    expect(res.statusCode).toBe(200);
    const codigos = res.json().data.warnings.map((w: { code: string }) => w.code);
    expect(codigos).toEqual(["SALDO_TECNICO_DISTINTO_DE_LIQUIDACION"]);
  });
});

describe("declaración jurada: validaciones de la ruta (campo y motivo)", () => {
  it.each([
    ["totalAPagar negativo", { totalAPagar: "-1" }, "totalAPagar"],
    ["más de 4 decimales", { totalAPagar: "1.00001" }, "totalAPagar"],
    ["saldo con signo", { saldoFavorTecnico: "-0.5" }, "saldoFavorTecnico"],
  ])("rechaza %s con 400 y el campo", async (_nombre, cambio, campo) => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj = await documento(DJ, "READY");
    const res = await declarar(e, { declarationDocumentId: dj, ...CUERPO_BASE, ...cambio });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
    expect(res.json().error.details.map((d: { path: string }) => d.path)).toContain(campo);
  });

  it("rechaza campos que no existen en el contrato", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj = await documento(DJ, "READY");
    const res = await declarar(e, {
      declarationDocumentId: dj,
      ...CUERPO_BASE,
      saldoInventado: "1",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });
});

describe("declaración jurada: documento y estado de la presentación", () => {
  it("un documento de otro estudio no se puede adjuntar (422, campo declarationDocumentId)", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const res = await declarar(e, { declarationDocumentId: documentoOtroEstudio, ...CUERPO_BASE });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatchObject({
      code: "DECLARATION_DOCUMENT_NOT_FOUND",
      details: { path: ["declarationDocumentId"] },
    });
  });

  it("un documento de otro cliente del mismo estudio tampoco se puede adjuntar", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const ajeno = await documento(DJ, "READY", otherClientId);
    const res = await declarar(e, { declarationDocumentId: ajeno, ...CUERPO_BASE });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DECLARATION_DOCUMENT_NOT_FOUND");
  });

  it("un documento que todavía no está listo se rechaza (422 DECLARATION_DOCUMENT_NOT_READY)", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const sinListo = await documento(DJ, "UPLOADED");
    const res = await declarar(e, { declarationDocumentId: sinListo, ...CUERPO_BASE });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DECLARATION_DOCUMENT_NOT_READY");
  });

  it("un acuse no sirve como DJ (422 DECLARATION_DOCUMENT_WRONG_CATEGORY)", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const res = await declarar(e, { declarationDocumentId: e.acuseId, ...CUERPO_BASE });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("DECLARATION_DOCUMENT_WRONG_CATEGORY");
  });

  it("una presentación PENDING no admite DJ (409 FILING_NOT_FILED, con el paso que falta)", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "PENDING" });
    const dj = await documento(DJ, "READY");
    const res = await declarar(e, { declarationDocumentId: dj, ...CUERPO_BASE });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({
      code: "FILING_NOT_FILED",
      details: { path: ["filingId"] },
    });
    expect(res.json().error.message).toContain("Falta: presentación con acuse");
  });

  it("la DJ de una presentación de liquidación SUPERSEDED se rechaza con el motivo (409)", async () => {
    const e = await escenario({ settlementStatus: "SUPERSEDED", filingStatus: "FILED" });
    const dj = await documento(DJ, "READY");
    const res = await declarar(e, { declarationDocumentId: dj, ...CUERPO_BASE });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("FILING_SETTLEMENT_SUPERSEDED");
  });

  it("una presentación inexistente responde 404 con el campo filingId", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj = await documento(DJ, "READY");
    const res = await declarar(e, { declarationDocumentId: dj, ...CUERPO_BASE }, randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatchObject({
      code: "FILING_NOT_FOUND",
      details: { path: ["filingId"] },
    });
  });
});

describe("declaración jurada: lectura, no bloqueo (D3) y RLS", () => {
  it("el cronograma de la liquidación devuelve los campos de la DJ junto a la presentación", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj = await documento(DJ, "READY");
    expect((await declarar(e, { declarationDocumentId: dj, ...CUERPO_BASE })).statusCode).toBe(200);
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/firms/${FIRM}/clients/${clientId}/tax-settlements/${e.settlementId}/timeline`,
      cookies: { refresh_token: token },
    });
    expect(res.statusCode).toBe(200);
    const presentacion = res.json().data.filings.find((f: { id: string }) => f.id === e.filingId);
    expect(presentacion.declarationDocumentId).toBe(dj);
    expect(Number(presentacion.saldoFavorTecnico)).toBeCloseTo(120.5);
  });

  it("con la DJ pendiente se registra un pago igual (no bloqueo, D3)", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/firms/${FIRM}/clients/${clientId}/tax-obligations/${e.obligationId}/payments`,
      cookies: { refresh_token: token, csrf_token: CSRF },
      headers: { "x-csrf-token": CSRF },
      payload: {
        settlementId: e.settlementId,
        paidAt: "2026-12-01",
        amount: "100.00",
        method: "TRANSFERENCIA",
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("RLS: el rol runtime ve la presentación de su estudio y no ve la DJ ni la presentación de otro estudio", async () => {
    const e = await escenario({ settlementStatus: "FINALIZED", filingStatus: "FILED" });
    const dj = await documento(DJ, "READY");
    expect((await declarar(e, { declarationDocumentId: dj, ...CUERPO_BASE })).statusCode).toBe(200);

    const contar = (firm: string, tabla: "documents" | "tax_filings", id: string) =>
      comoRuntime(firm, async (tx) => {
        const filas =
          tabla === "documents"
            ? await tx.$queryRaw<
                { n: bigint }[]
              >`SELECT count(*)::bigint AS n FROM documents WHERE id = ${id}`
            : await tx.$queryRaw<
                { n: bigint }[]
              >`SELECT count(*)::bigint AS n FROM tax_filings WHERE id = ${id}`;
        return Number(filas[0]?.n ?? 0);
      });

    expect(await contar(FIRM, "tax_filings", e.filingId)).toBe(1);
    expect(await contar(OTHER_FIRM, "tax_filings", e.filingId)).toBe(0);
    expect(await contar(FIRM, "documents", dj)).toBe(1);
    expect(await contar(FIRM, "documents", documentoOtroEstudio)).toBe(0);
    // Un titular del estudio no ve documentos de otro estudio aunque el contexto cambie de estudio: no es miembro.
    expect(await contar(OTHER_FIRM, "documents", documentoOtroEstudio)).toBe(0);
  });

  it("la ruta de la DJ usa la capacidad tax.filings.record y no el catch-all de tax-obligations", () => {
    expect(
      requiredCapability(
        "PATCH",
        "/api/v1/firms/:p/clients/:p/tax-obligations/:p/filings/:p/declaration",
      ),
    ).toBe("tax.filings.record");
  });
});
