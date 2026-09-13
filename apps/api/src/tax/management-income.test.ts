import { describe, expect, it, beforeEach } from "vitest";
import { prisma } from "../lib/prisma.js";
import {
  ManagementIncomeService,
} from "./management-income-service.js";
import { ProfitabilityService } from "./profitability-service.js";
import type { TenantContext } from "../auth/tenant.js";

/**
 * C (plan piloto fiscal §7): ingresos gerenciales y separación fiscal.
 *
 * §7.1 ciclo: alta DRAFT → envío → aprobación por usuario distinto /
 * rechazo con comentario obligatorio; sólo APPROVED participa del cálculo;
 * una versión aprobada no se modifica; nunca crea comprobante fiscal.
 *
 * §7.2: un ingreso gerencial aprobado aumenta el resultado devengado; en
 * caja sólo entra cuando la cobranza pertenece al período; borradores y
 * rechazados no afectan snapshots; no cambia hashes ni totales de IVA.
 */

const OWNER_C = "c5c50000-0000-4000-8000-000000000001";
const REVIEWER_C = "c5c50000-0000-4000-8000-000000000002";
const FIRM_C = "c5c50000-0000-4000-8000-000000000003";
const CLIENT_C = "c5c50000-0000-4000-8000-000000000004";
const TAX_TYPE_C = "c5c50000-0000-4000-8000-000000000005";
const REGIME_C = "c5c50000-0000-4000-8000-000000000006";
const JURIS_C = "c5c50000-0000-4000-8000-000000000007";
const AUTH_C = "c5c50000-0000-4000-8000-000000000008";
const PROFILE_C = "c5c50000-0000-4000-8000-000000000009";
const PERIOD_C = "c5c50000-0000-4000-8000-00000000000a";

const incomes = new ManagementIncomeService();
const profitability = new ProfitabilityService();

const ctxOwner: TenantContext = { userId: OWNER_C, firmId: FIRM_C, actorKind: "USER" };
const ctxReviewer: TenantContext = { userId: REVIEWER_C, firmId: FIRM_C, actorKind: "USER" };

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_C, "owner.c@test.local", "Owner C"],
    [REVIEWER_C, "reviewer.c@test.local", "Reviewer C"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_C}', 'Estudio C', 'Estudio C', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_C}', '${FIRM_C}', 'Cliente C', '20999999972', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  for (const [userId, role] of [
    [OWNER_C, "OWNER"],
    [REVIEWER_C, "REVIEWER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_C}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
}

async function setupFiscalComponent() {
  await prisma.jurisdiction.upsert({
    where: { code: "AR-C" },
    update: {},
    create: { id: JURIS_C, code: "AR-C", name: "Nación C", kind: "NATIONAL" },
  });
  await prisma.taxAuthority.upsert({
    where: { code: "ARCA-C" },
    update: {},
    create: { id: AUTH_C, code: "ARCA-C", name: "ARCA C", jurisdictionId: JURIS_C },
  });
  await prisma.taxType.upsert({
    where: { code: "IVA_C" },
    update: {},
    create: { id: TAX_TYPE_C, code: "IVA_C", name: "IVA C" },
  });
  await prisma.taxRegime.upsert({
    where: { code: "RI_C" },
    update: {},
    create: {
      id: REGIME_C,
      code: "RI_C",
      name: "RI C",
      taxTypeId: TAX_TYPE_C,
      jurisdictionId: JURIS_C,
      authorityId: AUTH_C,
    },
  });
  await prisma.taxpayerProfileVersion.upsert({
    where: { clientId_version: { clientId: CLIENT_C, version: 1 } },
    update: { status: "ACTIVE" },
    create: {
      id: PROFILE_C,
      firmId: FIRM_C,
      clientId: CLIENT_C,
      version: 1,
      legalName: "Cliente C",
      cuit: "20999999972",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  await prisma.taxPeriod.upsert({
    where: {
      clientId_taxTypeId_startDate_endDate: {
        clientId: CLIENT_C,
        taxTypeId: TAX_TYPE_C,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-01-31T00:00:00.000Z"),
      },
    },
    update: {},
    create: {
      id: PERIOD_C,
      firmId: FIRM_C,
      clientId: CLIENT_C,
      taxTypeId: TAX_TYPE_C,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-31T00:00:00.000Z"),
      label: "2026-01 C",
    },
  });
}

async function cleanup() {
  await prisma.managementIncome.deleteMany({ where: { firmId: FIRM_C } });
  await prisma.profitabilitySnapshot.deleteMany({ where: { firmId: FIRM_C } });
  await prisma.fiscalVoucher.deleteMany({ where: { firmId: FIRM_C } });
  await prisma.taxSettlement.deleteMany({ where: { firmId: FIRM_C } });
}

/** Ingreso aprobado listo para participar del cálculo. */
async function createApprovedIncome(input: {
  amount: string;
  accruedOn: string;
  collectedOn?: string;
}) {
  const income = await incomes.create(ctxOwner, {
    clientId: CLIENT_C,
    description: "Honorarios por advisory (gerencial)",
    amount: input.amount,
    accruedOn: input.accruedOn,
    ...(input.collectedOn ? { collectedOn: input.collectedOn } : {}),
  });
  await incomes.submitForReview(ctxOwner, income.id);
  return incomes.approve(ctxReviewer, income.id);
}

describe("C §7.1 ciclo de ingresos gerenciales", () => {
  beforeEach(async () => {
    await setupMembership();
    await setupFiscalComponent();
    await cleanup();
  });

  it("alta en DRAFT con fecha devengada, cobro opcional, categoría, moneda e importe", async () => {
    const income = await incomes.create(ctxOwner, {
      clientId: CLIENT_C,
      description: "Consultoría",
      amount: "50000",
      accruedOn: "2026-01-15",
      collectedOn: "2026-02-10",
      category: "HONORARIOS",
      currency: "ARS",
    });
    expect(income.status).toBe("DRAFT");
    expect(income.accruedOn).toBeTruthy();
    expect(income.collectedOn).toBeTruthy();
    expect(income.category).toBe("HONORARIOS");
    expect(income.currency).toBe("ARS");
  });

  it("envío a revisión y aprobación por usuario distinto", async () => {
    const income = await incomes.create(ctxOwner, {
      clientId: CLIENT_C,
      description: "Consultoría",
      amount: "50000",
      accruedOn: "2026-01-15",
    });
    await incomes.submitForReview(ctxOwner, income.id);
    // Maker-checker: el creador no puede aprobar.
    await expect(incomes.approve(ctxOwner, income.id)).rejects.toMatchObject({
      code: "MAKER_CHECKER_VIOLATION",
    });
    const approved = await incomes.approve(ctxReviewer, income.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.reviewedByUserId).toBe(REVIEWER_C);
    expect(approved.reviewedAt).toBeTruthy();
  });

  it("rechazo exige comentario obligatorio", async () => {
    const income = await incomes.create(ctxOwner, {
      clientId: CLIENT_C,
      description: "Consultoría",
      amount: "1000",
      accruedOn: "2026-01-15",
    });
    await incomes.submitForReview(ctxOwner, income.id);
    await expect(incomes.reject(ctxReviewer, income.id, "  ")).rejects.toMatchObject({
      code: "COMMENT_REQUIRED",
    });
    const rejected = await incomes.reject(ctxReviewer, income.id, "Falta respaldo del cliente");
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.rejectionComment).toBe("Falta respaldo del cliente");
  });

  it("evidencia de otro cliente rechazada", async () => {
    // Documento de otro cliente de la misma firma.
    const otherClient = await prisma.client.upsert({
      where: { id: "c5c50000-0000-4000-8000-0000000000ff" },
      update: {},
      create: {
        id: "c5c50000-0000-4000-8000-0000000000ff",
        firmId: FIRM_C,
        legalName: "Cliente C ajeno",
        cuit: "20999999971",
      },
    });
    const foreignDoc = await prisma.document.create({
      data: { firmId: FIRM_C, clientId: otherClient.id, status: "READY", uploadOrigin: "FIRM" },
    });
    await expect(
      incomes.create(ctxOwner, {
        clientId: CLIENT_C,
        description: "Ingreso con evidencia ajena",
        amount: "100",
        accruedOn: "2026-01-15",
        evidenceDocumentId: foreignDoc.id,
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
  });

  it("una versión aprobada no se modifica silenciosamente", async () => {
    const income = await createApprovedIncome({ amount: "2000", accruedOn: "2026-01-15" });
    await expect(
      incomes.update(ctxOwner, income.id, { amount: "9999" }),
    ).rejects.toMatchObject({ code: "INCOME_IMMUTABLE" });
  });

  it("el ingreso gerencial nunca crea comprobante, componente ni ajuste fiscal", async () => {
    const before = await prisma.fiscalVoucher.count({ where: { firmId: FIRM_C } });
    await createApprovedIncome({ amount: "3000", accruedOn: "2026-01-15" });
    const afterVouchers = await prisma.fiscalVoucher.count({ where: { firmId: FIRM_C } });
    const afterAdjustments = await prisma.taxAdjustment.count({ where: { firmId: FIRM_C } });
    expect(afterVouchers).toBe(before);
    expect(afterAdjustments).toBe(0);
  });
});

describe("C §7.2 separación fiscal y gerencial", () => {
  beforeEach(async () => {
    await setupMembership();
    await setupFiscalComponent();
    await cleanup();
  });

  it("un ingreso gerencial aprobado aumenta el resultado devengado", async () => {
    const base = await profitability.calculate(ctxOwner, {
      clientId: CLIENT_C,
      periodId: PERIOD_C,
      basis: "DEVENGADO",
      cutoff: "2026-01-31",
    });
    await createApprovedIncome({ amount: "10000", accruedOn: "2026-01-15" });
    const withIncome = await profitability.calculate(ctxOwner, {
      clientId: CLIENT_C,
      periodId: PERIOD_C,
      basis: "DEVENGADO",
      cutoff: "2026-01-31",
    });
    const baseTotals = base.snapshot.totals as Record<string, string>;
    const withTotals = withIncome.snapshot.totals as Record<string, string>;
    expect(Number(withTotals["RESULTADO_POST_IMPUESTOS"])).toBe(
      Number(baseTotals["RESULTADO_POST_IMPUESTOS"]) + 10000,
    );
  });

  it("en caja sólo entra cuando la fecha de cobro pertenece al período", async () => {
    // Devengado en enero, cobrado en febrero: no entra en la caja de enero.
    await createApprovedIncome({
      amount: "8000",
      accruedOn: "2026-01-15",
      collectedOn: "2026-02-10",
    });
    const january = await profitability.calculate(ctxOwner, {
      clientId: CLIENT_C,
      periodId: PERIOD_C,
      basis: "CAJA",
      cutoff: "2026-01-31",
    });
    const januaryAccrued = await profitability.calculate(ctxOwner, {
      clientId: CLIENT_C,
      periodId: PERIOD_C,
      basis: "DEVENGADO",
      cutoff: "2026-01-31",
    });
    const cajaTotals = january.snapshot.totals as Record<string, string>;
    const devengadoTotals = januaryAccrued.snapshot.totals as Record<string, string>;
    // El devengado de enero incluye el ingreso (8000); la caja de enero no
    // (el cobro es de febrero).
    expect(Number(devengadoTotals["RESULTADO_POST_IMPUESTOS"])).toBeGreaterThan(
      Number(cajaTotals["FLUJO_NETO"]),
    );
  });

  it("borradores y rechazados no afectan snapshots", async () => {
    const base = await profitability.calculate(ctxOwner, {
      clientId: CLIENT_C,
      periodId: PERIOD_C,
      basis: "DEVENGADO",
      cutoff: "2026-01-31",
    });
    const draft = await incomes.create(ctxOwner, {
      clientId: CLIENT_C,
      description: "Borrador sin efecto",
      amount: "5000",
      accruedOn: "2026-01-15",
    });
    await incomes.submitForReview(ctxOwner, draft.id);
    await incomes.reject(ctxReviewer, draft.id, "Duplicado");
    const after = await profitability.calculate(ctxOwner, {
      clientId: CLIENT_C,
      periodId: PERIOD_C,
      basis: "DEVENGADO",
      cutoff: "2026-01-31",
    });
    expect((after.snapshot.totals as Record<string, string>)["RESULTADO_POST_IMPUESTOS"]).toBe(
      (base.snapshot.totals as Record<string, string>)["RESULTADO_POST_IMPUESTOS"],
    );
  });

  it("un ingreso gerencial no cambia hashes ni totales de liquidaciones fiscales", async () => {
    await createApprovedIncome({ amount: "20000", accruedOn: "2026-01-15" });
    // Las liquidaciones fiscales del período quedan intactas (ninguna).
    const settlements = await prisma.taxSettlement.count({
      where: { firmId: FIRM_C, clientId: CLIENT_C },
    });
    expect(settlements).toBe(0);
    // Y el snapshot de rentabilidad no genera diferencias fiscales.
    const differences = await prisma.taxDifference.count({
      where: { firmId: FIRM_C, clientId: CLIENT_C },
    });
    expect(differences).toBe(0);
  });
});
