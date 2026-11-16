import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  origenDelLote,
  planificarLotesDeclaracion,
  retirarLotesDeLaLiquidacionReemplazada,
  type EntradaPlanificacion,
} from "./declaration-credit-lots.js";

/**
 * Corte 6a: planificación pura de los lotes que genera una DJ (tabla dorada, cifras «Demo») y
 * la cascada de rectificativas sobre base real. Los identificadores de catálogo son fijos y
 * sintéticos: no dependen del seed.
 */

const IVA_TAX = "00000000-0000-4000-8000-00000000a001";
const IIBB_TAX = "00000000-0000-4000-8000-00000000b001";
const REG_IVA = "00000000-0000-4000-8000-00000000a101";
const REG_CM = "00000000-0000-4000-8000-00000000b101";
const JUR_NAC = "00000000-0000-4000-8000-00000000c003";
const JUR_CABA = "00000000-0000-4000-8000-00000000c001";
const JUR_BA = "00000000-0000-4000-8000-00000000c002";

const IVA_DJ: EntradaPlanificacion = {
  obligacion: { taxTypeId: IVA_TAX, regimeId: REG_IVA, jurisdictionId: JUR_NAC, esIva: true },
  liquidacion: { regimeId: REG_IVA, jurisdictionId: JUR_NAC },
  saldoFavorTecnico: "50000.0000",
  saldoLibreDisponibilidad: "20000.0000",
  saldosFavorDetalle: undefined,
  reemplazada: false,
};

describe("planificación de lotes de la DJ (corte 6a, pura)", () => {
  it("U1 IVA: el saldo técnico y el libre van al lote con el alcance de la liquidación y cubren el cierre", () => {
    const plan = planificarLotesDeclaracion(IVA_DJ);
    expect(plan.lotes).toEqual([
      { kind: "IVA_TECNICO", taxTypeId: IVA_TAX, regimeId: REG_IVA, jurisdictionId: JUR_NAC, amount: "50000.0000" },
      { kind: "IVA_LIBRE", taxTypeId: IVA_TAX, regimeId: REG_IVA, jurisdictionId: JUR_NAC, amount: "20000.0000" },
    ]);
    expect(plan.cubre).toEqual({ ivaTecnicoLibre: true, saldoAFavor: false });
    expect(plan.noCreados).toEqual([]);
  });

  it("U2 saldo en cero: no crea lote y lo informa con su motivo", () => {
    const plan = planificarLotesDeclaracion({ ...IVA_DJ, saldoFavorTecnico: "0.0000" });
    expect(plan.lotes.map((lote) => lote.kind)).toEqual(["IVA_LIBRE"]);
    expect(plan.noCreados).toEqual([
      expect.objectContaining({ kind: "IVA_TECNICO", amount: "0.0000", motivo: expect.stringMatching(/saldo en cero/) }),
    ]);
  });

  it("U3 detalle de otro impuesto: no alimenta el libro de esta obligación y se informa con el motivo", () => {
    const plan = planificarLotesDeclaracion({
      ...IVA_DJ,
      saldosFavorDetalle: [{ taxTypeId: IIBB_TAX, amount: "250.5000" }],
    });
    expect(plan.lotes.filter((lote) => lote.kind === "SALDO_A_FAVOR")).toEqual([]);
    expect(plan.noCreados).toContainEqual(
      expect.objectContaining({
        kind: "SALDO_A_FAVOR",
        taxTypeId: IIBB_TAX,
        motivo: expect.stringMatching(/otro impuesto o régimen/),
      }),
    );
  });

  it("U4 Convenio Multilateral con dos jurisdicciones: un lote por jurisdicción con el régimen de la obligación", () => {
    const plan = planificarLotesDeclaracion({
      obligacion: { taxTypeId: IIBB_TAX, regimeId: REG_CM, jurisdictionId: JUR_CABA, esIva: false },
      liquidacion: { regimeId: REG_CM, jurisdictionId: JUR_CABA },
      saldoFavorTecnico: "0.0000",
      saldoLibreDisponibilidad: "0.0000",
      saldosFavorDetalle: [
        { taxTypeId: IIBB_TAX, regimeId: REG_CM, jurisdictionId: JUR_CABA, amount: "100.0000" },
        { taxTypeId: IIBB_TAX, regimeId: REG_CM, jurisdictionId: JUR_BA, amount: "40.5000" },
      ],
      reemplazada: false,
    });
    expect(plan.lotes).toEqual([
      { kind: "SALDO_A_FAVOR", taxTypeId: IIBB_TAX, regimeId: REG_CM, jurisdictionId: JUR_CABA, amount: "100.0000" },
      { kind: "SALDO_A_FAVOR", taxTypeId: IIBB_TAX, regimeId: REG_CM, jurisdictionId: JUR_BA, amount: "40.5000" },
    ]);
    expect(plan.cubre).toEqual({ ivaTecnicoLibre: false, saldoAFavor: true });
    expect(plan.noCreados).toEqual([]);
  });

  it("U5 liquidación reemplazada por una versión posterior: no crea lotes, no cubre el cierre y lo dice", () => {
    const plan = planificarLotesDeclaracion({ ...IVA_DJ, reemplazada: true });
    expect(plan.lotes).toEqual([]);
    expect(plan.cubre).toEqual({ ivaTecnicoLibre: false, saldoAFavor: false });
    expect(plan.noCreados.every((item) => /reemplazad/.test(item.motivo))).toBe(true);
    expect(plan.noCreados).toHaveLength(2);
  });

  it("U6 saldos de IVA en una obligación que no es IVA: no generan lote y lo dicen; el detalle omitido no cubre el saldo a favor, el detalle vacío sí", () => {
    const noIva = planificarLotesDeclaracion({
      obligacion: { taxTypeId: IIBB_TAX, regimeId: REG_CM, jurisdictionId: JUR_CABA, esIva: false },
      liquidacion: { regimeId: REG_CM, jurisdictionId: JUR_CABA },
      saldoFavorTecnico: "10.0000",
      saldoLibreDisponibilidad: "0.0000",
      reemplazada: false,
    });
    expect(noIva.lotes).toEqual([]);
    expect(noIva.noCreados).toEqual([
      expect.objectContaining({ kind: "IVA_TECNICO", motivo: expect.stringMatching(/solo IVA/) }),
    ]);
    expect(planificarLotesDeclaracion(IVA_DJ).cubre.saldoAFavor).toBe(false);
    expect(planificarLotesDeclaracion({ ...IVA_DJ, saldosFavorDetalle: [] }).cubre.saldoAFavor).toBe(true);
  });

  it("U7 el origen de cada lote sale de un único lugar: DJ si viene de una presentación, CIERRE si viene de una liquidación, MANUAL en otro caso", () => {
    expect(origenDelLote({ sourceFilingId: "f-1", sourceSettlementId: null })).toBe("DJ");
    expect(origenDelLote({ sourceFilingId: null, sourceSettlementId: "s-1" })).toBe("CIERRE");
    expect(origenDelLote({ sourceFilingId: null, sourceSettlementId: null })).toBe("MANUAL");
  });
});

// Cascada de rectificativas sobre base real: la DJ de la versión anterior deja de contar al
// finalizar la versión que la reemplaza.
const FIRM = randomUUID();
const USER = randomUUID();
const TOKEN = randomBytes(8).toString("hex");
let clientId: string;
let djLotId: string;
let versionAnteriorId: string;
let versionNuevaId: string;

function cuitEndingIn(ending: string): string {
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  for (;;) {
    const base = `20${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
    const sum = weights.reduce((total, weight, index) => total + Number(base.charAt(index)) * weight, 0);
    const check = (11 - (sum % 11)) % 11;
    if (check < 10 && String(check) === ending) return `${base}${check}`;
  }
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO firms ("id","legalName","displayName","updatedAt") VALUES ($1,$2,$2,now())`,
    FIRM,
    `Estudio sintético cascada 6A ${TOKEN}`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users ("id","emailNormalized",name,"passwordHash","updatedAt") VALUES ($1,$2,$3,'x',now())`,
    USER,
    `${USER}@cascada6a.test.local`,
    "Titular sintético cascada 6A",
  );
  const iva = await prisma.taxRegime.findFirstOrThrow({
    where: { isActive: true, taxType: { code: "IVA" } },
    orderBy: { code: "asc" },
  });
  const cliente = await prisma.client.create({
    data: { firmId: FIRM, legalName: "Cliente sintético cascada 6A", tradeName: "Cascada 6A", cuit: cuitEndingIn("1"), status: "ACTIVE" },
  });
  clientId = cliente.id;
  const perfil = await prisma.taxpayerProfileVersion.create({
    data: {
      firmId: FIRM,
      clientId,
      legalName: "Cliente sintético cascada 6A",
      cuit: cuitEndingIn("1"),
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  const periodo = await prisma.taxPeriod.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: iva.taxTypeId,
      startDate: new Date(Date.UTC(2026, 2, 1)),
      endDate: new Date(Date.UTC(2026, 2, 31)),
      label: "Demo 03/2026 cascada",
    },
  });
  const obligacion = await prisma.taxObligation.create({
    data: { firmId: FIRM, clientId, profileVersionId: perfil.id, regimeId: iva.id, periodId: periodo.id, status: "FILED" },
  });
  const base = {
    firmId: FIRM,
    clientId,
    taxTypeId: iva.taxTypeId,
    regimeId: iva.id,
    jurisdictionId: iva.jurisdictionId,
    periodId: periodo.id,
    cutoff: new Date(Date.UTC(2026, 2, 31)),
    engineVersion: "sintetico-6a",
    rulesHash: "sintetico-6a",
    inputHash: "sintetico-6a",
    outputHash: "sintetico-6a",
    totals: { SALDO_TECNICO_AFTER: "48000.0000", SALDO_LIBRE_AFTER: "20000.0000" },
    preparedByUserId: USER,
  };
  const anterior = await prisma.taxSettlement.create({
    data: { ...base, version: 1, status: "FINALIZED", finalizedByUserId: USER, finalizedAt: new Date() },
  });
  versionAnteriorId = anterior.id;
  const nueva = await prisma.taxSettlement.create({
    data: { ...base, version: 2, status: "DRAFT", supersedesId: anterior.id },
  });
  versionNuevaId = nueva.id;
  const acuse = await prisma.document.create({ data: { firmId: FIRM, clientId, category: "ACUSE", status: "READY" } });
  const presentacion = await prisma.taxFiling.create({
    data: {
      firmId: FIRM,
      clientId,
      obligationId: obligacion.id,
      settlementId: anterior.id,
      filedAt: new Date(Date.UTC(2026, 3, 10)),
      amountFiled: "1500.00",
      status: "FILED",
      evidenceDocumentId: acuse.id,
      createdByUserId: USER,
    },
  });
  const lote = await prisma.taxCreditLot.create({
    data: {
      firmId: FIRM,
      clientId,
      taxTypeId: iva.taxTypeId,
      regimeId: iva.id,
      jurisdictionId: iva.jurisdictionId,
      periodId: periodo.id,
      kind: "IVA_TECNICO",
      originalAmount: "50000.0000",
      sourceFilingId: presentacion.id,
      verificationStatus: "VERIFIED",
      verifiedByUserId: USER,
      verifiedAt: new Date(),
      createdByUserId: USER,
    },
  });
  djLotId = lote.id;
});

afterAll(async () => {
  await prisma.$disconnect().catch(() => undefined);
});

describe("cascada de rectificativas (base real, corte 6a)", () => {
  it("U8 al finalizar la versión que reemplaza a una liquidación, los lotes de la DJ de la anterior quedan SUPERSEDED con historial", async () => {
    await prisma.$transaction((tx) =>
      retirarLotesDeLaLiquidacionReemplazada(tx, {
        firmId: FIRM,
        settlementId: versionAnteriorId,
        userId: USER,
      }),
    );
    const lote = await prisma.taxCreditLot.findUniqueOrThrow({
      where: { id: djLotId },
      include: { history: true },
    });
    expect(lote.verificationStatus).toBe("SUPERSEDED");
    expect(lote.history.length).toBeGreaterThan(0);
    expect(versionNuevaId).toBeTruthy();
  });
});
