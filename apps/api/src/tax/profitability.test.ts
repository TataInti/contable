import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService } from "./ingestion-service.js";
import { ProfitabilityService, ProfitabilityError } from "./profitability-service.js";

/**
 * Tests de integración de rentabilidad gerencial (Puerta 5).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 *
 * G5-01/02: DEVENGADO y CAJA separados.
 * G5-03: la gestión sin respaldo no reduce impuestos.
 * G5-04: los impuestos del período son costo; el IVA es posición informativa.
 * G5-05: publicación versionada e inmutable.
 *
 * Invariantes:
 * - Determinismo: mismo input → mismo hash.
 * - Publicar crea snapshot PUBLISHED; recalcular crea versión nueva.
 * - El portal sólo ve PUBLISHED.
 */

const OWNER_P5 = "11111111-1111-4111-8111-111111111111";
const REVIEWER_P5 = "22222222-2222-4222-8222-222222222222";
const PREPARER_P5 = "33333333-3333-4333-8333-333333333333";
const FIRM_P5 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT_P5 = "11111111-2222-4333-8444-209999999992";

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
const profitability = new ProfitabilityService();

const ctxOwner = { userId: OWNER_P5, firmId: FIRM_P5, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_P5, firmId: FIRM_P5, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_P5, firmId: FIRM_P5, actorKind: "USER" as const };

let taxTypeId = "";
let regimeId = "";
let jurisdictionId = "";
let periodId = "";

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_P5, "owner.p5@test.local", "Owner P5"],
    [REVIEWER_P5, "reviewer.p5@test.local", "Reviewer P5"],
    [PREPARER_P5, "preparer.p5@test.local", "Preparer P5"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_P5}', 'Estudio P5', 'Estudio P5', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_P5}', '${FIRM_P5}', 'Cliente P5', '20999999992', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  for (const [userId, role] of [
    [OWNER_P5, "OWNER"],
    [REVIEWER_P5, "REVIEWER"],
    [PREPARER_P5, "PREPARER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_P5}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  for (const userId of [REVIEWER_P5, PREPARER_P5]) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
      VALUES (gen_random_uuid()::text, '${FIRM_P5}', '${CLIENT_P5}', '${userId}')
      ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
    `);
  }
}

/** Maestros: nación, ARCA, IVA, RI (sufijo -P5). */
async function setupMasters() {
  return runAsRuntime(OWNER_P5, FIRM_P5, async (tx) => {
    const nacion = await tx.jurisdiction.upsert({
      where: { code: "AR-P5" },
      update: {},
      create: { code: "AR-P5", name: "Nación P5", kind: "NATIONAL" },
    });
    const arca = await tx.taxAuthority.upsert({
      where: { code: "ARCA-P5" },
      update: {},
      create: { code: "ARCA-P5", name: "ARCA P5", jurisdictionId: nacion.id },
    });
    const iva = await tx.taxType.upsert({
      where: { code: "IVA" },
      update: {},
      create: { code: "IVA", name: "IVA P5" },
    });
    const ri = await tx.taxRegime.upsert({
      where: { code: "RI-P5" },
      update: {},
      create: {
        code: "RI-P5",
        name: "RI P5",
        taxTypeId: iva.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
      },
    });
    return { nacion, arca, iva, ri };
  });
}

/** Rule pack ACTIVE con tasas IVA 21%. */
async function setupActiveRules(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_P5, FIRM_P5, async (tx) => {
    const pack = await tx.taxRulePack.create({
      data: { code: "PROP_P5_V1", name: "IVA P5 V1", regimeId: fx.ri.id },
    });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-vat-ri-v1.0.0",
        rulesHash: "sha256:p5rules",
      },
    });
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "VENTAS", rate: new Prisma.Decimal("21"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "COMPRAS", rate: new Prisma.Decimal("21"), validFrom: new Date("2026-01-01") },
      ],
    });
    return { pack, version };
  });
}

/** Perfil + período + obligación. */
async function setupContext(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_P5, FIRM_P5, async (tx) => {
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_P5,
        clientId: CLIENT_P5,
        version: 1,
        legalName: "Cliente P5 SA",
        cuit: "20999999992",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_P5,
      },
    });
    // Sólo se liquida a un cliente inscripto en el régimen.
    await tx.taxRegistration.create({
      data: {
        firmId: FIRM_P5,
        clientId: CLIENT_P5,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        validFrom: new Date("2026-01-01"),
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_P5,
        clientId: CLIENT_P5,
        taxTypeId: fx.iva.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    const obligation = await tx.taxObligation.create({
      data: {
        firmId: FIRM_P5,
        clientId: CLIENT_P5,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_P5,
      },
    });
    return { profile, period, obligation };
  });
}

/** Crea y aprueba vouchers: 2 ventas 100k + 1 compra 40k. */
async function createApprovedVouchers() {
  const v1 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_P5,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 100,
    issuerCuit: "20999999992",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-10",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  const v2 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_P5,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 101,
    issuerCuit: "20999999992",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-15",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  const v3 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_P5,
    direction: "PURCHASE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 50,
    issuerCuit: "20111111111",
    receiverCuit: "20999999992",
    issuedOn: "2026-01-12",
    total: "48400.00",
    components: [
      { concept: "NETO", base: "40000.00", amount: "40000.00" },
      { concept: "IVA_21", base: "40000.00", rate: "0.21", amount: "8400.00" },
    ],
  });
  for (const v of [v1, v2, v3]) {
    await ingestion.reviewVoucher(ctxReviewer, v.id, true);
  }
  return { v1, v2, v3 };
}

/** Crea un gasto gerencial aprobado. */
async function createManagementExpense(amount: string, hasFiscalSupport = false) {
  const expense = await prisma.managementExpense.create({
    data: {
      firmId: FIRM_P5,
      clientId: CLIENT_P5,
      description: "Gasto de gestión P5",
      amount: new Prisma.Decimal(amount),
      currency: "ARS",
      incurredOn: new Date("2026-01-15"),
      hasFiscalSupport,
      taxTreatment: hasFiscalSupport ? "MANAGEMENT_ONLY" : "MANAGEMENT_ONLY",
      status: "APPROVED",
      createdByUserId: OWNER_P5,
    },
  });
  return expense;
}

/** Finaliza una liquidación IVA del período (para impuestos). */
async function finalizeVatSettlement() {
  // La liquidación IVA se calcula con el servicio de settlements.
  const { SettlementService } = await import("./settlement-service.js");
  const settlements = new SettlementService();
  const s = await settlements.calculate(ctxPreparer, {
    clientId: CLIENT_P5,
    taxTypeId,
    regimeId,
    jurisdictionId,
    periodId,
    cutoff: "2026-01-31",
  });
  await settlements.submitReview(ctxPreparer, s.settlement.id);
  await settlements.review(ctxReviewer, s.settlement.id);
  await settlements.finalize(ctxReviewer, s.settlement.id);
  return s.settlement;
}

function defaultParams(basis: "DEVENGADO" | "CAJA" = "DEVENGADO") {
  return { clientId: CLIENT_P5, periodId, basis, cutoff: "2026-01-31" };
}

async function cleanupP5() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_P5}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_P5}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM profitability_snapshots WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM evidence_links WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_adjustments WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_treatment_decisions WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM expense_evidence WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM management_expenses WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_components WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_voucher_lines WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_vouchers WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_rows WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_batches WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM client_activities WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_P5}'`);
    await tx.$executeRawUnsafe(`
      DELETE FROM rule_approvals
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PROP_P5%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM normative_sources
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PROP_P5%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM due_date_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PROP_P5%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PROP_P5%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PROP_P5%')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE code LIKE 'PROP_P5%'`);
    await tx.$executeRawUnsafe(`DELETE FROM economic_activities WHERE code LIKE '%-P5'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-P5'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-P5'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-P5'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-P5'`);
    await tx.$executeRawUnsafe(`DELETE FROM holidays WHERE "jurisdictionId" IN (SELECT id FROM jurisdictions WHERE code LIKE '%-P5')`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupP5();
  const fx = await setupMasters();
  await setupActiveRules(fx);
  const { period } = await setupContext(fx);
  jurisdictionId = fx.nacion.id;
  taxTypeId = fx.iva.id;
  regimeId = fx.ri.id;
  periodId = period.id;
});

describe("G5-1 cálculo devengado", () => {
  it("ventas − gastos fiscales − gestión − impuestos = resultado post impuestos", async () => {
    await createApprovedVouchers();
    await createManagementExpense("50000.00");
    await finalizeVatSettlement();

    const { snapshot } = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const totals = snapshot.totals as Record<string, string>;
    expect(totals["VENTAS"]).toBe("200000.00");
    expect(totals["GASTO_FISCAL"]).toBe("40000.00");
    expect(totals["GASTO_GESTION"]).toBe("50000.00");
    expect(totals["RESULTADO_ANTES_IMPUESTOS"]).toBe("110000.00");
    // Impuestos del período: liquidación IVA finalizada (33.600) pagada.
    expect(totals["RESULTADO_POST_IMPUESTOS"]).toBe("76400.00");
  });

  it("G5-04: el IVA es posición informativa, no gasto económico", async () => {
    await createApprovedVouchers();
    await finalizeVatSettlement();
    const { snapshot } = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const totals = snapshot.totals as Record<string, string>;
    expect(totals["POSICION_IVA"]).toBe("33600.00");
    // El resultado NO incorpora el IVA como gasto (sólo pagos).
    expect(totals["RESULTADO_ANTES_IMPUESTOS"]).toBe("160000.00");
  });

  it("determinismo: mismo input → mismo hash", async () => {
    await createApprovedVouchers();
    const a = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const b = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    expect(a.snapshot.inputHash).toBe(b.snapshot.inputHash);
    expect(a.snapshot.outputHash).toBe(b.snapshot.outputHash);
    expect(a.snapshot.id).toBe(b.snapshot.id);
  });
});

describe("G5-2 vista caja", () => {
  it("flujo neto = cobros − pagos fiscales − gestión − impuestos (efecto IVA en el pago)", async () => {
    await createApprovedVouchers();
    await createManagementExpense("50000.00");
    const settlement = await finalizeVatSettlement();
    // Registra el pago de la liquidación IVA (33.600): su pago ES el efecto
    // de caja del IVA (no se duplica con la posición informativa).
    const { SettlementService } = await import("./settlement-service.js");
    const settlements = new SettlementService();
    const obligation = await prisma.taxObligation.findFirst({
      where: { firmId: FIRM_P5, clientId: CLIENT_P5, periodId },
    });
    await settlements.recordPayment(ctxOwner, {
      obligationId: obligation!.id,
      settlementId: settlement.id,
      paidAt: "2026-01-28",
      amount: "33600.00",
      method: "TRANSFERENCIA",
    });

    const { snapshot } = await profitability.calculate(ctxOwner, defaultParams("CAJA"));
    const totals = snapshot.totals as Record<string, string>;
    expect(totals["COBROS"]).toBe("200000.00");
    expect(totals["PAGOS_FISCALES"]).toBe("40000.00");
    expect(totals["PAGOS_GESTION"]).toBe("50000.00");
    // Impuestos pagados del período: la liquidación IVA finalizada (33.600)
    // se paga; su pago ES el efecto de caja del IVA (no se duplica).
    expect(totals["PAGOS_IMPUESTOS"]).toBe("33600.00");
    expect(totals["FLUJO_NETO"]).toBe("76400.00");
  });

  it("devengado y caja nunca se mezclan", async () => {
    await createApprovedVouchers();
    await finalizeVatSettlement();
    const dev = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const caja = await profitability.calculate(ctxOwner, defaultParams("CAJA"));
    expect(dev.snapshot.basis).toBe("DEVENGADO");
    expect(caja.snapshot.basis).toBe("CAJA");
    expect(dev.snapshot.id).not.toBe(caja.snapshot.id);
  });
});

describe("G5-3 gastos de gestión", () => {
  it("G5-03: gestión sin respaldo no reduce impuestos (va a GASTO_GESTION)", async () => {
    await createApprovedVouchers();
    await createManagementExpense("50000.00", false);
    const { snapshot } = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const totals = snapshot.totals as Record<string, string>;
    expect(totals["GASTO_GESTION"]).toBe("50000.00");
    expect(totals["GASTO_FISCAL"]).toBe("40000.00");
  });

  it("gasto con respaldo fiscal va a la columna fiscal", async () => {
    await createApprovedVouchers();
    await createManagementExpense("30000.00", true);
    const { snapshot } = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const totals = snapshot.totals as Record<string, string>;
    expect(totals["GASTO_FISCAL"]).toBe("70000.00");
    expect(totals["GASTO_GESTION"]).toBe("0.00");
  });
});

describe("G5-4 publicación versionada", () => {
  it("G5-05: publicar crea snapshot PUBLISHED inmutable", async () => {
    await createApprovedVouchers();
    await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const published = await profitability.publish(ctxOwner, {
      clientId: CLIENT_P5,
      periodId,
      basis: "DEVENGADO",
    });
    expect(published.status).toBe("PUBLISHED");
    expect(published.publishedById).toBe(OWNER_P5);
    expect(published.publishedAt).toBeTruthy();
  });

  it("publicar sin snapshot DRAFT falla", async () => {
    await expect(
      profitability.publish(ctxOwner, { clientId: CLIENT_P5, periodId, basis: "DEVENGADO" }),
    ).rejects.toThrow(ProfitabilityError);
  });

  it("recalcular tras publicar crea versión nueva y la anterior queda SUPERSEDED", async () => {
    await createApprovedVouchers();
    await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    const v1 = await profitability.publish(ctxOwner, {
      clientId: CLIENT_P5,
      periodId,
      basis: "DEVENGADO",
    });
    expect(v1.version).toBe(1);

    // Cambia una entrada (nuevo gasto) y recalcula → versión 2.
    await createManagementExpense("10000.00");
    const recalc = await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    expect(recalc.snapshot.version).toBe(2);
    expect(recalc.snapshot.status).toBe("DRAFT");

    const v2 = await profitability.publish(ctxOwner, {
      clientId: CLIENT_P5,
      periodId,
      basis: "DEVENGADO",
    });
    expect(v2.version).toBe(2);

    const history = await profitability.listForPeriod(ctxOwner, CLIENT_P5, periodId);
    const published = history.filter((s) => s.status === "PUBLISHED");
    const superseded = history.filter((s) => s.status === "SUPERSEDED");
    expect(published).toHaveLength(1);
    expect(published[0]?.version).toBe(2);
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.version).toBe(1);
  });

  it("el portal sólo ve PUBLISHED", async () => {
    await createApprovedVouchers();
    await profitability.calculate(ctxOwner, defaultParams("DEVENGADO"));
    // Sin publicar: el portal no ve nada.
    const before = await prisma.profitabilitySnapshot.findMany({
      where: { firmId: FIRM_P5, clientId: CLIENT_P5, status: "PUBLISHED" },
    });
    expect(before).toHaveLength(0);

    await profitability.publish(ctxOwner, { clientId: CLIENT_P5, periodId, basis: "DEVENGADO" });
    const after = await prisma.profitabilitySnapshot.findMany({
      where: { firmId: FIRM_P5, clientId: CLIENT_P5, status: "PUBLISHED" },
    });
    expect(after).toHaveLength(1);
  });
});