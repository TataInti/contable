import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService } from "./ingestion-service.js";
import { SettlementService, SettlementError } from "./settlement-service.js";
import { computeRulesHashV3 } from "./rules-hash.js";

/**
 * Tests de integración TEM San Miguel de Tucumán (Puerta 4, Fase 4.2).
 *
 * Verifica:
 * - Dispatch por engineVersion (TEM_SMT_ENGINE_VERSION).
 * - Ingresos por actividad desde FiscalVoucherLine.
 * - Mínimo, créditos (retenciones/percepciones), saldo anterior.
 * - Workflow maker-checker (mismo que IVA/IIBB, reutilizado).
 * - V-004: determinismo (mismo input → mismo hash).
 */

const OWNER_TEM = "11111111-1111-4111-8111-555555555555";
const REVIEWER_TEM = "22222222-2222-4222-8222-666666666666";
const PREPARER_TEM = "33333333-3333-4333-8333-777777777777";
const FIRM_TEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CLIENT_TEM = "33333333-4444-4555-8666-123456789012";

const runtimeConnection =
  process.env.RUNTIME_DATABASE_URL ??
  "postgresql://contable_runtime:runtime_secret@localhost:5432/contable";
const runtimeAdapter = new PrismaPg({ connectionString: runtimeConnection });
const runtimePrisma = new PrismaClient({ adapter: runtimeAdapter });

async function runAsRuntime<T>(
  userId: string,
  firmId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return runtimePrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${userId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${firmId}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    return fn(tx) as Promise<T>;
  });
}

const ingestion = new IngestionService();
const settlements = new SettlementService();

const ctxOwner = { userId: OWNER_TEM, firmId: FIRM_TEM, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_TEM, firmId: FIRM_TEM, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_TEM, firmId: FIRM_TEM, actorKind: "USER" as const };

let taxTypeId = "";
let regimeId = "";
let jurisdictionId = "";
let periodId = "";
let obligationId = "";
let ruleVersionId = "";

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_TEM, "owner.tem@test.local", "Owner TEM"],
    [REVIEWER_TEM, "reviewer.tem@test.local", "Reviewer TEM"],
    [PREPARER_TEM, "preparer.tem@test.local", "Preparer TEM"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_TEM}', 'Estudio TEM', 'Estudio TEM', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_TEM}', '${FIRM_TEM}', 'Cliente TEM', '20999999995', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  for (const [userId, role] of [
    [OWNER_TEM, "OWNER"],
    [REVIEWER_TEM, "REVIEWER"],
    [PREPARER_TEM, "PREPARER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_TEM}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  for (const userId of [REVIEWER_TEM, PREPARER_TEM]) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
      VALUES (gen_random_uuid()::text, '${FIRM_TEM}', '${CLIENT_TEM}', '${userId}')
      ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
    `);
  }
}

async function setupMasters() {
  return runAsRuntime(OWNER_TEM, FIRM_TEM, async (tx) => {
    const smt = await tx.jurisdiction.upsert({
      where: { code: "AR-SMT" },
      update: {},
      create: { code: "AR-SMT", name: "San Miguel de Tucumán TEM", kind: "MUNICIPAL" },
    });
    const smtAuth = await tx.taxAuthority.upsert({
      where: { code: "SMT-TEM" },
      update: {},
      create: { code: "SMT-TEM", name: "SMT TEM", jurisdictionId: smt.id },
    });
    const tem = await tx.taxType.upsert({
      where: { code: "TEM" },
      update: {},
      create: { code: "TEM", name: "TEM Test" },
    });
    const regime = await tx.taxRegime.upsert({
      where: { code: "TEM_SMT-TEM" },
      update: {},
      create: {
        code: "TEM_SMT-TEM",
        name: "TEM SMT Test",
        taxTypeId: tem.id,
        jurisdictionId: smt.id,
        authorityId: smtAuth.id,
      },
    });
    return { smt, smtAuth, tem, regime };
  });
}

async function setupActiveRules(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_TEM, FIRM_TEM, async (tx) => {
    const pack = await tx.taxRulePack.create({
      data: { code: "TEM_SMT_TEST_V1", name: "TEM SMT Test V1", regimeId: fx.regime.id },
    });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-tem-smt-v1.1.0",
        rulesHash: "sha256:tem-test",
      },
    });
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "COMERCIO", rate: new Prisma.Decimal("2"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "SERVICIOS", rate: new Prisma.Decimal("3"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "DEFAULT", rate: new Prisma.Decimal("2"), validFrom: new Date("2026-01-01") },
      ],
    });
    await tx.taxMinimumRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "MINIMO", amount: new Prisma.Decimal("3000"), validFrom: new Date("2026-01-01") },
      ],
    });
    return { pack, version };
  });
}

async function setupSettlementContext(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_TEM, FIRM_TEM, async (tx) => {
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        version: 1,
        legalName: "Cliente TEM SA",
        cuit: "20999999995",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_TEM,
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        taxTypeId: fx.tem.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    await tx.taxRegistration.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });
    const obligation = await tx.taxObligation.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_TEM,
      },
    });
    return { profile, period, obligation };
  });
}

/** Crea un documento de evidencia (acuse) para el cliente. */
async function createEvidenceDocument(): Promise<string> {
  const doc = await prisma.document.create({
    data: {
      firmId: FIRM_TEM,
      clientId: CLIENT_TEM,
      category: "ACUSE",
      status: "READY",
      uploadOrigin: "FIRM",
    },
  });
  return doc.id;
}

/** Crea vouchers SALE aprobados con líneas (activityCode + netAmount). */
async function createApprovedVouchersWithLines() {
  const v1 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_TEM,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 400,
    issuerCuit: "20999999995",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-10",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  await prisma.fiscalVoucherLine.create({
    data: {
      firmId: FIRM_TEM,
      clientId: CLIENT_TEM,
      voucherId: v1.id,
      position: 1,
      activityCode: "COMERCIO",
      netAmount: new Prisma.Decimal("100000"),
    },
  });

  const v2 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_TEM,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 401,
    issuerCuit: "20999999995",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-15",
    total: "60500.00",
    components: [
      { concept: "NETO", base: "50000.00", amount: "50000.00" },
      { concept: "IVA_21", base: "50000.00", rate: "0.21", amount: "10500.00" },
    ],
  });
  await prisma.fiscalVoucherLine.create({
    data: {
      firmId: FIRM_TEM,
      clientId: CLIENT_TEM,
      voucherId: v2.id,
      position: 1,
      activityCode: "SERVICIOS",
      netAmount: new Prisma.Decimal("50000"),
    },
  });

  for (const v of [v1, v2]) {
    await ingestion.reviewVoucher(ctxReviewer, v.id, true);
  }
  return { v1, v2 };
}

function calculateParams() {
  return {
    clientId: CLIENT_TEM,
    taxTypeId,
    regimeId,
    jurisdictionId,
    periodId,
    cutoff: "2026-01-31",
  };
}

async function cleanupTEM() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_TEM}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_TEM}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_movements WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_lots WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_voucher_lines WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_components WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_vouchers WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_TEM}'`);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_minimum_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'TEM_SMT_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'TEM_SMT_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'TEM_SMT_%')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE code LIKE 'TEM_SMT_%'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-TEM'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-TEM'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-TEM'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-TEM'`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupTEM();
  const fx = await setupMasters();
  const rules = await setupActiveRules(fx);
  const { period, obligation } = await setupSettlementContext(fx);
  jurisdictionId = fx.smt.id;
  taxTypeId = fx.tem.id;
  regimeId = fx.regime.id;
  periodId = period.id;
  obligationId = obligation.id;
  ruleVersionId = rules.version.id;
});

describe("Fase 4.2 — TEM San Miguel de Tucumán: cálculo", () => {
  it("calcula TEM: 2 ventas (COMERCIO 100k + SERVICIOS 50k) → impuesto 2000 + 1500 = 3500", async () => {
    await createApprovedVouchersWithLines();
    const result = await settlements.calculate(ctxOwner, calculateParams());
    const s = result.settlement;
    expect(s.status).toBe("CALCULATED");
    expect(s.engineVersion).toBe("ar-tem-smt-v1.1.0");
    expect(s.ruleVersionId).toBeTruthy();
    const totals = s.totals as Record<string, string>;
    expect(totals["BASE_TOTAL"]).toBe("150000.00");
    // COMERCIO: 100000 × 2% = 2000; SERVICIOS: 50000 × 3% = 1500
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("3500.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("3500.00");
  });

  it("aplica mínimo si el cálculo por alícuota es menor", async () => {
    // Solo 1 venta chica: 10000 × 2% = 200 < mínimo 3000
    const v = await ingestion.createVoucher(ctxOwner, {
      clientId: CLIENT_TEM,
      direction: "SALE",
      type: "A",
      letter: "A",
      pointOfSale: 1,
      number: 500,
      issuerCuit: "20999999995",
      receiverCuit: "20111111111",
      issuedOn: "2026-01-10",
      total: "12100.00",
      components: [
        { concept: "NETO", base: "10000.00", amount: "10000.00" },
        { concept: "IVA_21", base: "10000.00", rate: "0.21", amount: "2100.00" },
      ],
    });
    await prisma.fiscalVoucherLine.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        voucherId: v.id,
        position: 1,
        activityCode: "COMERCIO",
        netAmount: new Prisma.Decimal("10000"),
      },
    });
    await ingestion.reviewVoucher(ctxReviewer, v.id, true);

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["MINIMO_APLICADO"]).toBe("3000.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("3000.00");
  });

  it("mapea el caso real documentado: 1,25% y mínimo mensual 61.446", async () => {
    await createApprovedVouchersWithLines();
    await prisma.taxRateRule.updateMany({
      where: { ruleVersionId, concept: { in: ["COMERCIO", "SERVICIOS"] } },
      data: { rate: new Prisma.Decimal("1.25") },
    });
    await prisma.taxMinimumRule.updateMany({
      where: { ruleVersionId, concept: "MINIMO" },
      data: { amount: new Prisma.Decimal("61446") },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("1875.00");
    expect(totals["MINIMO_APLICADO"]).toBe("61446.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("61446.00");
  });

  it("deduce retenciones y percepciones (créditos)", async () => {
    await createApprovedVouchersWithLines();
    await prisma.withholdingCertificate.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        direction: "SUFFERED",
        cuitAgent: "30111111111",
        cuitResponsible: "20999999995",
        concept: "RETENCION_TEM",
        base: new Prisma.Decimal("50000"),
        amount: new Prisma.Decimal("1000"),
        rate: new Prisma.Decimal("2"),
        issuedOn: new Date("2026-01-20"),
        status: "APPROVED",
      },
    });
    await prisma.perceptionCertificate.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        direction: "SUFFERED",
        cuitAgent: "30111111111",
        cuitResponsible: "20999999995",
        concept: "PERCEPCION_TEM",
        base: new Prisma.Decimal("30000"),
        amount: new Prisma.Decimal("600"),
        rate: new Prisma.Decimal("2"),
        issuedOn: new Date("2026-01-20"),
        status: "APPROVED",
      },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["RETENCIONES"]).toBe("1000.00");
    expect(totals["PERCEPCIONES"]).toBe("600.00");
    // 3500 - 1000 - 600 = 1900
    expect(totals["TOTAL_A_INGRESAR"]).toBe("1900.00");
  });

  it("aplica saldo a favor anterior", async () => {
    await createApprovedVouchersWithLines();
    await prisma.taxCreditLedgerEntry.create({
      data: {
        firmId: FIRM_TEM,
        clientId: CLIENT_TEM,
        taxTypeId,
        jurisdictionId,
        kind: "FREE_AVAILABILITY",
        amount: new Prisma.Decimal("4000"),
        balanceAfter: new Prisma.Decimal("4000"),
        createdByUserId: OWNER_TEM,
      },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["SALDO_ANTERIOR"]).toBe("4000.00");
    // 3500 - 4000 = -500 → saldo a favor
    expect(totals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(totals["SALDO_A_FAVOR"]).toBe("500.00");
  });

  it("V-004: reejecutar produce mismo hash", async () => {
    await createApprovedVouchersWithLines();
    const a = await settlements.calculate(ctxOwner, calculateParams());
    const b = await settlements.calculate(ctxOwner, calculateParams());
    expect(a.settlement.inputHash).toBe(b.settlement.inputHash);
    expect(a.settlement.outputHash).toBe(b.settlement.outputHash);
  });

  it("hecho fuera del cutoff no afecta el resultado", async () => {
    await createApprovedVouchersWithLines();
    // cutoff 11-01: solo la venta del 10-01 (COMERCIO 100k) entra
    const result = await settlements.calculate(ctxOwner, {
      ...calculateParams(),
      cutoff: "2026-01-11",
    });
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["BASE_TOTAL"]).toBe("100000.00");
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("2000.00");
  });
});

describe("Fase 4.2 — TEM San Miguel de Tucumán: workflow maker-checker", () => {
  it("submit → review → finalize con revisor distinto", async () => {
    await createApprovedVouchersWithLines();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());

    await settlements.submitReview(ctxPreparer, settlement.id);
    const inReview = await settlements.review(ctxReviewer, settlement.id);
    expect(inReview.status).toBe("REVIEWED");

    const finalized = await settlements.finalize(ctxReviewer, settlement.id);
    expect(finalized.status).toBe("FINALIZED");
  });

  it("preparador no puede finalizar su propia liquidación", async () => {
    await createApprovedVouchersWithLines();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await expect(settlements.finalize(ctxPreparer, settlement.id)).rejects.toThrow(SettlementError);
  });

  it("finalizada es inmutable (V-003)", async () => {
    await createApprovedVouchersWithLines();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    await expect(settlements.calculate(ctxOwner, calculateParams())).rejects.toThrow(SettlementError);
    const db = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(db?.status).toBe("FINALIZED");
  });

  it("rectifica creando versión nueva", async () => {
    await createApprovedVouchersWithLines();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    const rectified = await settlements.rectify(ctxPreparer, settlement.id, "Cambio de actividad");
    expect(rectified.status).toBe("DRAFT");
    expect(rectified.version).toBe(2);
    expect(rectified.supersedesId).toBe(settlement.id);
  });
});

describe("Fase 4.2 — TEM San Miguel de Tucumán: presentación y pago", () => {
  it("presenta y paga la liquidación finalizada", async () => {
    await createApprovedVouchersWithLines();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    const filing = await settlements.recordFiling(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      filedAt: "2026-02-05",
      amountFiled: "3500.00",
      externalId: "TEM-001",
      evidenceDocumentId: await createEvidenceDocument(),
    });
    expect(filing.status).toBe("FILED");

    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-02-10",
      amount: "3500.00",
      method: "TRANSFERENCIA",
    });
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("PAID");
  });
});

/**
 * P2 4a-ii (C5/C9): con reglas tipadas TEM resuelve la actividad por id y su
 * mínimo desde la regla. El resultado debe ser el mismo golden que el modo
 * legacy, con etiquetas de concepto distintas.
 */
describe("Fase 4.2 — TEM con reglas tipadas", () => {
  it("conserva el golden legacy y resuelve actividad/mínimo por catálogo", async () => {
    await createApprovedVouchersWithLines();
    const legacy = await settlements.calculate(ctxOwner, calculateParams());
    const legacyTotals = legacy.settlement.totals as Record<string, string>;

    const family = await prisma.calcFamily.findUniqueOrThrow({ where: { key: "TEM" } });
    const kind = await prisma.taxRuleKind.findUniqueOrThrow({ where: { key: "RATE" } });
    const activityByCode = new Map<string, string>();
    for (const code of ["COMERCIO", "SERVICIOS"]) {
      const activity = await prisma.economicActivity.upsert({
        where: { code_jurisdictionId: { code, jurisdictionId } },
        update: {},
        create: {
          code,
          name: `Actividad ${code}`,
          jurisdictionId,
          validFrom: new Date("2020-01-01"),
        },
      });
      activityByCode.set(code, activity.id);
    }
    await prisma.taxRegime.update({
      where: { id: regimeId },
      data: { calcFamilyId: family.id },
    });
    const rules = await prisma.taxRateRule.findMany({ where: { ruleVersionId } });
    for (const rule of rules) {
      const isDefault = rule.concept === "DEFAULT";
      await prisma.taxRateRule.update({
        where: { id: rule.id },
        data: {
          concept: isDefault ? "ALICUOTA_GENERAL" : `ALICUOTA_${rule.concept}`,
          kindId: kind.id,
          activityId: isDefault ? null : activityByCode.get(rule.concept) ?? null,
          isDefault,
        },
      });
    }
    const version = await prisma.taxRuleVersion.findUniqueOrThrow({
      where: { id: ruleVersionId },
      include: {
        rateRules: { include: { kind: true } },
        minimumRules: true,
        bracketRules: true,
        dueDateRules: true,
        roundingRules: true,
      },
    });
    await prisma.taxRuleVersion.update({
      where: { id: ruleVersionId },
      data: { rulesHashSchemaVersion: 3, rulesHash: computeRulesHashV3(version) },
    });

    const typed = await settlements.calculate(ctxOwner, calculateParams());
    const typedTotals = typed.settlement.totals as Record<string, string>;
    expect(typedTotals).toMatchObject(legacyTotals);
    expect(typedTotals["IMPUESTO_POR_ACTIVIDAD"]).toBe("3500.00");
    expect(typedTotals["TOTAL_A_INGRESAR"]).toBe("3500.00");
    expect(typed.result.blocks).toHaveLength(0);
  });
});
