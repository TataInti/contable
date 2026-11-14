import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService } from "./ingestion-service.js";
import { SettlementService, SettlementError } from "./settlement-service.js";
import { computeRulesHashV3 } from "./rules-hash.js";

/**
 * Tests de integración IIBB Tucumán local (Puerta 4, Fase 4.1).
 *
 * Verifica:
 * - Dispatch por engineVersion (IIBB_TUC_ENGINE_VERSION).
 * - Ingresos por actividad desde FiscalVoucherLine.
 * - Mínimo, créditos RPI, saldo anterior.
 * - Workflow maker-checker (mismo que IVA, reutilizado).
 * - V-004: determinismo (mismo input → mismo hash).
 */

const OWNER_IIBB = "11111111-1111-4111-8111-222222222222";
const REVIEWER_IIBB = "22222222-2222-4222-8222-333333333333";
const PREPARER_IIBB = "33333333-3333-4333-8333-444444444444";
const FIRM_IIBB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT_IIBB = "22222222-3333-4444-8555-123456789012";

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

const ctxOwner = { userId: OWNER_IIBB, firmId: FIRM_IIBB, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_IIBB, firmId: FIRM_IIBB, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_IIBB, firmId: FIRM_IIBB, actorKind: "USER" as const };

let taxTypeId = "";
let regimeId = "";
let jurisdictionId = "";
let periodId = "";
let obligationId = "";
let ruleVersionId = "";

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_IIBB, "owner.iibb@test.local", "Owner IIBB"],
    [REVIEWER_IIBB, "reviewer.iibb@test.local", "Reviewer IIBB"],
    [PREPARER_IIBB, "preparer.iibb@test.local", "Preparer IIBB"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_IIBB}', 'Estudio IIBB', 'Estudio IIBB', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_IIBB}', '${FIRM_IIBB}', 'Cliente IIBB', '20999999996', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  for (const [userId, role] of [
    [OWNER_IIBB, "OWNER"],
    [REVIEWER_IIBB, "REVIEWER"],
    [PREPARER_IIBB, "PREPARER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_IIBB}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  for (const userId of [REVIEWER_IIBB, PREPARER_IIBB]) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
      VALUES (gen_random_uuid()::text, '${FIRM_IIBB}', '${CLIENT_IIBB}', '${userId}')
      ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
    `);
  }
}

async function setupMasters() {
  return runAsRuntime(OWNER_IIBB, FIRM_IIBB, async (tx) => {
    const tucuman = await tx.jurisdiction.upsert({
      where: { code: "AR-T" },
      update: {},
      create: { code: "AR-T", name: "Tucumán IIBB", kind: "PROVINCIAL" },
    });
    const dgr = await tx.taxAuthority.upsert({
      where: { code: "DGR-IIBB" },
      update: {},
      create: { code: "DGR-IIBB", name: "DGR IIBB", jurisdictionId: tucuman.id },
    });
    const iibb = await tx.taxType.upsert({
      where: { code: "IIBB" },
      update: {},
      create: { code: "IIBB", name: "IIBB Test" },
    });
    const regime = await tx.taxRegime.upsert({
      where: { code: "IIBB_LOCAL-IIBB" },
      update: {},
      create: {
        code: "IIBB_LOCAL-IIBB",
        name: "IIBB Local Test",
        taxTypeId: iibb.id,
        jurisdictionId: tucuman.id,
        authorityId: dgr.id,
      },
    });
    return { tucuman, dgr, iibb, regime };
  });
}

async function setupActiveRules(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_IIBB, FIRM_IIBB, async (tx) => {
    const pack = await tx.taxRulePack.create({
      data: { code: "IIBB_TUC_TEST_V1", name: "IIBB Tuc Test V1", regimeId: fx.regime.id },
    });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-iibb-tuc-local-v1.1.0",
        rulesHash: "sha256:iibb-test",
      },
    });
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "COMERCIO", rate: new Prisma.Decimal("4"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "SERVICIOS", rate: new Prisma.Decimal("4.5"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "DEFAULT", rate: new Prisma.Decimal("4"), validFrom: new Date("2026-01-01") },
      ],
    });
    await tx.taxMinimumRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "MINIMO", amount: new Prisma.Decimal("5000"), validFrom: new Date("2026-01-01") },
      ],
    });
    return { pack, version };
  });
}

async function enableTypedIibbRules() {
  const family = await prisma.calcFamily.findUniqueOrThrow({ where: { key: "IIBB_LOCAL" } });
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
  await prisma.taxRegime.update({ where: { id: regimeId }, data: { calcFamilyId: family.id } });
  const rules = await prisma.taxRateRule.findMany({ where: { ruleVersionId } });
  for (const rule of rules) {
    const isDefault = rule.concept === "DEFAULT";
    await prisma.taxRateRule.update({
      where: { id: rule.id },
      data: {
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
  const rulesHash = computeRulesHashV3(version);
  await prisma.taxRuleVersion.update({
    where: { id: ruleVersionId },
    data: { rulesHashSchemaVersion: 3, rulesHash },
  });
}

async function setupSettlementContext(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_IIBB, FIRM_IIBB, async (tx) => {
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        version: 1,
        legalName: "Cliente IIBB SA",
        cuit: "20999999996",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_IIBB,
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        taxTypeId: fx.iibb.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    await tx.taxRegistration.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });
    const obligation = await tx.taxObligation.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_IIBB,
      },
    });
    return { profile, period, obligation };
  });
}

/** Crea un documento de evidencia (acuse) para el cliente. */
async function createEvidenceDocument(): Promise<string> {
  const doc = await prisma.document.create({
    data: {
      firmId: FIRM_IIBB,
      clientId: CLIENT_IIBB,
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
    clientId: CLIENT_IIBB,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 200,
    issuerCuit: "20999999996",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-10",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  // Insertar línea manualmente (createVoucher no crea FiscalVoucherLine).
  await prisma.fiscalVoucherLine.create({
    data: {
      firmId: FIRM_IIBB,
      clientId: CLIENT_IIBB,
      voucherId: v1.id,
      position: 1,
      activityCode: "COMERCIO",
      netAmount: new Prisma.Decimal("100000"),
    },
  });

  const v2 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_IIBB,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 201,
    issuerCuit: "20999999996",
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
      firmId: FIRM_IIBB,
      clientId: CLIENT_IIBB,
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
    clientId: CLIENT_IIBB,
    taxTypeId,
    regimeId,
    jurisdictionId,
    periodId,
    cutoff: "2026-01-31",
  };
}

async function cleanupIIBB() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_IIBB}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_IIBB}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_movements WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_lots WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM import_rows WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_batches WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_adjustments WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_voucher_lines WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_components WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_vouchers WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_IIBB}'`);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_minimum_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'IIBB_TUC_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'IIBB_TUC_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'IIBB_TUC_%')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE code LIKE 'IIBB_TUC_%'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-IIBB'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-IIBB'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-IIBB'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-IIBB'`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupIIBB();
  const fx = await setupMasters();
  const rules = await setupActiveRules(fx);
  const { period, obligation } = await setupSettlementContext(fx);
  jurisdictionId = fx.tucuman.id;
  taxTypeId = fx.iibb.id;
  regimeId = fx.regime.id;
  periodId = period.id;
  obligationId = obligation.id;
  ruleVersionId = rules.version.id;
});

describe("Fase 4.1 — IIBB Tucumán local: cálculo", () => {
  it("calcula IIBB: 2 ventas (COMERCIO 100k + SERVICIOS 50k) → impuesto 4000 + 2250 = 6250", async () => {
    await createApprovedVouchersWithLines();
    const result = await settlements.calculate(ctxOwner, calculateParams());
    const s = result.settlement;
    expect(s.status).toBe("CALCULATED");
    expect(s.engineVersion).toBe("ar-iibb-tuc-local-v1.1.0");
    expect(s.ruleVersionId).toBeTruthy();
    const totals = s.totals as Record<string, string>;
    expect(totals["BASE_TOTAL"]).toBe("150000.00");
    // COMERCIO: 100000 × 4% = 4000; SERVICIOS: 50000 × 4.5% = 2250
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("6250.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("6250.00");
  });

  it("resuelve actividad por id en reglas v3 y bloquea un código sin catálogo único", async () => {
    await enableTypedIibbRules();
    const { v1 } = await createApprovedVouchersWithLines();
    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("6250.00");

    await prisma.fiscalVoucherLine.updateMany({
      where: { voucherId: v1.id },
      data: { activityCode: "ACTIVITY_NOT_IN_CATALOG" },
    });
    await expect(settlements.calculate(ctxOwner, calculateParams())).rejects.toMatchObject({
      code: "ACTIVITY_RULE_UNRESOLVED",
    });
  });

  it("aplica mínimo si el cálculo por alícuota es menor", async () => {
    // Solo 1 venta chica: 10000 × 4% = 400 < mínimo 5000
    const v = await ingestion.createVoucher(ctxOwner, {
      clientId: CLIENT_IIBB,
      direction: "SALE",
      type: "A",
      letter: "A",
      pointOfSale: 1,
      number: 300,
      issuerCuit: "20999999996",
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
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        voucherId: v.id,
        position: 1,
        activityCode: "COMERCIO",
        netAmount: new Prisma.Decimal("10000"),
      },
    });
    await ingestion.reviewVoucher(ctxReviewer, v.id, true);

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["MINIMO_APLICADO"]).toBe("5000.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("5000.00");
  });

  it("deduce retenciones y percepciones (créditos RPI)", async () => {
    await createApprovedVouchersWithLines();
    // Insertar retención y percepción
    await prisma.withholdingCertificate.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        direction: "SUFFERED",
        cuitAgent: "30111111111",
        cuitResponsible: "20999999996",
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
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        direction: "SUFFERED",
        cuitAgent: "30111111111",
        cuitResponsible: "20999999996",
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
    // 6250 - 2000 - 1200 = 3050
    expect(totals["TOTAL_A_INGRESAR"]).toBe("3050.00");
  });

  it("aplica saldo a favor anterior", async () => {
    await createApprovedVouchersWithLines();
    await prisma.taxCreditLedgerEntry.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        taxTypeId,
        jurisdictionId,
        kind: "FREE_AVAILABILITY",
        amount: new Prisma.Decimal("7000"),
        balanceAfter: new Prisma.Decimal("7000"),
        createdByUserId: OWNER_IIBB,
      },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["SALDO_ANTERIOR"]).toBe("7000.00");
    // 6250 - 7000 = -750 → saldo a favor
    expect(totals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(totals["SALDO_A_FAVOR"]).toBe("750.00");
  });

  it("normaliza alícuotas sub-1% como puntos porcentuales", async () => {
    await createApprovedVouchersWithLines();
    await prisma.taxMinimumRule.deleteMany({ where: { ruleVersionId } });
    await prisma.taxRateRule.updateMany({
      where: { ruleVersionId, concept: "COMERCIO" },
      data: { rate: new Prisma.Decimal("0.75") },
    });
    await prisma.taxRateRule.updateMany({
      where: { ruleVersionId, concept: "SERVICIOS" },
      data: { rate: new Prisma.Decimal("1") },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    // 100000 × 0,75% + 50000 × 1%.
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("1250.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("1250.00");
  });

  it("aplica el mínimo configurado por actividad", async () => {
    await createApprovedVouchersWithLines();
    await prisma.taxMinimumRule.deleteMany({ where: { ruleVersionId } });
    await prisma.taxRateRule.updateMany({
      where: { ruleVersionId, concept: "COMERCIO" },
      data: { minAmount: new Prisma.Decimal("7000") },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("6250.00");
    expect(totals["IMPUESTO_DETERMINADO"]).toBe("9250.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("9250.00");
  });

  it("separa SIRCREB/recaudaciones bancarias de las retenciones comunes", async () => {
    await createApprovedVouchersWithLines();
    await prisma.withholdingCertificate.createMany({
      data: [
        {
          firmId: FIRM_IIBB,
          clientId: CLIENT_IIBB,
          cuitAgent: "30111111111",
          cuitResponsible: "20999999996",
          concept: "RETENCION_IIBB",
          base: new Prisma.Decimal("10000"),
          amount: new Prisma.Decimal("500"),
          issuedOn: new Date("2026-01-20"),
          status: "APPROVED",
        },
        {
          firmId: FIRM_IIBB,
          clientId: CLIENT_IIBB,
          cuitAgent: "30222222222",
          cuitResponsible: "20999999996",
          concept: "SIRCREB",
          creditKind: "BANK_COLLECTION",
          base: new Prisma.Decimal("20000"),
          amount: new Prisma.Decimal("1000"),
          issuedOn: new Date("2026-01-21"),
          status: "APPROVED",
        },
      ],
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["RETENCIONES"]).toBe("500.00");
    expect(totals["RECAUDACIONES"]).toBe("1000.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("4750.00");
  });

  it("aplica otros créditos por catálogo sólo cuando pertenecen al período", async () => {
    await createApprovedVouchersWithLines();
    const futurePeriod = await prisma.taxPeriod.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        taxTypeId,
        startDate: new Date("2026-02-01"),
        endDate: new Date("2026-02-28"),
        label: "Febrero 2026",
      },
    });
    const otherCreditConcept = await prisma.adjustmentConcept.findUniqueOrThrow({
      where: { key: "IIBB_OTRO_CREDITO" },
    });
    await prisma.taxAdjustment.createMany({
      data: [
        {
          firmId: FIRM_IIBB,
          clientId: CLIENT_IIBB,
          periodId,
          conceptId: otherCreditConcept.id,
          concept: "TEXTO_RENOMBRADO_DE_PRUEBA",
          amount: new Prisma.Decimal("300"),
          reason: "Crédito fiscal revisado de enero",
          createdByUserId: OWNER_IIBB,
          reviewedByUserId: REVIEWER_IIBB,
          reviewedAt: new Date("2026-01-31"),
        },
        {
          firmId: FIRM_IIBB,
          clientId: CLIENT_IIBB,
          periodId,
          concept: "CONCEPTO_DESCONOCIDO",
          amount: new Prisma.Decimal("700"),
          reason: "Ajuste con texto que no está en el catálogo",
          createdByUserId: OWNER_IIBB,
          reviewedByUserId: REVIEWER_IIBB,
          reviewedAt: new Date("2026-01-31"),
        },
        {
          firmId: FIRM_IIBB,
          clientId: CLIENT_IIBB,
          periodId: futurePeriod.id,
          conceptId: otherCreditConcept.id,
          concept: "IIBB_OTRO_CREDITO",
          amount: new Prisma.Decimal("1000"),
          reason: "Crédito fiscal de febrero",
          createdByUserId: OWNER_IIBB,
          reviewedByUserId: REVIEWER_IIBB,
          reviewedAt: new Date("2026-02-28"),
        },
      ],
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["OTROS_CREDITOS"]).toBe("300.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("5950.00");
    expect(result.inputs.filter((item) => item.kind === "ADJUSTMENT")).toHaveLength(1);
  });

  it("bloquea una alícuota declarada por DGR que difiere del rule pack", async () => {
    const { v1 } = await createApprovedVouchersWithLines();
    const batch = await prisma.importBatch.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        origin: "DGR_IIBB",
        taxTypeId,
        periodId,
        adapterVersion: "DGR_IIBB_V1",
        fileHash: "declared-rate-mismatch",
        status: "COMMITTED",
      },
    });
    await prisma.importRow.create({
      data: {
        firmId: FIRM_IIBB,
        clientId: CLIENT_IIBB,
        batchId: batch.id,
        position: 0,
        raw: {},
        normalized: {
          activityCode: "COMERCIO",
          income: "100000.0000",
          rate: "5.000000",
          minimum: null,
          exemption: "0.0000",
        },
        status: "COMMITTED",
        voucherId: v1.id,
        sourceType: "FISCAL_VOUCHER",
        sourceId: v1.id,
      },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    expect(result.result.blocks.some((block) => block.includes("no coincide"))).toBe(true);
    const differences = await settlements.listDifferences(ctxOwner, result.settlement.id);
    expect(differences.some((difference) => difference.severity === "BLOCKING")).toBe(true);
  });

  it("usa la versión retirada que cubre el período en vez de una activa futura", async () => {
    await createApprovedVouchersWithLines();
    const pack = await prisma.taxRulePack.findFirstOrThrow({
      where: { code: "IIBB_TUC_TEST_V1" },
    });
    await prisma.taxRuleVersion.updateMany({
      where: { packId: pack.id, status: "ACTIVE" },
      data: { status: "RETIRED" },
    });
    const future = await prisma.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 2,
        status: "ACTIVE",
        validFrom: new Date("2026-07-01"),
        engineVersion: "ar-iibb-tuc-local-v1.1.0",
        rulesHash: "sha256:iibb-future",
      },
    });
    await prisma.taxRateRule.create({
      data: {
        ruleVersionId: future.id,
        concept: "DEFAULT",
        rate: new Prisma.Decimal("9"),
        validFrom: new Date("2026-07-01"),
      },
    });

    const result = await settlements.calculate(ctxOwner, calculateParams());
    expect(result.settlement.rulesHash).toBe("sha256:iibb-test");
    expect((result.settlement.totals as Record<string, string>)["TOTAL_A_INGRESAR"]).toBe(
      "6250.00",
    );
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
    expect(totals["IMPUESTO_POR_ACTIVIDAD"]).toBe("4000.00");
  });
});

describe("Fase 4.1 — IIBB Tucumán local: workflow maker-checker", () => {
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

describe("Fase 4.1 — IIBB Tucumán local: presentación y pago", () => {
  it("presenta y paga la liquidación finalizada", async () => {
    await createApprovedVouchersWithLines();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    // Finalizada y sin presentación: figura entre las constancias que faltan en el estudio.
    const pendingBefore = await settlements.pendingFilingReceipts(ctxOwner);
    expect(pendingBefore.map((item) => item.settlementId)).toContain(settlement.id);

    const filing = await settlements.recordFiling(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      filedAt: "2026-02-05",
      amountFiled: "6250.00",
      externalId: "IIBB-001",
      evidenceDocumentId: await createEvidenceDocument(),
    });
    expect(filing.status).toBe("FILED");

    // Con la presentación registrada (y su constancia) deja de figurar.
    const pendingAfter = await settlements.pendingFilingReceipts(ctxOwner);
    expect(pendingAfter.map((item) => item.settlementId)).not.toContain(settlement.id);

    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-02-10",
      amount: "6250.00",
      method: "TRANSFERENCIA",
    });
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("PAID");
  });
});
