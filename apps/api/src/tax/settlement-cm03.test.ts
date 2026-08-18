import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService } from "./ingestion-service.js";
import { SettlementService, SettlementError } from "./settlement-service.js";

/**
 * Tests de integración CM03 artículo 2 (Puerta 4, Fase 4.3).
 *
 * Verifica:
 * - Dispatch por engineVersion (CM03_ENGINE_VERSION).
 * - Base país por actividad + coeficientes por jurisdicción (suma = 1).
 * - Distribución por jurisdicción y alícuota.
 * - Créditos imputados a la jurisdicción principal.
 * - Workflow maker-checker (mismo que IVA/IIBB/TEM, reutilizado).
 * - V-004: determinismo (mismo input → mismo hash).
 */

const OWNER_CM = "11111111-1111-4111-8111-888888888888";
const REVIEWER_CM = "22222222-2222-4222-8222-999999999999";
const PREPARER_CM = "33333333-3333-4333-8333-aaaaaaaaaaaa";
const FIRM_CM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_CM = "44444444-5555-4666-8777-123456789012";

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

const ctxOwner = { userId: OWNER_CM, firmId: FIRM_CM, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_CM, firmId: FIRM_CM, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_CM, firmId: FIRM_CM, actorKind: "USER" as const };

let taxTypeId = "";
let regimeId = "";
let jurisdictionId = "";
let periodId = "";
let obligationId = "";

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_CM, "owner.cm@test.local", "Owner CM"],
    [REVIEWER_CM, "reviewer.cm@test.local", "Reviewer CM"],
    [PREPARER_CM, "preparer.cm@test.local", "Preparer CM"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_CM}', 'Estudio CM', 'Estudio CM', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_CM}', '${FIRM_CM}', 'Cliente CM', '20999999994', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  for (const [userId, role] of [
    [OWNER_CM, "OWNER"],
    [REVIEWER_CM, "REVIEWER"],
    [PREPARER_CM, "PREPARER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_CM}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  for (const userId of [REVIEWER_CM, PREPARER_CM]) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
      VALUES (gen_random_uuid()::text, '${FIRM_CM}', '${CLIENT_CM}', '${userId}')
      ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
    `);
  }
}

async function setupMasters() {
  return runAsRuntime(OWNER_CM, FIRM_CM, async (tx) => {
    const nacion = await tx.jurisdiction.upsert({
      where: { code: "AR-CM" },
      update: {},
      create: { code: "AR-CM", name: "Nación CM", kind: "NATIONAL" },
    });
    const arca = await tx.taxAuthority.upsert({
      where: { code: "ARCA-CM" },
      update: {},
      create: { code: "ARCA-CM", name: "ARCA CM", jurisdictionId: nacion.id },
    });
    const iibb = await tx.taxType.upsert({
      where: { code: "IIBB-CM" },
      update: {},
      create: { code: "IIBB-CM", name: "IIBB CM" },
    });
    const regime = await tx.taxRegime.upsert({
      where: { code: "CM_ART2-CM" },
      update: {},
      create: {
        code: "CM_ART2-CM",
        name: "CM03 Art2 Test",
        taxTypeId: iibb.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
      },
    });
    return { nacion, arca, iibb, regime };
  });
}

async function setupActiveRules(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_CM, FIRM_CM, async (tx) => {
    const pack = await tx.taxRulePack.create({
      data: { code: "CM03_TEST_V1", name: "CM03 Test V1", regimeId: fx.regime.id },
    });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-iibb-cm-art2-v1.0.0",
        rulesHash: "sha256:cm03-test",
      },
    });
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "TUC", rate: new Prisma.Decimal("4"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "CBA", rate: new Prisma.Decimal("3.5"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "COEF_TUC", rate: new Prisma.Decimal("0.6"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "COEF_CBA", rate: new Prisma.Decimal("0.4"), validFrom: new Date("2026-01-01") },
      ],
    });
    return { pack, version };
  });
}

async function setupSettlementContext(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_CM, FIRM_CM, async (tx) => {
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_CM,
        clientId: CLIENT_CM,
        version: 1,
        legalName: "Cliente CM SA",
        cuit: "20999999994",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_CM,
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_CM,
        clientId: CLIENT_CM,
        taxTypeId: fx.iibb.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    await tx.taxRegistration.create({
      data: {
        firmId: FIRM_CM,
        clientId: CLIENT_CM,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });
    const obligation = await tx.taxObligation.create({
      data: {
        firmId: FIRM_CM,
        clientId: CLIENT_CM,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_CM,
      },
    });
    return { profile, period, obligation };
  });
}

/** Crea vouchers SALE aprobados con líneas (activityCode + netAmount). */
async function createApprovedVouchersWithLines() {
  const v1 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_CM,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 600,
    issuerCuit: "20999999994",
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
      firmId: FIRM_CM,
      clientId: CLIENT_CM,
      voucherId: v1.id,
      position: 1,
      activityCode: "COMERCIO",
      netAmount: new Prisma.Decimal("100000"),
    },
  });

  const v2 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_CM,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 601,
    issuerCuit: "20999999994",
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
      firmId: FIRM_CM,
      clientId: CLIENT_CM,
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
    clientId: CLIENT_CM,
    taxTypeId,
    regimeId,
    jurisdictionId,
    periodId,
    cutoff: "2026-01-31",
  };
}

async function cleanupCM() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_CM}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_CM}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_voucher_lines WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_components WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_vouchers WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_CM}'`);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'CM03_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'CM03_%')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE code LIKE 'CM03_%'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-CM'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-CM'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-CM'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-CM'`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupCM();
  const fx = await setupMasters();
  await setupActiveRules(fx);
  const { period, obligation } = await setupSettlementContext(fx);
  jurisdictionId = fx.nacion.id;
  taxTypeId = fx.iibb.id;
  regimeId = fx.regime.id;
  periodId = period.id;
  obligationId = obligation.id;
});

describe("Fase 4.3 — CM03 artículo 2: cálculo", () => {
  it("distribuye base país por coeficientes: TUC 90k×4% + CBA 60k×3.5% = 5700", async () => {
    await createApprovedVouchersWithLines();
    const result = await settlements.calculate(ctxOwner, calculateParams());
    const s = result.settlement;
    expect(s.status).toBe("CALCULATED");
    expect(s.engineVersion).toBe("ar-iibb-cm-art2-v1.0.0");
    const totals = s.totals as Record<string, string>;
    expect(totals["BASE_PAIS"]).toBe("150000.00");
    // TUC: 150000 × 0.6 = 90000 × 4% = 3600; CBA: 150000 × 0.4 = 60000 × 3.5% = 2100
    expect(totals["IMPUESTO_POR_JURISDICCION"]).toBe("5700.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("5700.00");
  });

  it("bloquea si los coeficientes no suman 1", async () => {
    // Reescribir coeficientes para que sumen 0.9 (inválido).
    await prisma.taxRateRule.updateMany({
      where: { concept: "COEF_CBA" },
      data: { rate: new Prisma.Decimal("0.3") },
    });
    await createApprovedVouchersWithLines();
    const result = await settlements.calculate(ctxOwner, calculateParams());
    expect(result.result.blocks).toContain("La suma de coeficientes es 0.9; debe ser 1");
  });

  it("deduce retenciones y percepciones de la jurisdicción principal", async () => {
    await createApprovedVouchersWithLines();
    await prisma.withholdingCertificate.create({
      data: {
        firmId: FIRM_CM,
        clientId: CLIENT_CM,
        direction: "SUFFERED",
        cuitAgent: "30111111111",
        cuitResponsible: "20999999994",
        concept: "RETENCION_IIBB",
        base: new Prisma.Decimal("50000"),
        amount: new Prisma.Decimal("2000"),
        rate: new Prisma.Decimal("4"),
        issuedOn: new Date("2026-01-20"),
        status: "APPROVED",
      },
    });
    await prisma.perceptionCertificate.create({
      data: {
        firmId: FIRM_CM,
        clientId: CLIENT_CM,
        direction: "SUFFERED",
        cuitAgent: "30111111111",
        cuitResponsible: "20999999994",
        concept: "PERCEPCION_IIBB",
        base: new Prisma.Decimal("30000"),
        amount: new Prisma.Decimal("1200"),
        rate: new Prisma.Decimal("4"),
        issuedOn: new Date("2026-01-20"),
        status: "APPROVED",
      },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["RETENCIONES"]).toBe("2000.00");
    expect(totals["PERCEPCIONES"]).toBe("1200.00");
    // 5700 - 2000 - 1200 = 2500
    expect(totals["TOTAL_A_INGRESAR"]).toBe("2500.00");
  });

  it("aplica saldo a favor anterior", async () => {
    await createApprovedVouchersWithLines();
    await prisma.taxCreditLedgerEntry.create({
      data: {
        firmId: FIRM_CM,
        clientId: CLIENT_CM,
        taxTypeId,
        jurisdictionId,
        kind: "FREE_AVAILABILITY",
        amount: new Prisma.Decimal("6000"),
        balanceAfter: new Prisma.Decimal("6000"),
        createdByUserId: OWNER_CM,
      },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["SALDO_ANTERIOR"]).toBe("6000.00");
    // 5700 - 6000 = -300 → saldo a favor
    expect(totals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(totals["SALDO_A_FAVOR"]).toBe("300.00");
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
    expect(totals["BASE_PAIS"]).toBe("100000.00");
    // TUC: 100000 × 0.6 = 60000 × 4% = 2400; CBA: 100000 × 0.4 = 40000 × 3.5% = 1400
    expect(totals["IMPUESTO_POR_JURISDICCION"]).toBe("3800.00");
  });
});

describe("Fase 4.3 — CM03 artículo 2: workflow maker-checker", () => {
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

    const rectified = await settlements.rectify(ctxPreparer, settlement.id, "Cambio de coeficiente");
    expect(rectified.status).toBe("DRAFT");
    expect(rectified.version).toBe(2);
    expect(rectified.supersedesId).toBe(settlement.id);
  });
});

describe("Fase 4.3 — CM03 artículo 2: presentación y pago", () => {
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
      amountFiled: "5700.00",
      externalId: "CM-001",
    });
    expect(filing.status).toBe("FILED");

    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-02-10",
      amount: "5700.00",
      method: "TRANSFERENCIA",
    });
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("PAID");
  });
});
