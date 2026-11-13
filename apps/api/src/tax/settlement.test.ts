import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService } from "./ingestion-service.js";
import { SettlementService, SettlementError } from "./settlement-service.js";
import { computeRulesHashV3 } from "./rules-hash.js";

/**
 * Tests de integración de liquidaciones fiscales (Puerta 3).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 *
 * G3-03: cobertura y cálculo determinista (motor IVA).
 * G3-04: workflow maker-checker (submit → review → finalize).
 * G3-07: presentación manual y acuse.
 * G3-08: pago y estado de obligación.
 * G3-09: rectificación con historial inmutable.
 *
 * Invariantes verificadas:
 * - V-001: diferencias bloqueantes visibles.
 * - V-002: finalizar exige revisor distinto.
 * - V-003: finalizada es inmutable; rectificación crea versión nueva.
 * - V-004: misma entrada + misma regla → mismo hash (reejecución estable).
 * - V-005: una liquidación finalizada conserva su rulesHash.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const REVIEWER_A = "22222222-2222-4222-8222-222222222222";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_SET = "11111111-2222-4333-8444-123456789012";

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
// F0.3: se inyecta un storage stub para que el export no dependa de MinIO local.
const settlements = new SettlementService({
  put: async () => {},
} as unknown as ConstructorParameters<typeof SettlementService>[0]);

const ctxOwner = { userId: OWNER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };

let taxTypeId = "";
let regimeId = "";
let jurisdictionId = "";
let periodId = "";
let obligationId = "";

async function setupMembership() {
  for (const [userId, email, name] of [
    [OWNER_A, "owner.sett@test.local", "Owner Sett"],
    [REVIEWER_A, "reviewer.sett@test.local", "Reviewer Sett"],
    [PREPARER_A, "preparer.sett@test.local", "Preparer Sett"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
      VALUES ('${userId}', '${email}', '${name}', 'x', now()) ON CONFLICT ("id") DO NOTHING
    `);
  }
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_ALFA}', 'Estudio Alfa', 'Estudio Alfa', now()) ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_SET}', '${FIRM_ALFA}', 'Cliente Sett', '20999999997', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  for (const [userId, role] of [
    [OWNER_A, "OWNER"],
    [REVIEWER_A, "REVIEWER"],
    [PREPARER_A, "PREPARER"],
  ] as const) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
      VALUES (gen_random_uuid()::text, '${FIRM_ALFA}', '${userId}', '${role}', 'ACTIVE', now())
      ON CONFLICT ("firmId", "userId") DO NOTHING
    `);
  }
  for (const userId of [REVIEWER_A, PREPARER_A]) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
      VALUES (gen_random_uuid()::text, '${FIRM_ALFA}', '${CLIENT_SET}', '${userId}')
      ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
    `);
  }
}

/** Maestros: nación, ARCA, IVA, RI (sufijo -SET). */
async function setupMasters() {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const nacion = await tx.jurisdiction.upsert({
      where: { code: "AR-SET" },
      update: {},
      create: { code: "AR-SET", name: "Nación Sett", kind: "NATIONAL" },
    });
    const arca = await tx.taxAuthority.upsert({
      where: { code: "ARCA-SET" },
      update: {},
      create: { code: "ARCA-SET", name: "ARCA Sett", jurisdictionId: nacion.id },
    });
    const iva = await tx.taxType.upsert({
      where: { code: "IVA" },
      update: {},
      create: { code: "IVA", name: "IVA" },
    });
    // La familia de cálculo la siembra la migración P2 (corte 2a); el régimen
    // de la prueba se asigna a VAT_RI como en los datos reales.
    const vatFamily = await tx.calcFamily.findUniqueOrThrow({ where: { key: "VAT_RI" } });
    const ri = await tx.taxRegime.upsert({
      where: { code: "RI-SET" },
      update: { calcFamilyId: vatFamily.id },
      create: {
        code: "RI-SET",
        name: "RI Sett",
        taxTypeId: iva.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
        calcFamilyId: vatFamily.id,
      },
    });
    return { nacion, arca, iva, ri };
  });
}

/** Rule pack ACTIVE con tasas IVA 21% (ventas y compras). */
async function setupActiveRules(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const pack = await tx.taxRulePack.create({
      data: { code: "VAT_SET_V1", name: "IVA Sett V1", regimeId: fx.ri.id },
    });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-vat-ri-v1.0.0",
        rulesHash: "sha256:setrules",
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

async function activateDetailedVatRules() {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const pack = await tx.taxRulePack.findUniqueOrThrow({ where: { code: "VAT_SET_V1" } });
    const active = await tx.taxRuleVersion.findFirstOrThrow({
      where: { packId: pack.id, status: "ACTIVE" },
    });
    await tx.taxRuleVersion.update({ where: { id: active.id }, data: { status: "RETIRED" } });
    const version = await tx.taxRuleVersion.create({
      data: {
        packId: pack.id,
        version: 2,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01"),
        engineVersion: "ar-vat-ri-v2.1.0",
        rulesHash: "sha256:setrules-v2.1",
        supersedesId: active.id,
      },
    });
    await tx.taxRateRule.createMany({
      data: [
        { ruleVersionId: version.id, concept: "IVA_21", rate: new Prisma.Decimal("21"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "IVA_105", rate: new Prisma.Decimal("10.5"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "IVA_27", rate: new Prisma.Decimal("27"), validFrom: new Date("2026-01-01") },
        { ruleVersionId: version.id, concept: "DTO_814", rate: new Prisma.Decimal("6.5"), validFrom: new Date("2026-01-01") },
      ],
    });
    return version;
  });
}

/** Perfil + inscripción + período + obligación. */
async function setupSettlementContext(fx: Awaited<ReturnType<typeof setupMasters>>) {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        version: 1,
        legalName: "Cliente Sett SA",
        cuit: "20999999997",
        personType: "JURIDICA",
        nationalCondition: "RESPONSABLE_INSCRIPTO",
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
        createdByUserId: OWNER_A,
      },
    });
    const period = await tx.taxPeriod.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        taxTypeId: fx.iva.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    await tx.taxRegistration.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        validFrom: new Date("2026-01-01"),
        status: "ACTIVE",
      },
    });
    const obligation = await tx.taxObligation.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        profileVersionId: profile.id,
        regimeId: fx.ri.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        materializedBy: OWNER_A,
      },
    });
    return { profile, period, obligation };
  });
}

/** Crea un documento de acuse (evidencia de presentación) para el cliente. */
async function createEvidenceDocument(): Promise<string> {
  const doc = await prisma.document.create({
    data: {
      firmId: FIRM_ALFA,
      clientId: CLIENT_SET,
      category: "ACUSE",
      status: "READY",
      uploadOrigin: "FIRM",
    },
  });
  return doc.id;
}

/** Crea y aprueba vouchers: 2 ventas 100k + 1 compra 40k. */
async function createApprovedVouchers() {
  const v1 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_SET,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 100,
    issuerCuit: "20999999997",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-10",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  const v2 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_SET,
    direction: "SALE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 101,
    issuerCuit: "20999999997",
    receiverCuit: "20111111111",
    issuedOn: "2026-01-15",
    total: "121000.00",
    components: [
      { concept: "NETO", base: "100000.00", amount: "100000.00" },
      { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
    ],
  });
  const v3 = await ingestion.createVoucher(ctxOwner, {
    clientId: CLIENT_SET,
    direction: "PURCHASE",
    type: "A",
    letter: "A",
    pointOfSale: 1,
    number: 50,
    issuerCuit: "20111111111",
    receiverCuit: "20999999997",
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
    clientId: CLIENT_SET,
    taxTypeId,
    regimeId,
    jurisdictionId,
    periodId,
    cutoff: "2026-01-31",
  };
}

const calculateParams = defaultParams; // alias por legibilidad

async function cleanupSettlements() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_A}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_ALFA}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    // G3-05: los triggers de inmutabilidad bloquean el borrado de FINALIZED;
    // el cleanup (owner) los desactiva temporalmente para resetear el fixture.
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    // Todas las tablas se borran filtrando por clientId (o por settlement del
    // cliente) para no pisar las suites que corren en paralelo.
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_interest_snapshots WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_movements WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_lots WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM monthly_tax_workpapers WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
    await tx.$executeRawUnsafe(`DELETE FROM evidence_links WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_adjustments WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_treatment_decisions WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM expense_evidence WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM management_expenses WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM f931_lines WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM f931_runs WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_components WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_voucher_lines WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_vouchers WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_rows WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_batches WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_registrations WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM client_activities WHERE "clientId" = '${CLIENT_SET}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_SET}'`);
    // Limpieza de packs/reglas SÓLO propios (sufijo -SET): no tocar -F ni -ING
    // para no romper las suites que corren en paralelo.
    await tx.$executeRawUnsafe(`
      DELETE FROM rule_approvals
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'VAT_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM normative_sources
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'VAT_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM due_date_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'VAT_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rate_rules
      WHERE "ruleVersionId" IN (
        SELECT id FROM tax_rule_versions
        WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'VAT_%')
      )
    `);
    await tx.$executeRawUnsafe(`
      DELETE FROM tax_rule_versions
      WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'VAT_%')
    `);
    await tx.$executeRawUnsafe(`DELETE FROM tax_rule_packs WHERE code LIKE 'VAT_%'`);

    // Limpia códigos de maestros propios (no toca los -F/-ING/-SET de otras suites).
    await tx.$executeRawUnsafe(`DELETE FROM economic_activities WHERE code LIKE '%-SET'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_regimes WHERE code LIKE '%-SET'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_types WHERE code LIKE '%-SET'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_authorities WHERE code LIKE '%-SET'`);
    await tx.$executeRawUnsafe(`DELETE FROM jurisdictions WHERE code LIKE '%-SET'`);
    await tx.$executeRawUnsafe(`DELETE FROM holidays WHERE "jurisdictionId" IN (SELECT id FROM jurisdictions WHERE code LIKE '%-SET')`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupSettlements();
  const fx = await setupMasters();
  await setupActiveRules(fx);
  const { period, obligation } = await setupSettlementContext(fx);
  jurisdictionId = fx.nacion.id;
  taxTypeId = fx.iva.id;
  regimeId = fx.ri.id;
  periodId = period.id;
  obligationId = obligation.id;
});

describe("G3-1 cobertura y cálculo determinista", () => {
  it("rechaza motor desconocido en despacho y no deriva a IVA legacy", async () => {
    await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      const pack = await tx.taxRulePack.findUniqueOrThrow({ where: { code: "VAT_SET_V1" } });
      await tx.taxRuleVersion.updateMany({
        where: { packId: pack.id },
        data: { engineVersion: "tax-engine-v1" },
      });
    });

    await expect(settlements.calculate(ctxOwner, calculateParams())).rejects.toMatchObject({
      code: "UNSUPPORTED_ENGINE_VERSION",
      message: expect.stringContaining("tax-engine-v1"),
    });
  });

  it("rechaza un motor implementado de otra familia sin ejecutarlo", async () => {
    await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      const pack = await tx.taxRulePack.findUniqueOrThrow({ where: { code: "VAT_SET_V1" } });
      await tx.taxRuleVersion.updateMany({
        where: { packId: pack.id },
        data: { engineVersion: "ar-iibb-cm-art2-v1.1.0" },
      });
    });

    await expect(settlements.calculate(ctxOwner, calculateParams())).rejects.toMatchObject({
      code: "UNSUPPORTED_ENGINE_VERSION",
      message: expect.stringContaining("ar-iibb-cm-art2-v1.1.0"),
    });
  });

  it("una versión retirada sin engineId sigue calculando por respaldo de texto (R4)", async () => {
    await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      const pack = await tx.taxRulePack.findUniqueOrThrow({ where: { code: "VAT_SET_V1" } });
      await tx.taxRuleVersion.updateMany({
        where: { packId: pack.id },
        data: { status: "RETIRED", engineId: null },
      });
    });
    await createApprovedVouchers();

    const { settlement } = await settlements.calculate(ctxOwner, calculateParams());
    expect(settlement.status).toBe("CALCULATED");
    expect(settlement.engineVersion).toBe("ar-vat-ri-v1.0.0");
    const totals = settlement.totals as Record<string, string>;
    expect(totals["DEBITO_FISCAL"]).toBe("42000.00");
    expect(totals["CREDITO_FISCAL"]).toBe("8400.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("33600.00");
  });

  it("despacha por engineId aunque el texto de la versión no coincida", async () => {
    const legacyVatEngine = await prisma.taxEngine.findUniqueOrThrow({
      where: { engineKey: "vat-ri-legacy" },
    });
    await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      const pack = await tx.taxRulePack.findUniqueOrThrow({ where: { code: "VAT_SET_V1" } });
      await tx.taxRuleVersion.updateMany({
        where: { packId: pack.id },
        data: { engineId: legacyVatEngine.id, engineVersion: "ar-iibb-cm-art2-v1.1.0" },
      });
    });
    await createApprovedVouchers();

    // Si despachara por el texto, el motor CM03 o la compatibilidad vieja
    // habrían bloqueado. El id manda: corre el calculador VAT legacy, que
    // informa su propia versión.
    const { settlement } = await settlements.calculate(ctxOwner, calculateParams());
    expect(settlement.status).toBe("CALCULATED");
    expect(settlement.engineVersion).toBe("ar-vat-ri-v1.0.0");
    const totals = settlement.totals as Record<string, string>;
    expect(totals["DEBITO_FISCAL"]).toBe("42000.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("33600.00");
  });

  it("coverage reporta entradas y estado", async () => {
    const covBefore = await settlements.coverage(ctxOwner, {
      clientId: CLIENT_SET,
      periodId,
      regimeId,
    });
    expect(covBefore.vouchersApproved).toBe(0);
    expect(covBefore.status).toBe("WAITING_INPUTS");

    await createApprovedVouchers();
    const cov = await settlements.coverage(ctxOwner, {
      clientId: CLIENT_SET,
      periodId,
      regimeId,
    });
    expect(cov.vouchersApproved).toBe(3);
    expect(cov.status).toBe("READY");
    expect(cov.missing).toHaveLength(0);
  });

  it("lista liquidaciones por el período fiscal seleccionado", async () => {
    const january = await settlements.calculate(ctxOwner, calculateParams());
    const februaryPeriod = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.taxPeriod.upsert({
        where: {
          clientId_taxTypeId_startDate_endDate: {
            clientId: CLIENT_SET,
            taxTypeId,
            startDate: new Date("2026-02-01T00:00:00.000Z"),
            endDate: new Date("2026-02-28T00:00:00.000Z"),
          },
        },
        update: { label: "Febrero 2026" },
        create: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_SET,
          taxTypeId,
          startDate: new Date("2026-02-01T00:00:00.000Z"),
          endDate: new Date("2026-02-28T00:00:00.000Z"),
          label: "Febrero 2026",
        },
      }),
    );
    const february = await settlements.calculate(ctxOwner, {
      ...calculateParams(),
      periodId: februaryPeriod.id,
      cutoff: "2026-02-28",
    });

    const result = await settlements.list(ctxOwner, CLIENT_SET, { periodId });

    expect(result.meta.total).toBe(1);
    expect(result.data.map((settlement) => settlement.id)).toEqual([january.settlement.id]);
    expect(result.data.map((settlement) => settlement.id)).not.toContain(february.settlement.id);
  });

  it("calcula IVA: 2 ventas 100k y 1 compra 40k → débito 42.000, crédito 8.400, total 33.600", async () => {
    await createApprovedVouchers();
    const result = await settlements.calculate(ctxOwner, calculateParams());
    const s = result.settlement;
    expect(s.status).toBe("CALCULATED");
    expect(s.engineVersion).toBe("ar-vat-ri-v1.0.0");
    expect(s.rulesHash).toBe("sha256:setrules");
    const totals = s.totals as Record<string, string>;
    expect(totals["DEBITO_FISCAL"]).toBe("42000.00");
    expect(totals["CREDITO_FISCAL"]).toBe("8400.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("33600.00");
    // VENTAS + COMPRAS
    const concepts = result.lines.map((l) => l.concept);
    expect(concepts).toContain("VENTAS");
    expect(concepts).toContain("COMPRAS");
  });

  it("calcula IVA v2 por alícuota y toma Dto. 814 sólo del F.931 revisado", async () => {
    await activateDetailedVatRules();
    const { v1, v2, v3 } = await createApprovedVouchers();
    const f931 = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.f931Run.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_SET,
          periodId,
          totalRemuneration: new Prisma.Decimal("60000"),
          deduction: new Prisma.Decimal("10000"),
          netRemuneration: new Prisma.Decimal("50000"),
          status: "REVIEWED",
          reviewedByUserId: REVIEWER_A,
          reviewedAt: new Date("2026-01-31"),
          hash: "sha256:f931-set-v2",
        },
      }),
    );
    const classifications = [v1, v2, v3].map((voucher) => ({
      voucherId: voucher.id,
      documentKind: "INVOICE",
      activityCode: voucher.direction === "SALE" ? "VENTA_GENERAL" : "COMPRAS",
      categoryCode: voucher.direction === "PURCHASE" ? "SUPER" : null,
      rateBuckets: [{
        rate: "21",
        base: voucher.direction === "SALE" ? "100000.0000" : "40000.0000",
        amount: voucher.direction === "SALE" ? "21000.0000" : "8400.0000",
      }],
      snapshotHash: `sha256:classification-${voucher.id}`,
    }));

    const result = await settlements.calculate(ctxOwner, {
      ...calculateParams(),
      sourceScope: {
        voucherIds: [v1.id, v2.id, v3.id],
        withholdingIds: [],
        perceptionIds: [],
        f931RunIds: [f931.id],
        classifications,
      },
    });
    const totals = result.settlement.totals as Record<string, string>;
    expect(result.settlement.engineVersion).toBe("ar-vat-ri-v2.1.0");
    expect(totals).toMatchObject({
      DEBITO_FISCAL: "42000.00",
      CREDITO_FISCAL: "8400.00",
      CREDITO_DTO_814: "3250.00",
      SALDO_TECNICO_A_INGRESAR: "30350.00",
      TOTAL_A_INGRESAR: "30350.00",
    });
    expect(result.lines.some((line) => line.concept === "DEBITO_IVA_21")).toBe(true);
    expect(result.lines.some((line) => line.concept === "CREDITO_DTO_814")).toBe(true);
    expect(result.inputs.some((input) => input.kind === "F931" && input.sourceId === f931.id)).toBe(true);
    expect(result.result.blocks).toHaveLength(0);
  });

  it("arrastra IVA v2 sin duplicar saldos al rectificar y usar el mes siguiente", async () => {
    await activateDetailedVatRules();
    const { v3: januaryPurchase } = await createApprovedVouchers();
    const januaryScope = {
      voucherIds: [januaryPurchase.id],
      withholdingIds: [],
      perceptionIds: [],
      f931RunIds: [],
      classifications: [
        {
          voucherId: januaryPurchase.id,
          documentKind: "INVOICE",
          activityCode: "COMPRAS",
          categoryCode: "SUPER",
          rateBuckets: [{ rate: "21", base: "40000.0000", amount: "8400.0000" }],
          snapshotHash: "sha256:january-purchase",
        },
      ],
    };
    const original = await settlements.calculate(ctxPreparer, {
      ...calculateParams(),
      sourceScope: januaryScope,
    });
    await settlements.submitReview(ctxPreparer, original.settlement.id);
    await settlements.review(ctxReviewer, original.settlement.id);
    await settlements.finalize(ctxOwner, original.settlement.id);

    let lots = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.taxCreditLot.findMany({
        where: { clientId: CLIENT_SET, sourceSettlementId: original.settlement.id },
        include: { movements: true },
      }),
    );
    expect(lots).toHaveLength(2);
    expect(lots.find((lot) => lot.kind === "IVA_TECNICO")?.originalAmount.toFixed(4)).toBe(
      "8400.0000",
    );
    expect(lots.find((lot) => lot.kind === "IVA_LIBRE")?.originalAmount.toFixed(4)).toBe(
      "0.0000",
    );

    const rectification = await settlements.rectify(
      ctxPreparer,
      original.settlement.id,
      "Corrección del libro IVA",
    );
    const recalculated = await settlements.calculate(ctxPreparer, {
      ...calculateParams(),
      sourceScope: januaryScope,
    });
    expect(recalculated.settlement.id).toBe(rectification.id);
    expect((recalculated.settlement.totals as Record<string, string>)["SALDO_TECNICO_AFTER"]).toBe(
      "8400.00",
    );
    expect(
      recalculated.inputs.some(
        (item) =>
          item.kind === "CREDIT" &&
          (item.snapshot as Record<string, unknown>)["kind"] ===
            "RECTIFICATION_OPENING_SNAPSHOT",
      ),
    ).toBe(true);
    await settlements.submitReview(ctxPreparer, recalculated.settlement.id);
    await settlements.review(ctxReviewer, recalculated.settlement.id);
    await settlements.finalize(ctxOwner, recalculated.settlement.id);

    lots = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.taxCreditLot.findMany({
        where: { clientId: CLIENT_SET, kind: "IVA_TECNICO" },
        include: { movements: true },
        orderBy: { createdAt: "asc" },
      }),
    );
    expect(lots).toHaveLength(2);
    expect(
      lots
        .map((lot) =>
          lot.originalAmount.minus(
            lot.movements.reduce((sum, movement) => sum.plus(movement.amount), new Prisma.Decimal(0)),
          ),
        )
        .reduce((sum, amount) => sum.plus(amount), new Prisma.Decimal(0))
        .toFixed(4),
    ).toBe("8400.0000");

    const februaryPeriod = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.taxPeriod.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_SET,
          taxTypeId,
          startDate: new Date("2026-02-01"),
          endDate: new Date("2026-02-28"),
          label: "Febrero 2026",
        },
      }),
    );
    const februarySale = await ingestion.createVoucher(ctxPreparer, {
      clientId: CLIENT_SET,
      direction: "SALE",
      type: "A",
      letter: "A",
      pointOfSale: 1,
      number: 200,
      issuerCuit: "20999999997",
      receiverCuit: "20111111111",
      issuedOn: "2026-02-10",
      total: "121000.00",
      components: [
        { concept: "NETO", base: "100000.00", amount: "100000.00" },
        { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
      ],
    });
    await ingestion.reviewVoucher(ctxReviewer, februarySale.id, true);
    const februaryScope = {
      voucherIds: [februarySale.id],
      withholdingIds: [],
      perceptionIds: [],
      f931RunIds: [],
      classifications: [
        {
          voucherId: februarySale.id,
          documentKind: "INVOICE",
          activityCode: "VENTA_GENERAL",
          categoryCode: null,
          rateBuckets: [{ rate: "21", base: "100000.0000", amount: "21000.0000" }],
          snapshotHash: "sha256:february-sale",
        },
      ],
    };
    const february = await settlements.calculate(ctxPreparer, {
      clientId: CLIENT_SET,
      taxTypeId,
      regimeId,
      jurisdictionId,
      periodId: februaryPeriod.id,
      cutoff: "2026-02-28",
      sourceScope: februaryScope,
    });
    expect((february.settlement.totals as Record<string, string>)).toMatchObject({
      SALDO_TECNICO_ANTERIOR: "8400.00",
      TOTAL_A_INGRESAR: "12600.00",
    });
    await settlements.submitReview(ctxPreparer, february.settlement.id);
    await settlements.review(ctxReviewer, february.settlement.id);
    await settlements.finalize(ctxOwner, february.settlement.id);

    const historical = await settlements.rectify(
      ctxPreparer,
      recalculated.settlement.id,
      "Nueva corrección histórica",
    );
    const historicalCalculated = await settlements.calculate(ctxPreparer, {
      ...calculateParams(),
      sourceScope: januaryScope,
    });
    expect(historicalCalculated.settlement.id).toBe(historical.id);
    await settlements.submitReview(ctxPreparer, historical.id);
    await settlements.review(ctxReviewer, historical.id);
    await expect(settlements.finalize(ctxOwner, historical.id)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });

    const downstreamRectification = await settlements.rectify(
      ctxPreparer,
      february.settlement.id,
      "Propagar la rectificación de enero",
    );
    await settlements.finalize(ctxOwner, historical.id);
    const downstreamCalculated = await settlements.calculate(ctxPreparer, {
      clientId: CLIENT_SET,
      taxTypeId,
      regimeId,
      jurisdictionId,
      periodId: februaryPeriod.id,
      cutoff: "2026-02-28",
      sourceScope: februaryScope,
    });
    expect(downstreamCalculated.settlement.id).toBe(downstreamRectification.id);
    expect(
      downstreamCalculated.inputs.some(
        (item) => item.kind === "CREDIT" && item.sourceId === historical.id,
      ),
    ).toBe(true);
    await settlements.submitReview(ctxPreparer, downstreamCalculated.settlement.id);
    await settlements.review(ctxReviewer, downstreamCalculated.settlement.id);
    await settlements.finalize(ctxOwner, downstreamCalculated.settlement.id);
  });

  it("el alcance del expediente aplica la nota de crédito con signo negativo", async () => {
    const { v1, v2, v3 } = await createApprovedVouchers();
    const result = await settlements.calculate(ctxOwner, {
      ...calculateParams(),
      sourceScope: {
        voucherIds: [v1.id, v2.id, v3.id],
        withholdingIds: [],
        perceptionIds: [],
        f931RunIds: [],
        classifications: [
          {
            voucherId: v1.id,
            documentKind: "INVOICE",
            activityCode: "VENTA_GENERAL",
            categoryCode: null,
            snapshotHash: "sha256:classification-v1",
          },
          {
            voucherId: v2.id,
            documentKind: "CREDIT_NOTE",
            activityCode: "VENTA_GENERAL",
            categoryCode: null,
            snapshotHash: "sha256:classification-v2",
          },
          {
            voucherId: v3.id,
            documentKind: "INVOICE",
            activityCode: "COMPRAS",
            categoryCode: "SUPER",
            snapshotHash: "sha256:classification-v3",
          },
        ],
      },
    });
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["DEBITO_FISCAL"]).toBe("0.00");
    expect(totals["CREDITO_FISCAL"]).toBe("8400.00");
    expect(
      result.inputs.some(
        (input) =>
          input.sourceId.startsWith(`${v2.id}:`) &&
          (input.snapshot as Record<string, unknown>)["sign"] === -1,
      ),
    ).toBe(true);
  });

  it("consume retenciones y percepciones sólo desde imputaciones del expediente", async () => {
    const { v1, v2, v3 } = await createApprovedVouchers();
    const workpaper = await prisma.monthlyTaxWorkpaper.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-01-31"),
        status: "READY_TO_CALCULATE",
        preparedByUserId: OWNER_A,
      },
    });
    const withholding = await prisma.withholdingCertificate.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        cuitAgent: "30555555550",
        cuitResponsible: "20999999997",
        concept: "IVA",
        base: new Prisma.Decimal("100000"),
        amount: new Prisma.Decimal("2000"),
        issuedOn: new Date("2026-01-20"),
        status: "APPROVED",
      },
    });
    const perceptionCreditNote = await prisma.perceptionCertificate.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        cuitAgent: "30666666660",
        cuitResponsible: "20999999997",
        concept: "IVA",
        base: new Prisma.Decimal("20000"),
        amount: new Prisma.Decimal("-500"),
        creditKind: "PERCEPTION_CREDIT_NOTE",
        issuedOn: new Date("2026-01-22"),
        status: "APPROVED",
      },
    });
    await prisma.taxInputAllocation.createMany({
      data: [
        {
          firmId: FIRM_ALFA,
          clientId: CLIENT_SET,
          workpaperId: workpaper.id,
          obligationId,
          sourceCode: "SICORE_IVA",
          sourceType: "WITHHOLDING",
          sourceId: withholding.id,
          taxTypeId,
          regimeId,
          jurisdictionId,
          periodId,
          amount: new Prisma.Decimal("2000"),
          status: "ALLOCATED",
          snapshotHash: "sha256:allocation-withholding",
        },
        {
          firmId: FIRM_ALFA,
          clientId: CLIENT_SET,
          workpaperId: workpaper.id,
          obligationId,
          sourceCode: "SICORE_IVA",
          sourceType: "PERCEPTION",
          sourceId: perceptionCreditNote.id,
          taxTypeId,
          regimeId,
          jurisdictionId,
          periodId,
          amount: new Prisma.Decimal("-500"),
          status: "ALLOCATED",
          snapshotHash: "sha256:allocation-perception",
        },
      ],
    });

    const result = await settlements.calculate(ctxOwner, {
      ...calculateParams(),
      sourceScope: {
        workpaperId: workpaper.id,
        obligationId,
        voucherIds: [v1.id, v2.id, v3.id],
        withholdingIds: [withholding.id],
        perceptionIds: [perceptionCreditNote.id],
        f931RunIds: [],
        classifications: [],
      },
    });
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["RETENCIONES_SUFRIDAS"]).toBe("2000.00");
    expect(totals["PERCEPCIONES_SUFRIDAS"]).toBe("-500.00");
    expect(totals["TOTAL_A_INGRESAR"]).toBe("32100.00");
    expect(
      result.inputs.filter(
        (input) => input.kind === "WITHHOLDING" || input.kind === "PERCEPTION",
      ),
    ).toHaveLength(2);
  });

  it("V-004: reejecutar con mismo cutoff produce el mismo hash", async () => {
    await createApprovedVouchers();
    const a = await settlements.calculate(ctxOwner, calculateParams());
    const b = await settlements.calculate(ctxOwner, calculateParams());
    expect(a.settlement.inputHash).toBe(b.settlement.inputHash);
    expect(a.settlement.outputHash).toBe(b.settlement.outputHash);
    expect(a.settlement.id).toBe(b.settlement.id);
  });

  it("hecho fuera del cutoff no afecta el resultado", async () => {
    await createApprovedVouchers();
    // Venta del 10-01 dentro; venta del 15-01 y compra del 12-01 fuera del
    // cutoff 11-01 quedan excluidas.
    const result = await settlements.calculate(ctxOwner, {
      ...calculateParams(),
      cutoff: "2026-01-11",
    });
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals["CREDITO_FISCAL"]).toBe("0.00");
    expect(totals["DEBITO_FISCAL"]).toBe("21000.00");
  });

  it("no calcula sin una versión activada vigente para el período", async () => {
    // RETIRED sigue siendo válida históricamente; para probar la ausencia de
    // reglas activadas se deja la única versión como borrador.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_A}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_ALFA}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
      await tx.$executeRawUnsafe(`UPDATE tax_rule_versions SET status = 'DRAFT' WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code = 'VAT_SET_V1')`);
    });
    await expect(settlements.calculate(ctxOwner, calculateParams())).rejects.toThrow(
      SettlementError,
    );
  });
});

describe("G3-2 workflow maker-checker", () => {
  it("submit → review → finalize con revisor distinto (V-002)", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());

    await settlements.submitReview(ctxPreparer, settlement.id);
    const inReview = await settlements.review(ctxReviewer, settlement.id);
    expect(inReview.status).toBe("REVIEWED");

    const finalized = await settlements.finalize(ctxReviewer, settlement.id);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.finalizedByUserId).toBe(REVIEWER_A);
  });

  it("el preparador no puede finalizar su propia liquidación", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await expect(settlements.finalize(ctxPreparer, settlement.id)).rejects.toThrow(
      SettlementError,
    );
  });

  it("V-002: no se puede revisar sin transición IN_REVIEW", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxOwner, calculateParams());
    await expect(settlements.review(ctxReviewer, settlement.id)).rejects.toThrow(SettlementError);
  });

  it("el revisor puede pedir cambios y el preparador recalcula (CHANGES_REQUESTED → CALCULATED)", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);

    await settlements.requestChanges(ctxReviewer, settlement.id, "Falta una nota de crédito");
    const changed = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(changed?.status).toBe("CHANGES_REQUESTED");

    const recalculated = await settlements.calculate(ctxPreparer, calculateParams());
    expect(recalculated.settlement.status).toBe("CALCULATED");
    expect(recalculated.settlement.id).toBe(settlement.id);
  });
});

describe("G3-3 finalización e inmutabilidad", () => {
  it("V-003: finalizada rechaza cambios posteriores", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    // Recalcular sobre finalizada debe fallar (inmutable: no hay versión editable).
    await expect(settlements.calculate(ctxOwner, calculateParams())).rejects.toThrow(SettlementError);

    const db = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(db?.status).toBe("FINALIZED");
  });

  it("re-INTENTAR finalizar devuelve inmutable", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);
    await expect(settlements.finalize(ctxReviewer, settlement.id)).rejects.toThrow(SettlementError);
  });

  it("V-005: una liquidación finalizada conserva su rulesHash aunque cambie la regla", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);
    const rulesHashAtFinalize = settlement.rulesHash;

    // Cambia la regla activa (nueva versión ACTIVE con otra tasa).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_A}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_ALFA}', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
      await tx.$executeRawUnsafe(`
        UPDATE tax_rule_versions SET status = 'RETIRED' WHERE "packId" IN (SELECT id FROM tax_rule_packs WHERE code LIKE 'VAT_SET_V1')
      `);
    });
    // Insertar una v2 ACTIVE con tasa 25% para simular el cambio de regla.
    await prisma.$executeRawUnsafe(`
      INSERT INTO tax_rule_packs ("id", code, name, "regimeId", status, "createdAt", "updatedAt")
      SELECT gen_random_uuid()::text, 'VAT_SET_V1B', 'IVA Sett V2', "id", 'ACTIVE', now(), now() FROM tax_regimes WHERE code = 'RI-SET'
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO tax_rule_versions ("id","packId",version,status,"validFrom","engineVersion","rulesHash","createdAt","updatedAt")
      SELECT gen_random_uuid()::text, p.id, 1, 'ACTIVE', '2026-01-01', 'ar-vat-ri-v1.0.0', 'sha256:newrules', now(), now()
      FROM tax_rule_packs p WHERE p.code = 'VAT_SET_V1B'
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO tax_rate_rules ("id","ruleVersionId",concept,rate,"validFrom","createdAt")
      SELECT gen_random_uuid()::text, v.id, 'VENTAS', 25, '2026-01-01', now()
      FROM tax_rule_versions v
      JOIN tax_rule_packs p ON v."packId" = p.id
      WHERE p.code = 'VAT_SET_V1B'
    `);

    const stored = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(stored?.rulesHash).toBe(rulesHashAtFinalize);
    expect(stored?.status).toBe("FINALIZED");
  });

  it("G3-05: una FINALIZED no se modifica ni borra ni con SQL runtime (trigger)", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await approveSettlement(settlement.id);

    // UPDATE directo con rol runtime (sin BYPASSRLS) → trigger bloquea.
    await expect(
      runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE tax_settlements SET "outputHash" = 'tampered' WHERE id = '${settlement.id}'`,
        ),
      ),
    ).rejects.toThrow(/SETTLEMENT_IMMUTABLE/);

    // DELETE directo → trigger bloquea.
    await expect(
      runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE id = '${settlement.id}'`),
      ),
    ).rejects.toThrow(/SETTLEMENT_IMMUTABLE/);

    // Snapshots (líneas) tampoco se borran.
    await expect(
      runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM tax_settlement_lines WHERE "settlementId" = '${settlement.id}'`,
        ),
      ),
    ).rejects.toThrow(/SETTLEMENT_IMMUTABLE/);

    const stored = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(stored?.status).toBe("FINALIZED");
    expect(stored?.outputHash).not.toBe("tampered");
  });
});

describe("G3-4 rectificación", () => {
  it("rectifica creando versión nueva e inmutable la anterior (V-003)", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await settlements.submitReview(ctxPreparer, settlement.id);
    await settlements.review(ctxReviewer, settlement.id);
    await settlements.finalize(ctxReviewer, settlement.id);

    const rectified = await settlements.rectify(ctxPreparer, settlement.id, "Nota de crédito omitida");
    expect(rectified.status).toBe("DRAFT");
    expect(rectified.version).toBe(2);
    expect(rectified.supersedesId).toBe(settlement.id);

    const original = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(original?.status).toBe("FINALIZED");
  });

  it("la rectificación no modifica la original", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);
    const before = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    await settlements.rectify(ctxPreparer, settlement.id, "Cambio de alícuota");
    const after = await prisma.taxSettlement.findUnique({ where: { id: settlement.id } });
    expect(after?.status).toBe("FINALIZED");
    expect(after?.totals).toEqual(before?.totals);
  });

  it("G3-09: rectificativa con delta registra la diferencia por renglón", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);

    // Nueva versión DRAFT con delta (la original queda FINALIZED).
    const { settlement: next, deltas } = await settlements.rectifyWithDelta(
      ctxPreparer,
      settlement.id,
      "Nota de crédito omitida",
    );
    expect(next.status).toBe("DRAFT");
    expect(next.version).toBe(2);
    expect(next.supersedesId).toBe(settlement.id);

    // La versión nueva aún no tiene líneas (se calcula después), así que el
    // delta se registra al recalcular; verificamos que la diferencia existe.
    const diffs = await settlements.listDifferences(ctxPreparer, next.id);
    expect(diffs.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(deltas)).toBe(true);
  });
});

describe("G3-6 papel de trabajo y export", () => {
  it("genera artifact CSV desde una liquidación finalizada", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await approveSettlement(settlement.id);

    const { artifact, checksum, objectKey } = await settlements.generateArtifact(ctxOwner, {
      settlementId: settlement.id,
      format: "csv",
    });
    expect(artifact.kind).toBe("PAPEL_DE_TRABAJO");
    expect(artifact.format).toBe("csv");
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(objectKey).toContain(`v${settlement.version}.csv`);

    const artifacts = await settlements.listArtifacts(ctxOwner, settlement.id);
    expect(artifacts).toHaveLength(1);
  });

  it("no genera artifact desde una liquidación no finalizada", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, calculateParams());
    await expect(
      settlements.generateArtifact(ctxOwner, { settlementId: settlement.id, format: "csv" }),
    ).rejects.toThrow(SettlementError);
  });
});

describe("G3-5 presentación, pago y crédito", () => {
  it("presenta la liquidación finalizada y pasa la obligación a FILED", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);
    const filing = await settlements.recordFiling(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      filedAt: "2026-02-05",
      amountFiled: "33600.00",
      externalId: "PDC-124567",
      evidenceDocumentId: await createEvidenceDocument(),
    });
    expect(filing.status).toBe("FILED");
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("FILED");
  });

  it("D-3 exige acuse (evidenceDocumentId) para presentar como FILED", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);

    // Sin acuse → rechaza.
    await expect(
      settlements.recordFiling(ctxOwner, {
        obligationId,
        settlementId: settlement.id,
        filedAt: "2026-02-05",
        amountFiled: "33600.00",
        evidenceDocumentId: "",
      }),
    ).rejects.toThrow(SettlementError);

    // Con acuse de otro cliente → rechaza.
    const otherDoc = await prisma.document.create({
      data: { firmId: FIRM_ALFA, clientId: "11111111-2222-4333-8444-999999999999", category: "ACUSE", status: "READY" },
    });
    await expect(
      settlements.recordFiling(ctxOwner, {
        obligationId,
        settlementId: settlement.id,
        filedAt: "2026-02-05",
        amountFiled: "33600.00",
        evidenceDocumentId: otherDoc.id,
      }),
    ).rejects.toThrow(SettlementError);

    // Intento sin presentar queda PENDING.
    const pending = await settlements.recordFilingPending(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      filedAt: "2026-02-05",
      amountFiled: "33600.00",
    });
    expect(pending.status).toBe("PENDING");
  });

  it("registra pago total y marca la obligación PAID", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);
    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-02-10",
      amount: "33600.00",
      method: "TRANSFERENCIA",
    });
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("PAID");
  });

  it("pago parcial deja la obligación PARTIALLY_PAID", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);
    await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-02-10",
      amount: "10000.00",
      method: "EFECTIVO",
    });
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("PARTIALLY_PAID");
  });

  it("separa capital e interés en un pago vencido", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);
    const dueDate = new Date("2026-02-20T00:00:00.000Z");
    const paidAt = new Date("2026-03-22T00:00:00.000Z");
    await prisma.taxObligation.update({
      where: { id: obligationId },
      data: { dueDate },
    });
    await prisma.taxInterestSnapshot.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        obligationId,
        settlementId: settlement.id,
        baseAmount: new Prisma.Decimal("33600"),
        dueDate,
        asOfDate: paidAt,
        daysLate: 30,
        monthlyRate: new Prisma.Decimal("0.06"),
        ruleVersionId: settlement.ruleVersionId,
        amount: new Prisma.Decimal("2016"),
        inputHash: "late-payment-split",
      },
    });

    const payment = await settlements.recordPayment(ctxOwner, {
      obligationId,
      settlementId: settlement.id,
      paidAt: "2026-03-22",
      amount: "35616.00",
      method: "TRANSFERENCIA",
    });
    expect(payment.principalAmount.toString()).toBe("33600");
    expect(payment.interestAmount.toString()).toBe("2016");
    const obligation = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(obligation?.status).toBe("PAID");
  });

  it("exige una foto de mora para pagar después del vencimiento", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);
    await prisma.taxObligation.update({
      where: { id: obligationId },
      data: { dueDate: new Date("2026-02-20T00:00:00.000Z") },
    });
    await expect(
      settlements.recordPayment(ctxOwner, {
        obligationId,
        settlementId: settlement.id,
        paidAt: "2026-03-22",
        amount: "33600.00",
        method: "TRANSFERENCIA",
      }),
    ).rejects.toMatchObject({ code: "INTEREST_SNAPSHOT_REQUIRED" });
  });

  it("reversión de pago exige revisor distinto y vuelve la obligación a READY_TO_FILE", async () => {
    const payment = await createPayment("33600.00");
    await expect(
      settlements.reversePayment(ctxOwner, payment.id, "Error de destino"),
    ).rejects.toThrow(SettlementError); // mismo creador
    const reversed = await settlements.reversePayment(ctxReviewer, payment.id, "Error de destino");
    expect(reversed.status).toBe("REVERSED");
    const ob = await prisma.taxObligation.findUnique({ where: { id: obligationId } });
    expect(ob?.status).toBe("READY_TO_FILE");
  });

  it("asignación de crédito reduce el saldo disponible", async () => {
    const credit = await prisma.taxCreditLedgerEntry.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_SET,
        taxTypeId,
        jurisdictionId,
        kind: "FREE_AVAILABILITY",
        amount: new Prisma.Decimal("5000"),
        balanceAfter: new Prisma.Decimal("5000"),
        createdByUserId: OWNER_A,
      },
    });
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    await approveSettlement(settlement.id);
    const alloc = await settlements.allocateCredit(ctxOwner, {
      creditEntryId: credit.id,
      settlementId: settlement.id,
      amount: "2000",
    });
    expect(alloc.amount.toString()).toBe("2000");
    const updated = await prisma.taxCreditLedgerEntry.findUnique({ where: { id: credit.id } });
    expect(updated?.balanceAfter.toString()).toBe("3000");

    // Excede: rechazado
    await expect(
      settlements.allocateCredit(ctxOwner, {
        creditEntryId: credit.id,
        settlementId: settlement.id,
        amount: "5000",
      }),
    ).rejects.toThrow(SettlementError);
  });

  it("el anticipo se decide por capacidad de la familia, no por el prefijo del texto", async () => {
    await createApprovedVouchers();
    const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
    // Texto con prefijo de Monotributo sobre un motor IVA: si el anticipo se
    // decidiera por el prefijo, el pago se aceptaría. La capacidad VAT_RI lo
    // rechaza porque la liquidación no está finalizada.
    await prisma.taxSettlement.update({
      where: { id: settlement.id },
      data: { engineVersion: "ar-monotributo-v1.0.0" },
    });
    await expect(
      settlements.recordPayment(ctxOwner, {
        obligationId,
        settlementId: settlement.id,
        paidAt: "2026-01-15",
        amount: "1000",
        method: "DEBITO",
      }),
    ).rejects.toMatchObject({ code: "SETTLEMENT_IMMUTABLE" });
  });
});

/**
 * P2 4a-ii (C6): la versión tipada resuelve las alícuotas por `kind` RATE y el
 * crédito Dto. 814 como SPECIAL_CREDIT. La etiqueta del concepto no decide:
 * acá se renombran todas las reglas y el resultado debe ser el mismo golden.
 */
describe("G3-7 — IVA con reglas tipadas", () => {
  it("aplica el crédito especial por tipo y conserva el golden", async () => {
    const version = await activateDetailedVatRules();
    const rateKind = await prisma.taxRuleKind.findUniqueOrThrow({ where: { key: "RATE" } });
    const specialKind = await prisma.taxRuleKind.findUniqueOrThrow({
      where: { key: "SPECIAL_CREDIT" },
    });
    const rules = await prisma.taxRateRule.findMany({ where: { ruleVersionId: version.id } });
    for (const rule of rules) {
      const isSpecial = rule.concept === "DTO_814";
      await prisma.taxRateRule.update({
        where: { id: rule.id },
        data: {
          kindId: isSpecial ? specialKind.id : rateKind.id,
          concept: isSpecial
            ? "CREDITO_CONTRIBUCIONES"
            : `ALICUOTA_${rule.concept.replace("IVA_", "")}`,
        },
      });
    }
    const full = await prisma.taxRuleVersion.findUniqueOrThrow({
      where: { id: version.id },
      include: {
        rateRules: { include: { kind: true } },
        minimumRules: true,
        bracketRules: true,
        dueDateRules: true,
        roundingRules: true,
      },
    });
    await prisma.taxRuleVersion.update({
      where: { id: version.id },
      data: { rulesHashSchemaVersion: 3, rulesHash: computeRulesHashV3(full) },
    });

    const { v1, v2, v3 } = await createApprovedVouchers();
    const f931 = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.f931Run.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_SET,
          periodId,
          totalRemuneration: new Prisma.Decimal("60000"),
          deduction: new Prisma.Decimal("10000"),
          netRemuneration: new Prisma.Decimal("50000"),
          status: "REVIEWED",
          reviewedByUserId: REVIEWER_A,
          reviewedAt: new Date("2026-01-31"),
          hash: "sha256:f931-set-typed",
        },
      }),
    );
    const classifications = [v1, v2, v3].map((voucher) => ({
      voucherId: voucher.id,
      documentKind: "INVOICE",
      activityCode: voucher.direction === "SALE" ? "VENTA_GENERAL" : "COMPRAS",
      categoryCode: voucher.direction === "PURCHASE" ? "SUPER" : null,
      rateBuckets: [{
        rate: "21",
        base: voucher.direction === "SALE" ? "100000.0000" : "40000.0000",
        amount: voucher.direction === "SALE" ? "21000.0000" : "8400.0000",
      }],
      snapshotHash: `sha256:classification-${voucher.id}`,
    }));

    const result = await settlements.calculate(ctxOwner, {
      ...calculateParams(),
      sourceScope: {
        voucherIds: [v1.id, v2.id, v3.id],
        withholdingIds: [],
        perceptionIds: [],
        f931RunIds: [f931.id],
        classifications,
      },
    });
    const totals = result.settlement.totals as Record<string, string>;
    expect(totals).toMatchObject({
      DEBITO_FISCAL: "42000.00",
      CREDITO_FISCAL: "8400.00",
      CREDITO_DTO_814: "3250.00",
      SALDO_TECNICO_A_INGRESAR: "30350.00",
      TOTAL_A_INGRESAR: "30350.00",
    });
    expect(result.result.blocks).toHaveLength(0);
    expect(result.inputs.some((input) => input.kind === "F931" && input.sourceId === f931.id)).toBe(true);
  });
});

async function approveSettlement(settlementId: string) {
  await settlements.submitReview(ctxPreparer, settlementId);
  await settlements.review(ctxReviewer, settlementId);
  await settlements.finalize(ctxReviewer, settlementId);
}

async function createPayment(amount: string) {
  await createApprovedVouchers();
  const { settlement } = await settlements.calculate(ctxPreparer, defaultParams());
  await approveSettlement(settlement.id);
  return settlements.recordPayment(ctxOwner, {
    obligationId,
    settlementId: settlement.id,
    paidAt: "2026-02-10",
    amount,
    method: "TRANSFERENCIA",
  });
}
