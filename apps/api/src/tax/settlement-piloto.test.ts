import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService } from "./ingestion-service.js";
import { SettlementService, SettlementError } from "./settlement-service.js";
import { ProfitabilityService } from "./profitability-service.js";

/**
 * G6-04: ciclo piloto completo de punta a punta (PLAN §6, §12 Puerta 6).
 *
 * Simula el recorrido operativo de un cliente piloto RI:
 *   perfil → obligación → importación → voucher → cálculo → revisión →
 *   finalización → artifact → presentación → pago → rentabilidad publicada.
 *
 * Verifica que el flujo completo persiste cada paso y que los resultados
 * son reproducibles (V-004) e inmutables (V-003).
 */

// Firma y usuarios PROPIOS de la suite piloto (los tests corren en paralelo
// con la misma DB; compartir firma/usuarios con settlement.test causa
// deadlocks 40P01 y race conditions).
const OWNER_PIL = "44444444-4444-4444-8444-444444444444";
const REVIEWER_PIL = "55555555-5555-4555-8555-555555555555";
const PREPARER_PIL = "66666666-6666-4666-8666-666666666666";
const FIRM_PILOTO = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const CLIENT_PILOTO = "11111111-2222-4333-8444-000000000001";

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
// F0.3: storage stub para que el artifact no dependa de MinIO local.
const settlements = new SettlementService({
  put: async () => {},
} as unknown as ConstructorParameters<typeof SettlementService>[0]);
const profitability = new ProfitabilityService();

const ctxOwner = { userId: OWNER_PIL, firmId: FIRM_PILOTO, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_PIL, firmId: FIRM_PILOTO, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_PIL, firmId: FIRM_PILOTO, actorKind: "USER" as const };

let taxTypeId = "";
let regimeId = "";
let jurisdictionId = "";
let periodId = "";
let obligationId = "";

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_PIL, "owner.piloto@test.local", "Owner Piloto"],
    [REVIEWER_PIL, "reviewer.piloto@test.local", "Reviewer Piloto"],
    [PREPARER_PIL, "preparer.piloto@test.local", "Preparer Piloto"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_PILOTO}', 'Estudio Piloto', 'Estudio Piloto', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_PILOTO}', '${FIRM_PILOTO}', 'Cliente Piloto', '20999999990', now())
    ON CONFLICT ("id") DO UPDATE SET "firmId" = EXCLUDED."firmId", "legalName" = EXCLUDED."legalName", cuit = EXCLUDED.cuit, "updatedAt" = now()
  `);
  for (const [userId, role] of [
    [OWNER_PIL, "OWNER"],
    [REVIEWER_PIL, "REVIEWER"],
    [PREPARER_PIL, "PREPARER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_PILOTO}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  for (const userId of [REVIEWER_PIL, PREPARER_PIL]) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
      VALUES (gen_random_uuid()::text, '${FIRM_PILOTO}', '${CLIENT_PILOTO}', '${userId}')
      ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
    `);
  }
}

async function setupMasters() {
  return runAsRuntime(OWNER_PIL, FIRM_PILOTO, async (tx) => {
    const nacion = await tx.jurisdiction.upsert({
      where: { code: "AR-PIL" },
      update: {},
      create: { code: "AR-PIL", name: "Nación Piloto", kind: "NATIONAL" },
    });
    const arca = await tx.taxAuthority.upsert({
      where: { code: "ARCA-PIL" },
      update: {},
      create: { code: "ARCA-PIL", name: "ARCA Piloto", jurisdictionId: nacion.id },
    });
    const iva = await tx.taxType.upsert({
      where: { code: "IVA" },
      update: {},
      create: { code: "IVA", name: "IVA" },
    });
    const ri = await tx.taxRegime.upsert({
      where: { code: "RI-PIL" },
      update: {},
      create: {
        code: "RI-PIL",
        name: "RI Piloto",
        taxTypeId: iva.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
      },
    });
    return { nacion, arca, iva, ri };
  });
}

async function setupActiveRules(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_PIL, FIRM_PILOTO, async (tx) => {
    const pack = await tx.taxRulePack.create({
      data: { code: "PIL_VAT_V1", name: "IVA Piloto V1", regimeId: fx.ri.id },
    });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-vat-ri-v1.0.0",
        rulesHash: "sha256:pilrules",
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

async function setupSettlementContext(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_PIL, FIRM_PILOTO, async (tx) => {
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_PILOTO,
        clientId: CLIENT_PILOTO,
        version: 1,
        legalName: "Cliente Piloto SA",
        cuit: "20999999990",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_PIL,
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_PILOTO,
        clientId: CLIENT_PILOTO,
        taxTypeId: fx.iva.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    await tx.taxRegistration.create({
      data: {
        firmId: FIRM_PILOTO,
        clientId: CLIENT_PILOTO,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });
    const obligation = await tx.taxObligation.create({
      data: {
        firmId: FIRM_PILOTO,
        clientId: CLIENT_PILOTO,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_PIL,
      },
    });
    return { profile, period, obligation };
  });
}

/** Crea un documento de evidencia (acuse) para el cliente. */
async function createEvidenceDocument(): Promise<string> {
  const doc = await prisma.document.create({
    data: {
      firmId: FIRM_PILOTO,
      clientId: CLIENT_PILOTO,
      category: "ACUSE",
      status: "READY",
      uploadOrigin: "FIRM",
    },
  });
  return doc.id;
}

async function createApprovedVouchers() {
  const v1 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_PILOTO,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 100,
    issuerCuit: "20999999990",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-10",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  const v2 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_PILOTO,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 101,
    issuerCuit: "20999999990",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-15",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  const v3 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_PILOTO,
    direction: "PURCHASE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 50,
    issuerCuit: "20111111111",
    receiverCuit: "20999999990",
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

function defaultParams() {
  return {
    clientId: CLIENT_PILOTO,
    taxTypeId,
    regimeId,
    jurisdictionId,
    periodId,
    cutoff: "2026-01-31",
  };
}

async function approveSettlement(settlementId: string) {
  await settlements.submitReview(ctxPreparer, settlementId);
  await settlements.review(ctxReviewer, settlementId);
  await settlements.finalize(ctxReviewer, settlementId);
}

async function cleanupPiloto() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_PIL}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_PILOTO}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM profitability_snapshots WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_PILOTO}'`);
    // Datos huérfanos del régimen RI-PIL (cualquier clientId): una corrida
    // previa con otro clientId puede haber dejado settlements/obligations/
    // registrations que apuntan al régimen y bloquearían su borrado.
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_settlements
      WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code = 'RI-PIL')
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_obligations
      WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code = 'RI-PIL')
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_registrations
      WHERE "regimeId" IN (SELECT id FROM tax_regimes WHERE code = 'RI-PIL')
    `);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM evidence_links WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_adjustments WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_treatment_decisions WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM expense_evidence WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM management_expenses WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_components WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_voucher_lines WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_vouchers WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_rows WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_batches WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM client_activities WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_PILOTO}'`);
    await tx.$executeRawUnsafe(`
      DELETE FROM rule_approvals
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PIL_VAT%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM normative_sources
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PIL_VAT%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM due_date_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PIL_VAT%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PIL_VAT%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'PIL_VAT%')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE code LIKE 'PIL_VAT%'`);
    // Períodos huérfanos del tax type IVA-PIL (cualquier clientId) que
    // bloquearían el borrado del tax_type.
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_periods
      WHERE "taxTypeId" IN (SELECT id FROM tax_types WHERE code = 'IVA-PIL')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM economic_activities WHERE code LIKE '%-PIL'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-PIL'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-PIL'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-PIL'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-PIL'`);
    await tx.$executeRawUnsafe(`DELETE FROM holidays WHERE "jurisdictionId" IN (SELECT id FROM jurisdictions WHERE code LIKE '%-PIL')`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupPiloto();
  const fx = await setupMasters();
  await setupActiveRules(fx);
  const { period, obligation } = await setupSettlementContext(fx);
  jurisdictionId = fx.nacion.id;
  taxTypeId = fx.iva.id;
  regimeId = fx.ri.id;
  periodId = period.id;
  obligationId = obligation.id;
});

describe("G6-04 ciclo piloto completo (RI)", () => {
  it("recorre el flujo completo: perfil → cálculo → revisión → finalización → artifact → presentación → pago", async () => {
    // 1. Cobertura inicial: sin entradas.
    const covBefore = await settlements.coverage(ctxOwner, { clientId: CLIENT_PILOTO, periodId, regimeId });
    expect(covBefore.status).toBe("WAITING_INPUTS");

    // 2. Ingestión y aprobación de hechos.
    await createApprovedVouchers();
    const cov = await settlements.coverage(ctxOwner, { clientId: CLIENT_PILOTO, periodId, regimeId });
    expect(cov.vouchersApproved).toBe(3);
    expect(cov.status).toBe("READY");

    // 3. Cálculo determinista.
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    expect(settlement.status).toBe("CALCULATED");
    const totals = settlement.totals as Record<string, string>;
    expect(totals["DEBITO_FISCAL"]).toBe("42000.00");
    expect(totals["CREDITO_FISCAL"]).toBe("8400.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("33600.00");

    // 4. Maker-checker: preparador no finaliza su propio trabajo.
    await expect(settlements.finalize(ctxPreparer, settlement.id)).rejects.toThrow(SettlementError);

    // 5. Revisión y finalización por revisor distinto.
    await approveSettlement(settlement.id);
    const stored = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(stored?.status).toBe("FINALIZED");

    // 6. Papel de trabajo (artifact).
    const { artifact } = await settlements.generateArtifact(ctxOwner, {
      settlementId: settlement.id,
      format: "csv",
    });
    expect(artifact.kind).toBe("PAPEL_DE_TRABAJO");

    // 7. Presentación manual y acuse.
    const filing = await settlements.recordFiling(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      filedAt: "2026-02-05",
      amountFiled: "33600.00",
      externalId: "PDC-PILOTO-1",
      evidenceDocumentId: await createEvidenceDocument(),
    });
    expect(filing.status).toBe("FILED");

    // 8. Pago total → obligación PAID.
    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-02-10",
      amount: "33600.00",
      method: "TRANSFERENCIA",
    });
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("PAID");

    // 9. Rentabilidad publicada (devengado).
    await profitability.calculate(ctxOwner, {
      clientId: CLIENT_PILOTO,
      periodId,
      basis: "DEVENGADO",
      cutoff: "2026-01-31",
    });
    const published = await profitability.publish(ctxOwner, {
      clientId: CLIENT_PILOTO,
      periodId,
      basis: "DEVENGADO",
    });
    expect(published.status).toBe("PUBLISHED");
  });

  it("V-004: el ciclo es reproducible (mismo input → mismo hash)", async () => {
    await createApprovedVouchers();
    const a = await settlements.calculate(ctxPreparer, defaultParams());
    const b = await settlements.calculate(ctxPreparer, defaultParams());
    expect(a.settlement.inputHash).toBe(b.settlement.inputHash);
    expect(a.settlement.outputHash).toBe(b.settlement.outputHash);
  });

  it("V-003: una liquidación finalizada es inmutable incluso con SQL runtime", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);

    await expect(
      runAsRuntime(OWNER_PIL, FIRM_PILOTO, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE tax_settlements SET "outputHash" = 'tampered' WHERE id = '${settlement.id}'`,
        ),
      ),
    ).rejects.toThrow(/SETTLEMENT_IMMUTABLE/);
  });
});
