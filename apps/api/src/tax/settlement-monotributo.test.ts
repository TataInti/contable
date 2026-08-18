import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { SettlementService, SettlementError } from "./settlement-service.js";

/**
 * Tests de integración Monotributo (Puerta 4, Fase 4.4).
 *
 * Verifica:
 * - Dispatch por engineVersion (MONOTRIBUTO_ENGINE_VERSION).
 * - Categoría del perfil vigente (no la inventa el motor).
 * - Cuota por categoría desde reglas (CUOTA_<cat> en minAmount).
 * - Pagos del período se deducen de la cuota.
 * - Saldo a favor cuando el pago supera la cuota.
 * - Workflow maker-checker (mismo que IVA/IIBB/TEM/CM03, reutilizado).
 * - V-004: determinismo (mismo input → mismo hash).
 */

const OWNER_MONO = "11111111-1111-4111-8111-bbbbbbbbbbbb";
const REVIEWER_MONO = "22222222-2222-4222-8222-cccccccccccc";
const PREPARER_MONO = "33333333-3333-4333-8333-dddddddddddd";
const FIRM_MONO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CLIENT_MONO = "55555555-6666-4777-8888-123456789012";

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

const settlements = new SettlementService();

const ctxOwner = { userId: OWNER_MONO, firmId: FIRM_MONO, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_MONO, firmId: FIRM_MONO, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_MONO, firmId: FIRM_MONO, actorKind: "USER" as const };

let taxTypeId = "";
let regimeId = "";
let jurisdictionId = "";
let periodId = "";
let obligationId = "";

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_MONO, "owner.mono@test.local", "Owner Mono"],
    [REVIEWER_MONO, "reviewer.mono@test.local", "Reviewer Mono"],
    [PREPARER_MONO, "preparer.mono@test.local", "Preparer Mono"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_MONO}', 'Estudio Mono', 'Estudio Mono', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_MONO}', '${FIRM_MONO}', 'Cliente Mono', '20999999993', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  for (const [userId, role] of [
    [OWNER_MONO, "OWNER"],
    [REVIEWER_MONO, "REVIEWER"],
    [PREPARER_MONO, "PREPARER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_MONO}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  for (const userId of [REVIEWER_MONO, PREPARER_MONO]) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
      VALUES (gen_random_uuid()::text, '${FIRM_MONO}', '${CLIENT_MONO}', '${userId}')
      ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
    `);
  }
}

async function setupMasters() {
  return runAsRuntime(OWNER_MONO, FIRM_MONO, async (tx) => {
    const nacion = await tx.jurisdiction.upsert({
      where: { code: "AR-MONO" },
      update: {},
      create: { code: "AR-MONO", name: "Nación Mono", kind: "NATIONAL" },
    });
    const arca = await tx.taxAuthority.upsert({
      where: { code: "ARCA-MONO" },
      update: {},
      create: { code: "ARCA-MONO", name: "ARCA Mono", jurisdictionId: nacion.id },
    });
    const mono = await tx.taxType.upsert({
      where: { code: "MONO-MONO" },
      update: {},
      create: { code: "MONO-MONO", name: "Monotributo Test" },
    });
    const regime = await tx.taxRegime.upsert({
      where: { code: "MONOTRIBUTO-MONO" },
      update: {},
      create: {
        code: "MONOTRIBUTO-MONO",
        name: "Monotributo Test",
        taxTypeId: mono.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
      },
    });
    return { nacion, arca, mono, regime };
  });
}

async function setupActiveRules(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_MONO, FIRM_MONO, async (tx) => {
    const pack = await tx.taxRulePack.create({
      data: { code: "MONO_TEST_V1", name: "Mono Test V1", regimeId: fx.regime.id },
    });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-monotributo-v1.0.0",
        rulesHash: "sha256:mono-test",
      },
    });
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "CUOTA_A", minAmount: new Prisma.Decimal("25000"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "CUOTA_B", minAmount: new Prisma.Decimal("30000"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "CUOTA_C", minAmount: new Prisma.Decimal("35000"), validFrom: new Date("2026-01-01") },
      ],
    });
    return { pack, version };
  });
}

async function setupSettlementContext(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_MONO, FIRM_MONO, async (tx) => {
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_MONO,
        clientId: CLIENT_MONO,
        version: 1,
        legalName: "Cliente Mono SA",
        cuit: "20999999993",
        personType: "FISICA",
        nationalCondition: "MONOTRIBUTISTA",
        monotributoCategory: "B",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_MONO,
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_MONO,
        clientId: CLIENT_MONO,
        taxTypeId: fx.mono.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    await tx.taxRegistration.create({
      data: {
        firmId: FIRM_MONO,
        clientId: CLIENT_MONO,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });
    const obligation = await tx.taxObligation.create({
      data: {
        firmId: FIRM_MONO,
        clientId: CLIENT_MONO,
        profileVersionId: profile.id,
        regimeId: fx.regime.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_MONO,
      },
    });
    return { profile, period, obligation };
  });
}

function calculateParams() {
  return {
    clientId: CLIENT_MONO,
    taxTypeId,
    regimeId,
    jurisdictionId,
    periodId,
    cutoff: "2026-01-31",
  };
}

async function cleanupMono() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_MONO}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_MONO}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_MONO}'`);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'MONO_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'MONO_%')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE code LIKE 'MONO_%'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-MONO'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-MONO'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-MONO'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-MONO'`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupMono();
  const fx = await setupMasters();
  await setupActiveRules(fx);
  const { period, obligation } = await setupSettlementContext(fx);
  jurisdictionId = fx.nacion.id;
  taxTypeId = fx.mono.id;
  regimeId = fx.regime.id;
  periodId = period.id;
  obligationId = obligation.id;
});

describe("Fase 4.4 — Monotributo: cálculo", () => {
  it("calcula cuota de categoría B: 30000", async () => {
    const result = await settlements.calculate(ctxOwner, calculateParams());
    const s = result.settlement;
    expect(s.status).toBe("CALCULATED");
    expect(s.engineVersion).toBe("ar-monotributo-v1.0.0");
    const totals = s.totals as Record<string, string>;
    expect(totals["CATEGORIA"]).toBe("B");
    expect(totals["CUOTA_MENSUAL"]).toBe("30000.00");
    expect(totals["PAGOS"]).toBe("0.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("30000.00");
  });

  it("usa la categoría del perfil vigente (C → 35000)", async () => {
    await prisma.taxpayerProfileVersion.updateMany({
      where: { clientId: CLIENT_MONO },
      data: { monotributoCategory: "C" },
    });
    const result = await settlements.calculate(ctxOwner, calculateParams());
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["CATEGORIA"]).toBe("C");
    expect(totals["CUOTA_MENSUAL"]).toBe("35000.00");
  });

  it("deduce pagos del período de la cuota", async () => {
    const result = await settlements.calculate(ctxOwner, calculateParams());
    // Pago dentro del período (enero 2026).
    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: result.settlement.id,
      paidAt: "2026-01-15",
      amount: "10000.00",
      method: "DEBITO",
    });
    const recalculated = await settlements.calculate(ctxOwner, calculateParams());
    const totals = recalculated.settlement.totals as Record<string, string>;
    expect(totals["PAGOS"]).toBe("10000.00");
    // 30000 - 10000 = 20000
    expect(totals["TOTAL_A_INGRESAR"]).toBe("20000.00");
  });

  it("genera saldo a favor si el pago supera la cuota", async () => {
    const result = await settlements.calculate(ctxOwner, calculateParams());
    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: result.settlement.id,
      paidAt: "2026-01-20",
      amount: "35000.00",
      method: "DEBITO",
    });
    const recalculated = await settlements.calculate(ctxOwner, calculateParams());
    const totals = recalculated.settlement.totals as Record<string, string>;
    expect(totals["PAGOS"]).toBe("35000.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("0.00");
    expect(totals["SALDO_A_FAVOR"]).toBe("5000.00");
  });

  it("V-004: reejecutar produce mismo hash", async () => {
    const a = await settlements.calculate(ctxOwner, calculateParams());
    const b = await settlements.calculate(ctxOwner, calculateParams());
    expect(a.settlement.inputHash).toBe(b.settlement.inputHash);
    expect(a.settlement.outputHash).toBe(b.settlement.outputHash);
  });

  it("emite advertencia de recategorización pendiente (nunca automática)", async () => {
    const result = await settlements.calculate(ctxOwner, calculateParams());
    expect(result.result.warnings.some((w) => w.includes("recategorización"))).toBe(true);
  });
});

describe("Fase 4.4 — Monotributo: workflow maker-checker", () => {
  it("submit → review → finalize con revisor distinto", async () => {
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    const inReview = await settlements.review(ctxReviewer, settlement.id);
    expect(inReview.status).toBe("REVIEWED");
    const finalized = await settlements.finalize(ctxReviewer, settlement.id);
    expect(finalized.status).toBe("FINALIZED");
  });

  it("preparador no puede finalizar su propia liquidación", async () => {
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await expect(settlements.finalize(ctxPreparer, settlement.id)).rejects.toThrow(SettlementError);
  });

  it("finalizada es inmutable (V-003)", async () => {
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    await expect(settlements.calculate(ctxOwner, calculateParams())).rejects.toThrow(SettlementError);
    const db = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(db?.status).toBe("FINALIZED");
  });

  it("rectifica creando versión nueva", async () => {
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    const rectified = await settlements.rectify(ctxPreparer, settlement.id, "Cambio de categoría");
    expect(rectified.status).toBe("DRAFT");
    expect(rectified.version).toBe(2);
    expect(rectified.supersedesId).toBe(settlement.id);
  });
});

describe("Fase 4.4 — Monotributo: presentación y pago", () => {
  it("presenta y paga la cuota finalizada", async () => {
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    const filing = await settlements.recordFiling(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      filedAt: "2026-02-05",
      amountFiled: "30000.00",
      externalId: "MONO-001",
    });
    expect(filing.status).toBe("FILED");

    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-02-10",
      amount: "30000.00",
      method: "DEBITO",
    });
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("PAID");
  });
});
