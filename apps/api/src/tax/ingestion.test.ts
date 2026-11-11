import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService, ImportError } from "./ingestion-service.js";
import { ManagementExpenseService, ExpenseError } from "./management-expense-service.js";
import { MonthlyWorkpaperService } from "./workpaper-service.js";

/**
 * Tests de integración de la ingestión fiscal (Puerta 2).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 *
 * G2-01: lotes de importación.
 * G2-02: adaptador ARCA compras/ventas.
 * G2-03: retenciones y percepciones.
 * G2-04: FiscalVoucher y componentes.
 * G2-05/10: deduplicación e idempotencia.
 * G2-08: gastos gerenciales y tratamiento.
 * G2-09: revisión independiente (maker-checker).
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const REVIEWER_A = "22222222-2222-4222-8222-222222222222";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
// Cliente propio de ingestión (distinto del de fundación) para evitar race
// conditions cuando los archivos de test corren en paralelo (vitest multi-worker).
const CLIENT_ING = "11111111-2222-4333-8444-999999999999";

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
const expenses = new ManagementExpenseService();
const workpapers = new MonthlyWorkpaperService();

const ctxOwner = { userId: OWNER_A, firmId: FIRM_ALFA, clientId: CLIENT_ING, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_A, firmId: FIRM_ALFA, clientId: CLIENT_ING, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_A, firmId: FIRM_ALFA, clientId: CLIENT_ING, actorKind: "USER" as const };

/** Crea firma, usuarios, membresías y contexto fiscal mínimo. */
async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_A}', 'owner.ing@test.local', 'Owner Ing', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${REVIEWER_A}', 'reviewer.ing@test.local', 'Reviewer Ing', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${PREPARER_A}', 'preparer.ing@test.local', 'Preparer Ing', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_ALFA}', 'Estudio Alfa', 'Estudio Alfa', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_ING}', '${FIRM_ALFA}', 'Cliente Ingestion', '20999999998', now())
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
  // Asignación del cliente para preparador/revisor.
  await prisma.$executeRawUnsafe(`
    INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
    VALUES (gen_random_uuid()::text, '${FIRM_ALFA}', '${CLIENT_ING}', '${REVIEWER_A}')
    ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO client_assignments ("id", "firmId", "clientId", "userId")
    VALUES (gen_random_uuid()::text, '${FIRM_ALFA}', '${CLIENT_ING}', '${PREPARER_A}')
    ON CONFLICT ("firmId", "userId", "clientId") DO NOTHING
  `);
}

let ivaId = "";
let iibbId = "";
let periodId = "";

/** Crea maestros y un período fiscal para el cliente (idempotente en maestros). */
async function setupFiscalContext() {
  await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const nacion = await tx.jurisdiction.upsert({
      where: { code: "AR-ING" },
      update: {},
      create: { code: "AR-ING", name: "Nación Ing", kind: "NATIONAL" },
    });
    const arca = await tx.taxAuthority.upsert({
      where: { code: "ARCA-ING" },
      update: {},
      create: { code: "ARCA-ING", name: "ARCA Ing", jurisdictionId: nacion.id },
    });
    const iva = await tx.taxType.upsert({
      where: { code: "IVA-ING" },
      update: {},
      create: { code: "IVA-ING", name: "IVA Ing" },
    });
    const iibb = await tx.taxType.upsert({
      where: { code: "IIBB-ING" },
      update: {},
      create: { code: "IIBB-ING", name: "IIBB Ing" },
    });
    const ri = await tx.taxRegime.upsert({
      where: { code: "RI-ING" },
      update: {},
      create: {
        code: "RI-ING",
        name: "RI Ing",
        taxTypeId: iva.id,
        jurisdictionId: nacion.id,
        authorityId: arca.id,
      },
    });
    ivaId = iva.id;
    iibbId = iibb.id;

    const profile = await tx.taxpayerProfileVersion.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ING,
        version: 1,
        legalName: "Cliente Ingestion SA",
        cuit: "20999999998",
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
        clientId: CLIENT_ING,
        taxTypeId: iva.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        label: "Enero 2026",
      },
    });
    periodId = period.id;

    await tx.taxObligation.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ING,
        profileVersionId: profile.id,
        regimeId: ri.id,
        periodId: period.id,
        status: "READY_TO_CALCULATE",
        dueDate: new Date("2026-02-20"),
        materializedBy: OWNER_A,
      },
    });
  });
}

/** Limpia sólo los datos del cliente de ingestión (no toca maestros compartidos). */
async function cleanupIngestion() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.user_id', '${OWNER_A}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.firm_id', '${FIRM_ALFA}', true)`);
    await tx.$executeRawUnsafe(`SELECT set_config('app.actor_kind', 'USER', true)`);
    // G3-05: desactiva triggers de inmutabilidad para resetear fixtures.
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`);
    // IMPORTANTE: se filtra por clientId para no borrar filas de las suites
    // que corren en paralelo (fundación -F, settlements -SET, IIBB -IIBB).
    await tx.$executeRawUnsafe(`DELETE FROM payment_allocations WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_payments WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_filings WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_export_artifacts WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_allocations WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_ledger_entries WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM monthly_tax_workpapers WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM supplier_tax_profiles WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM evidence_links WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_adjustments WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_treatment_decisions WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM expense_evidence WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM management_expenses WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM f931_lines WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM f931_runs WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_components WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_voucher_lines WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM fiscal_vouchers WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_rows WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM import_batches WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_obligations WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_periods WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM taxpayer_profile_versions WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM client_activities WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`);
    await tx.$executeRawUnsafe(`ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`);
  });
}

beforeEach(async () => {
  await setupMembership();
  await cleanupIngestion();
  await setupFiscalContext();
});

describe("G2-01/02/10 lote de importación ARCA", () => {
  it("crea lote idempotente (mismo fileHash no duplica)", async () => {
    const first = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileName: "libro-iva-2026-01.csv",
      fileHash: "sha256:abc",
    });
    const second = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileName: "libro-iva-2026-01.csv",
      fileHash: "sha256:abc",
    });
    expect(second.id).toBe(first.id);
  });

  it("valida un lote y deja visibles las filas con error", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:val1",
    });
    const result = await ingestion.validateBatch(ctxOwner, batch.id, [
      { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "1", cuit: "20111111111", issuedOn: "2026-01-10", net: "100000.00", hasIva: true, iva21: "21000.00" },
      { direction: "SALE", letter: "X", pointOfSale: "0001", numberFrom: "2", cuit: "bad", issuedOn: "2026-01-11", net: "1000", hasIva: true },
    ]);
    expect(result.totals.validRows).toBe(1);
    expect(result.totals.errorRows).toBe(1);

    const rows = await ingestion.listBatchRows(ctxOwner, batch.id);
    expect(rows).toHaveLength(2);
    const errorRow = rows.find((r) => r.status === "ERROR");
    expect(errorRow?.errors.join(",")).toContain("CUIT_INVALID");
  });

  it("observa filas cuya fecha no pertenece al período declarado", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:period-mismatch",
    });
    const result = await ingestion.validateBatch(ctxOwner, batch.id, [
      {
        direction: "SALE",
        letter: "A",
        pointOfSale: "0001",
        numberFrom: "3",
        cuit: "20111111111",
        issuedOn: "2026-02-01",
        net: "1000",
        hasIva: true,
        iva21: "210",
      },
    ]);
    expect(result.totals).toMatchObject({ validRows: 0, errorRows: 1, net: "0.0000" });
    const rows = await ingestion.listBatchRows(ctxOwner, batch.id);
    expect(rows[0]?.errors).toContain("PERIOD_MISMATCH");
  });

  it("commit convierte filas válidas en vouchers y es idempotente", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:commit1",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "100", cuit: "20111111111", issuedOn: "2026-01-10", net: "100000.00", hasIva: true, iva21: "21000.00" },
    ]);
    const committed = await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");
    expect(committed.committed).toBe(1);
    expect(committed.errors).toHaveLength(0);

    // Reintento: no duplica.
    const again = await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");
    expect(again.committed).toBe(0);
    expect(again.duplicates).toBe(0);

    const vouchers = await ingestion.listVouchers(ctxOwner, CLIENT_ING);
    expect(vouchers).toHaveLength(1);
    expect(vouchers[0]?.components).toHaveLength(2);
    expect(vouchers[0]?.total.toString()).toBe("121000");
  });

  it("rechaza commit de un lote con errores (no oculta filas fuera)", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:err1",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { letter: "X", pointOfSale: "0001", numberFrom: "1", cuit: "bad", issuedOn: "2026-01-10", net: "1000", hasIva: true },
    ]);
    await expect(ingestion.commitBatch(ctxOwner, batch.id, "20999999999")).rejects.toThrow(ImportError);
  });

  it("G2-05 reconcilia el lote contra los vouchers comiteados", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:rec1",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "200", cuit: "20111111111", issuedOn: "2026-01-10", net: "100000.00", hasIva: true, iva21: "21000.00" },
    ]);
    await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");
    const rec = await ingestion.reconcileBatch(ctxOwner, batch.id);
    expect(rec.reconciled).toBe(true);
    expect(rec.normalizedNet).toBe("100000");
    expect(rec.normalizedIva).toBe("21000");
  });
});

describe("G2-03 retenciones y percepciones", () => {
  it("importa un lote de retenciones y percepciones", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA_RET",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_RET_V1",
      fileHash: "sha256:ret1",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { cuitResponsable: "20111111111", cuitAgente: "30555555550", concept: "IVA", base: "100000", amount: "2100", tipo: "RETENCION", issuedOn: "2026-01-20" },
      { cuitResponsable: "20111111111", cuitAgente: "30555555550", concept: "IIBB", base: "50000", amount: "1250", tipo: "PERCEPCION", issuedOn: "2026-01-25" },
    ]);
    const committed = await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");
    expect(committed.committed).toBe(2);
  });
});

describe("F1.2 F.931", () => {
  it("normaliza y confirma remuneraciones en un subledger trazable", async () => {
    const batch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "F931",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "F931_V1",
      fileHash: "sha256:f931-1",
    });
    const validation = await ingestion.validateBatch(ctxPreparer, batch.id, [
      { cuit: "20111111111", remuneration: "100000", deduction: "10000" },
      { cuit: "20222222222", remuneration: "80000", deduction: "5000" },
    ]);
    expect(validation.totals.errorRows).toBe(0);

    const committed = await ingestion.commitBatch(ctxPreparer, batch.id, "20999999998");
    expect(committed.committed).toBe(2);

    const run = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.f931Run.findUnique({ where: { importBatchId: batch.id }, include: { lines: true } }),
    );
    expect(run?.totalRemuneration.toString()).toBe("180000");
    expect(run?.deduction.toString()).toBe("15000");
    expect(run?.netRemuneration.toString()).toBe("165000");
    expect(run?.lines).toHaveLength(2);
  });
});

describe("F1.2 evidencia del expediente mensual", () => {
  it("vincula, revisa y usa el lote para la cobertura obligatoria", async () => {
    const exact = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      const baseRegime = await tx.taxRegime.findUnique({
        where: { code: "RI-ING" },
      });
      if (!baseRegime) throw new Error("Falta el régimen base del fixture");
      const taxType = await tx.taxType.upsert({
        where: { code: "IVA" },
        update: {},
        create: { code: "IVA", name: "IVA" },
      });
      const regime = await tx.taxRegime.upsert({
        where: { code: "RI" },
        update: {},
        create: {
          code: "RI",
          name: "Responsable Inscripto",
          taxTypeId: taxType.id,
          jurisdictionId: baseRegime.jurisdictionId,
          authorityId: baseRegime.authorityId,
        },
      });
      const profile = await tx.taxpayerProfileVersion.findFirstOrThrow({
        where: { clientId: CLIENT_ING, status: "ACTIVE" },
      });
      const period = await tx.taxPeriod.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ING,
          taxTypeId: taxType.id,
          startDate: new Date("2026-01-01"),
          endDate: new Date("2026-01-31"),
          label: "Enero 2026 IVA",
        },
      });
      await tx.taxObligation.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ING,
          profileVersionId: profile.id,
          regimeId: regime.id,
          periodId: period.id,
          status: "WAITING_INPUTS",
        },
      });
      return { taxTypeId: taxType.id, periodId: period.id };
    });

    const workpaper = await workpapers.create(ctxPreparer, {
      clientId: CLIENT_ING,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    const batch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: exact.taxTypeId,
      periodId: exact.periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:wp-sales-1",
      workpaperId: workpaper.id,
      sourceCode: "ARCA_IVA_SALES",
    });
    await ingestion.validateBatch(ctxPreparer, batch.id, [
      {
        direction: "SALE",
        letter: "A",
        pointOfSale: "0001",
        numberFrom: "700",
        cuit: "20111111111",
        issuedOn: "2026-01-10",
        net: "100000",
        hasIva: true,
        iva21: "21000",
      },
    ]);
    await ingestion.commitBatch(ctxPreparer, batch.id, "20999999998");

    const before = await workpapers.coverage(ctxPreparer, workpaper.id);
    const salesBefore = before.sources.find((source) => source.code === "ARCA_IVA_SALES");
    expect(salesBefore?.present).toBe(false);
    const sourceLinkId = salesBefore?.batches[0]?.id;
    expect(sourceLinkId).toBeTruthy();
    await expect(
      workpapers.reviewSource(ctxPreparer, workpaper.id, sourceLinkId!),
    ).rejects.toMatchObject({ code: "MAKER_CHECKER_VIOLATION" });

    await workpapers.reviewSource(ctxReviewer, workpaper.id, sourceLinkId!);
    const after = await workpapers.coverage(ctxReviewer, workpaper.id);
    expect(after.sources.find((source) => source.code === "ARCA_IVA_SALES")?.present).toBe(true);
    expect(after.sources.find((source) => source.code === "ARCA_IVA_PURCHASES")?.present).toBe(false);

    const row = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.importRow.findFirstOrThrow({ where: { batchId: batch.id } }),
    );
    const voucher = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.fiscalVoucher.findUniqueOrThrow({ where: { id: row.voucherId! } }),
    );
    expect(voucher.status).toBe("APPROVED");
    await expect(workpapers.calculate(ctxPreparer, workpaper.id)).rejects.toMatchObject({
      code: "SOURCE_NOT_REVIEWED",
    });

    const purchasesBatch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: exact.taxTypeId,
      periodId: exact.periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:wp-purchases-1",
      workpaperId: workpaper.id,
      sourceCode: "ARCA_IVA_PURCHASES",
    });
    await ingestion.validateBatch(ctxPreparer, purchasesBatch.id, [
      {
        direction: "PURCHASE",
        letter: "A",
        pointOfSale: "0001",
        numberFrom: "701",
        cuit: "20333333333",
        issuedOn: "2026-01-12",
        net: "50000",
        hasIva: true,
        iva21: "10500",
      },
      {
        direction: "PURCHASE",
        letter: "NC",
        pointOfSale: "0001",
        numberFrom: "702",
        cuit: "20333333333",
        issuedOn: "2026-01-18",
        net: "5000",
        hasIva: true,
        iva21: "1050",
      },
    ]);
    await ingestion.commitBatch(ctxPreparer, purchasesBatch.id, "20999999998");
    const withPurchases = await workpapers.coverage(ctxReviewer, workpaper.id);
    const purchasesLink = withPurchases.sources.find(
      (source) => source.code === "ARCA_IVA_PURCHASES",
    )?.batches[0]?.id;
    await workpapers.reviewSource(ctxReviewer, workpaper.id, purchasesLink!);

    const classifications = await workpapers.listClassifications(ctxPreparer, workpaper.id);
    expect(classifications.pending).toBe(3);
    await expect(workpapers.calculate(ctxPreparer, workpaper.id)).rejects.toMatchObject({
      code: "CLASSIFICATION_INCOMPLETE",
    });

    const sale = classifications.items.find((item) => item.direction === "SALE");
    const purchase = classifications.items.find((item) => item.direction === "PURCHASE");
    expect(sale).toBeTruthy();
    expect(purchase).toBeTruthy();
    expect(
      classifications.items.some(
        (item) => item.direction === "PURCHASE" && item.documentKind === "CREDIT_NOTE",
      ),
    ).toBe(true);
    await workpapers.classifyVoucher(ctxPreparer, workpaper.id, sale!.id, {
      activityCode: "TRANSPORTE_AUTOMOTOR",
    });
    const classified = await workpapers.classifyVoucher(
      ctxPreparer,
      workpaper.id,
      purchase!.id,
      { categoryCode: "SUPER", activityCode: "MINIMERCADOS" },
    );
    expect(classified.ready).toBe(true);
    expect(classified.pending).toBe(0);

    const profile = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.supplierTaxProfile.findFirstOrThrow({
        where: { clientId: CLIENT_ING, cuitNormalized: "20333333333", status: "ACTIVE" },
      }),
    );
    expect(profile.categoryCode).toBe("SUPER");

    const ready = await workpapers.get(ctxReviewer, workpaper.id);
    expect(ready?.status).toBe("READY_TO_CALCULATE");

    const creditsBatch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "ARCA_RET",
      taxTypeId: exact.taxTypeId,
      periodId: exact.periodId,
      adapterVersion: "ARCA_RET_V1",
      fileHash: "sha256:wp-sicore-1",
      workpaperId: workpaper.id,
      sourceCode: "SICORE_IVA",
    });
    await ingestion.validateBatch(ctxPreparer, creditsBatch.id, [
      {
        kind: "RETENCION",
        cuitResponsable: "20999999998",
        cuitAgente: "30555555550",
        concept: "IVA",
        base: "100000",
        amount: "2100",
        issuedOn: "2026-01-20",
        certificateNumber: "RET-001",
      },
      {
        kind: "PERCEPCION",
        cuitResponsable: "20999999998",
        cuitAgente: "30666666660",
        concept: "IVA",
        base: "20000",
        amount: "500",
        documentKind: "NOTA DE CREDITO",
        issuedOn: "2026-01-22",
        certificateNumber: "PER-NC-001",
      },
    ]);
    await ingestion.commitBatch(ctxPreparer, creditsBatch.id, "20999999998");
    const creditCoverage = await workpapers.coverage(ctxReviewer, workpaper.id);
    const creditsLink = creditCoverage.sources.find(
      (source) => source.code === "SICORE_IVA",
    )?.batches[0]?.id;
    await workpapers.reviewSource(ctxReviewer, workpaper.id, creditsLink!);

    const allocations = await workpapers.listAllocations(ctxPreparer, workpaper.id);
    expect(allocations.ready).toBe(true);
    expect(allocations.allocated).toBe(2);
    expect(allocations.items.map((item) => item.amount.toFixed(4)).sort()).toEqual([
      "-500.0000",
      "2100.0000",
    ]);
    expect(allocations.items.every((item) => item.obligationId)).toBe(true);
    expect(allocations.items.every((item) => item.jurisdictionId)).toBe(true);

    const payrollBatch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "F931",
      taxTypeId: exact.taxTypeId,
      periodId: exact.periodId,
      adapterVersion: "F931_V1",
      fileHash: "sha256:wp-f931-1",
      workpaperId: workpaper.id,
      sourceCode: "F931",
    });
    await ingestion.validateBatch(ctxPreparer, payrollBatch.id, [
      { cuit: "20111111111", remuneration: "60000", deduction: "10000" },
    ]);
    await ingestion.commitBatch(ctxPreparer, payrollBatch.id, "20999999998");
    const payrollLink = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.workpaperImportBatch.findUniqueOrThrow({
        where: {
          workpaperId_importBatchId: {
            workpaperId: workpaper.id,
            importBatchId: payrollBatch.id,
          },
        },
      }),
    );
    await workpapers.reviewSource(ctxReviewer, workpaper.id, payrollLink.id);
    const payroll = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.f931Run.findUniqueOrThrow({ where: { importBatchId: payrollBatch.id } }),
    );
    expect(payroll).toMatchObject({ status: "REVIEWED", reviewedByUserId: REVIEWER_A });
    expect(payroll.netRemuneration.toFixed(4)).toBe("50000.0000");
  });

  it("exige jurisdicción en CM y conserva una reimputación manual", async () => {
    const exact = await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      const baseRegime = await tx.taxRegime.findUnique({ where: { code: "RI-ING" } });
      if (!baseRegime) throw new Error("Falta el régimen base del fixture");
      const taxType = await tx.taxType.upsert({
        where: { code: "IIBB" },
        update: {},
        create: { code: "IIBB", name: "Ingresos Brutos" },
      });
      const regime = await tx.taxRegime.upsert({
        where: { code: "CM_ART2" },
        update: {},
        create: {
          code: "CM_ART2",
          name: "Convenio Multilateral artículo 2",
          taxTypeId: taxType.id,
          jurisdictionId: baseRegime.jurisdictionId,
          authorityId: baseRegime.authorityId,
        },
      });
      const regimeTaxType = await tx.taxType.findUniqueOrThrow({
        where: { id: regime.taxTypeId },
      });
      if (regimeTaxType.code !== "IIBB") {
        throw new Error("CM_ART2 debe pertenecer al impuesto IIBB");
      }
      await Promise.all([
        tx.jurisdiction.upsert({
          where: { code: "TUC" },
          update: {},
          create: { code: "TUC", name: "Tucumán", kind: "PROVINCIAL" },
        }),
        tx.jurisdiction.upsert({
          where: { code: "CBA" },
          update: {},
          create: { code: "CBA", name: "Córdoba", kind: "PROVINCIAL" },
        }),
      ]);
      const profile = await tx.taxpayerProfileVersion.findFirstOrThrow({
        where: { clientId: CLIENT_ING, status: "ACTIVE" },
      });
      const period = await tx.taxPeriod.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ING,
          taxTypeId: regime.taxTypeId,
          startDate: new Date("2026-02-01"),
          endDate: new Date("2026-02-28"),
          label: "Febrero 2026 CM",
        },
      });
      await tx.taxObligation.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ING,
          profileVersionId: profile.id,
          regimeId: regime.id,
          periodId: period.id,
          status: "WAITING_INPUTS",
        },
      });
      return { taxTypeId: regime.taxTypeId, periodId: period.id };
    });

    const workpaper = await workpapers.create(ctxPreparer, {
      clientId: CLIENT_ING,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
    });
    const cmBatch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "CM03",
      taxTypeId: exact.taxTypeId,
      periodId: exact.periodId,
      adapterVersion: "CM03_V1",
      fileHash: "sha256:wp-cm03-1",
      workpaperId: workpaper.id,
      sourceCode: "SIFERE_CM03",
    });
    await ingestion.validateBatch(ctxPreparer, cmBatch.id, [
      { activityCode: "501100", income: "100000" },
      { activityCode: "COEF_TUC", income: "0", coefficient: "0.6" },
      { activityCode: "COEF_CBA", income: "0", coefficient: "0.4" },
    ]);
    await ingestion.commitBatch(ctxPreparer, cmBatch.id, "20999999998");
    const cmLink = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.workpaperImportBatch.findUniqueOrThrow({
        where: {
          workpaperId_importBatchId: {
            workpaperId: workpaper.id,
            importBatchId: cmBatch.id,
          },
        },
      }),
    );
    await workpapers.reviewSource(ctxReviewer, workpaper.id, cmLink.id);

    const invalidBatch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "SIFERE_RPI",
      taxTypeId: exact.taxTypeId,
      periodId: exact.periodId,
      adapterVersion: "ARCA_RET_V1",
      fileHash: "sha256:wp-cm-rpi-invalid",
      workpaperId: workpaper.id,
      sourceCode: "SIFERE_RPI_CM",
    });
    await ingestion.validateBatch(ctxPreparer, invalidBatch.id, [
      {
        kind: "RETENCION",
        cuitResponsable: "20999999998",
        cuitAgente: "30555555550",
        concept: "IIBB",
        base: "100000",
        amount: "2500",
        issuedOn: "2026-02-18",
        certificateNumber: "CM-SIN-JUR",
      },
    ]);
    await ingestion.commitBatch(ctxPreparer, invalidBatch.id, "20999999998");
    const invalidLink = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.workpaperImportBatch.findUniqueOrThrow({
        where: {
          workpaperId_importBatchId: {
            workpaperId: workpaper.id,
            importBatchId: invalidBatch.id,
          },
        },
      }),
    );
    await expect(
      workpapers.reviewSource(ctxReviewer, workpaper.id, invalidLink.id),
    ).rejects.toMatchObject({ code: "ALLOCATION_SCOPE_INVALID" });

    const validBatch = await ingestion.createBatch(ctxPreparer, {
      clientId: CLIENT_ING,
      origin: "SIFERE_RPI",
      taxTypeId: exact.taxTypeId,
      periodId: exact.periodId,
      adapterVersion: "ARCA_RET_V1",
      fileHash: "sha256:wp-cm-rpi-valid",
      workpaperId: workpaper.id,
      sourceCode: "SIFERE_RPI_CM",
    });
    await ingestion.validateBatch(ctxPreparer, validBatch.id, [
      {
        kind: "PERCEPCION",
        cuitResponsable: "20999999998",
        cuitAgente: "30666666660",
        concept: "IIBB",
        base: "80000",
        amount: "1600",
        issuedOn: "2026-02-20",
        certificateNumber: "CM-TUC-001",
        jurisdiction: "TUC",
      },
    ]);
    await ingestion.commitBatch(ctxPreparer, validBatch.id, "20999999998");
    const validLink = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.workpaperImportBatch.findUniqueOrThrow({
        where: {
          workpaperId_importBatchId: {
            workpaperId: workpaper.id,
            importBatchId: validBatch.id,
          },
        },
      }),
    );
    await workpapers.reviewSource(ctxReviewer, workpaper.id, validLink.id);

    const before = await workpapers.listAllocations(ctxPreparer, workpaper.id);
    expect(before).toMatchObject({ total: 1, allocated: 1, pending: 0, ready: true });
    expect(before.items[0]?.allocatedJurisdiction?.code).toBe("TUC");

    const reallocated = await workpapers.reallocateInput(
      ctxPreparer,
      workpaper.id,
      before.items[0]!.id,
      { jurisdiction: "CBA" },
    );
    expect(reallocated.items).toHaveLength(1);
    expect(reallocated.items[0]?.allocatedJurisdiction?.code).toBe("CBA");

    const persisted = await workpapers.listAllocations(ctxReviewer, workpaper.id);
    expect(persisted.items).toHaveLength(1);
    expect(persisted.items[0]?.allocatedJurisdiction?.code).toBe("CBA");
  });
});

describe("G2-04/09 voucher manual y maker-checker", () => {
  it("crea un voucher manual con componentes", async () => {
    const voucher = await ingestion.createVoucher(ctxOwner, {
      clientId: CLIENT_ING,
      direction: "SALE",
      type: "A",
      letter: "A",
      pointOfSale: 1,
      number: 500,
      issuerCuit: "20999999999",
      receiverCuit: "20111111111",
      issuedOn: "2026-01-15",
      total: "121000.00",
      components: [
        { concept: "NETO", base: "100000.00", amount: "100000.00" },
        { concept: "IVA_21", base: "100000.00", rate: "0.21", amount: "21000.00" },
      ],
    });
    expect(voucher.status).toBe("DRAFT");
    expect(voucher.components).toHaveLength(2);
  });

  it("el preparador no puede revisar su propio voucher (maker-checker)", async () => {
    const voucher = await ingestion.createVoucher(ctxPreparer, {
      clientId: CLIENT_ING,
      direction: "PURCHASE",
      type: "A",
      pointOfSale: 1,
      number: 700,
      issuerCuit: "20111111111",
      receiverCuit: "20999999999",
      issuedOn: "2026-01-18",
      total: "1210.00",
      components: [{ concept: "NETO", base: "1000.00", amount: "1000.00" }],
    });
    await expect(ingestion.reviewVoucher(ctxPreparer, voucher.id, true)).rejects.toThrow(ImportError);

    const approved = await ingestion.reviewVoucher(ctxReviewer, voucher.id, true);
    expect(approved.status).toBe("APPROVED");
    expect(approved.reviewedByUserId).toBe(REVIEWER_A);
  });

  it("C-2 transiciones separadas: submit-review → approve (maker-checker)", async () => {
    const voucher = await ingestion.createVoucher(ctxPreparer, {
      clientId: CLIENT_ING,
      direction: "PURCHASE",
      type: "A",
      pointOfSale: 1,
      number: 701,
      issuerCuit: "20111111111",
      receiverCuit: "20999999999",
      issuedOn: "2026-01-19",
      total: "1210.00",
      components: [{ concept: "NETO", base: "1000.00", amount: "1000.00" }],
    });

    // Preparador lo envía a revisión.
    const inReview = await ingestion.submitVoucherForReview(ctxPreparer, voucher.id);
    expect(inReview.status).toBe("IN_REVIEW");

    // Preparador no puede aprobar su propio trabajo.
    await expect(ingestion.approveVoucher(ctxPreparer, voucher.id)).rejects.toThrow(ImportError);

    // Revisor aprueba.
    const approved = await ingestion.approveVoucher(ctxReviewer, voucher.id);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedByUserId).toBe(REVIEWER_A);
  });

  it("C-2 transiciones separadas: submit-review → reject", async () => {
    const voucher = await ingestion.createVoucher(ctxPreparer, {
      clientId: CLIENT_ING,
      direction: "SALE",
      type: "A",
      pointOfSale: 1,
      number: 701,
      issuerCuit: "20999999999",
      receiverCuit: "20111111111",
      issuedOn: "2026-01-20",
      total: "1210.00",
      components: [{ concept: "NETO", base: "1000.00", amount: "1000.00" }],
    });

    // Rechazo directo por revisor (desde DRAFT también es válido).
    await expect(ingestion.rejectVoucher(ctxPreparer, voucher.id)).rejects.toThrow(ImportError);

    const rejected = await ingestion.rejectVoucher(ctxReviewer, voucher.id);
    expect(rejected.status).toBe("REJECTED");
  });

  it("C-3 gastos: submit-for-review → reject", async () => {
    const expense = await expenses.create(ctxOwner, {
      clientId: CLIENT_ING,
      description: "Gasto sin respaldo para rechazar",
      amount: "12000.00",
      incurredOn: "2026-01-10",
      hasFiscalSupport: false,
    });
    // Al crearse con hasFiscalSupport=false ya está PENDING_REVIEW; la transición
    // submit-for-review desde DRAFT cubre el caso manual.
    const rejected = await expenses.reject(ctxOwner, expense.id, "No corresponde");
    expect(rejected.status).toBe("REJECTED");
  });
});

describe("G2-08 gastos gerenciales", () => {
  it("gasto sin respaldo fiscal es MANAGEMENT_ONLY por defecto", async () => {
    const expense = await expenses.create(ctxOwner, {
      clientId: CLIENT_ING,
      description: "Alquiler de salón para evento de clientes",
      amount: "50000.00",
      incurredOn: "2026-01-05",
      hasFiscalSupport: false,
    });
    expect(expense.taxTreatment).toBe("MANAGEMENT_ONLY");
    expect(expense.status).toBe("PENDING_REVIEW");
  });

  it("FISCAL_COMPUTABLE exige regla y revisor distinto", async () => {
    const expense = await expenses.create(ctxOwner, {
      clientId: CLIENT_ING,
      description: "Gasto de gestión con posible cómputo fiscal",
      amount: "10000.00",
      incurredOn: "2026-01-06",
      hasFiscalSupport: false,
    });
    // Sin regla: rechazado.
    await expect(
      expenses.approveTreatment(ctxOwner, {
        expenseId: expense.id,
        treatment: "FISCAL_COMPUTABLE",
        reason: "Quiero computar este gasto",
        reviewedByUserId: REVIEWER_A,
      }),
    ).rejects.toThrow(ExpenseError);

    // Revisor = mismo profesional: rechazado.
    await expect(
      expenses.approveTreatment(ctxOwner, {
        expenseId: expense.id,
        treatment: "MANAGEMENT_ONLY",
        reason: "Decisión con revisor propio (inválido)",
        reviewedByUserId: OWNER_A,
      }),
    ).rejects.toThrow(ExpenseError);

    // Tratamiento válido sin regla (MANAGEMENT_ONLY).
    const ok = await expenses.approveTreatment(ctxOwner, {
      expenseId: expense.id,
      treatment: "MANAGEMENT_ONLY",
      reason: "El gasto no tiene respaldo fiscal suficiente",
      reviewedByUserId: REVIEWER_A,
    });
    expect(ok.status).toBe("APPROVED");
    expect(ok.taxTreatment).toBe("MANAGEMENT_ONLY");
  });
});

describe("G2-02 IIBB DGR Tucumán — adaptador de importación", () => {
  it("valida un lote IIBB con filas por actividad", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "DGR_IIBB",
      taxTypeId: iibbId,
      periodId,
      adapterVersion: "DGR_IIBB_V1",
      fileHash: "sha256:iibb1",
    });
    const result = await ingestion.validateBatch(ctxOwner, batch.id, [
      { activityCode: "501100", income: "100000.00", rate: "4" },
      { activityCode: "502200", income: "50000.00", rate: "4.5" },
      { activityCode: "", income: "1000" },
    ]);
    expect(result.totals.validRows).toBe(2);
    expect(result.totals.errorRows).toBe(1);
    expect(result.totals.net).toBe("150000.0000");
  });

  it("commit IIBB crea vouchers SALE con línea de actividad", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "DGR_IIBB",
      taxTypeId: iibbId,
      periodId,
      adapterVersion: "DGR_IIBB_V1",
      fileHash: "sha256:iibb2",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { activityCode: "501100", income: "100000.00", rate: "4" },
      { activityCode: "502200", income: "50000.00", rate: "4.5" },
    ]);
    const committed = await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");
    expect(committed.committed).toBe(2);

    const vouchers = await ingestion.listVouchers(ctxOwner, CLIENT_ING);
    expect(vouchers).toHaveLength(2);
    // Verificar que el primer voucher tiene línea de actividad.
    const v1 = vouchers.find((v) => v.type === "IIBB_RESUMEN");
    expect(v1).toBeDefined();
    expect(v1?.direction).toBe("SALE");
  });
});

describe("G4 TEM SMT — adaptador de importación", () => {
  it("valida un lote TEM con filas por actividad", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "SMT_TEM",
      taxTypeId: iibbId,
      periodId,
      adapterVersion: "SMT_TEM_V1",
      fileHash: "sha256:tem1",
    });
    const result = await ingestion.validateBatch(ctxOwner, batch.id, [
      { activityCode: "601100", income: "100000.00", rate: "2" },
      { activityCode: "602200", income: "50000.00", rate: "3" },
      { activityCode: "", income: "1000" },
    ]);
    expect(result.totals.validRows).toBe(2);
    expect(result.totals.errorRows).toBe(1);
    expect(result.totals.net).toBe("150000.0000");
  });

  it("commit TEM crea vouchers SALE con línea de actividad", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "SMT_TEM",
      taxTypeId: iibbId,
      periodId,
      adapterVersion: "SMT_TEM_V1",
      fileHash: "sha256:tem2",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { activityCode: "601100", income: "100000.00", rate: "2" },
      { activityCode: "602200", income: "50000.00", rate: "3" },
    ]);
    const committed = await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");
    expect(committed.committed).toBe(2);

    const vouchers = await ingestion.listVouchers(ctxOwner, CLIENT_ING);
    const v1 = vouchers.find((v) => v.type === "TEM_RESUMEN");
    expect(v1).toBeDefined();
    expect(v1?.direction).toBe("SALE");
  });
});

describe("G4 CM03 — adaptador de importación", () => {
  it("valida un lote CM03 con ingresos y coeficientes", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "CM03",
      taxTypeId: iibbId,
      periodId,
      adapterVersion: "CM03_V1",
      fileHash: "sha256:cm1",
    });
    const result = await ingestion.validateBatch(ctxOwner, batch.id, [
      { activityCode: "501100", income: "100000.00" },
      { activityCode: "COEF_TUC", income: "0", coefficient: "0.6" },
      { activityCode: "COEF_CBA", income: "0", coefficient: "0.4" },
    ]);
    expect(result.totals.validRows).toBe(3);
    expect(result.totals.errorRows).toBe(0);
    expect(result.totals.net).toBe("100000.0000");
  });

  it("rechaza un lote CM03 con coeficientes que no suman 1", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "CM03",
      taxTypeId: iibbId,
      periodId,
      adapterVersion: "CM03_V1",
      fileHash: "sha256:cm2",
    });
    const result = await ingestion.validateBatch(ctxOwner, batch.id, [
      { activityCode: "501100", income: "100000.00" },
      { activityCode: "COEF_TUC", income: "0", coefficient: "0.6" },
      { activityCode: "COEF_CBA", income: "0", coefficient: "0.3" },
    ]);
    expect(result.totals.errorRows).toBe(2);
  });

  it("commit CM03 crea vouchers SALE solo para ingresos (no coeficientes)", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "CM03",
      taxTypeId: iibbId,
      periodId,
      adapterVersion: "CM03_V1",
      fileHash: "sha256:cm3",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { activityCode: "501100", income: "100000.00" },
      { activityCode: "COEF_TUC", income: "0", coefficient: "0.6" },
      { activityCode: "COEF_CBA", income: "0", coefficient: "0.4" },
    ]);
    const committed = await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");
    expect(committed.committed).toBe(3);

    const vouchers = await ingestion.listVouchers(ctxOwner, CLIENT_ING);
    const cmVouchers = vouchers.filter((v) => v.type === "CM03_RESUMEN");
    expect(cmVouchers).toHaveLength(1);
    expect(cmVouchers[0]?.direction).toBe("SALE");
  });

  it("C-4 filtra vouchers por rango de fechas (from/to)", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:filter1",
    });
    await ingestion.validateBatch(ctxOwner, batch.id, [
      { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "100", cuit: "20111111111", issuedOn: "2026-01-05", net: "1000.00", hasIva: true, iva21: "210.00" },
    ]);
    await ingestion.commitBatch(ctxOwner, batch.id, "20999999999");

    const februaryPeriod = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.taxPeriod.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ING,
          taxTypeId: ivaId,
          startDate: new Date("2026-02-01"),
          endDate: new Date("2026-02-28"),
          label: "Febrero 2026",
        },
      }),
    );
    const februaryBatch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId: februaryPeriod.id,
      adapterVersion: "ARCA_LIBRO_IVA_V1",
      fileHash: "sha256:filter2",
    });
    await ingestion.validateBatch(ctxOwner, februaryBatch.id, [
      { direction: "SALE", letter: "A", pointOfSale: "0001", numberFrom: "101", cuit: "20111111111", issuedOn: "2026-02-10", net: "2000.00", hasIva: true, iva21: "420.00" },
    ]);
    await ingestion.commitBatch(ctxOwner, februaryBatch.id, "20999999999");

    // Solo enero: el voucher 100 (enero) está, el 101 (febrero) no.
    const jan = await ingestion.listVouchers(ctxOwner, CLIENT_ING, undefined, "2026-01-01", "2026-01-31");
    const janNums = jan.filter((v) => v.type === "A").map((v) => v.number);
    expect(janNums).toContain(100);
    expect(janNums).not.toContain(101);

    // Solo febrero: el voucher 101 (febrero) está, el 100 (enero) no.
    const feb = await ingestion.listVouchers(ctxOwner, CLIENT_ING, undefined, "2026-02-01", "2026-02-28");
    const febNums = feb.filter((v) => v.type === "A").map((v) => v.number);
    expect(febNums).toContain(101);
    expect(febNums).not.toContain(100);
  });
});

describe("Corte 0 — adaptador desconocido (P2/P4)", () => {
  it("responde UNKNOWN_ADAPTER sin escribir filas", async () => {
    const batch = await ingestion.createBatch(ctxOwner, {
      clientId: CLIENT_ING,
      origin: "ARCA",
      taxTypeId: ivaId,
      periodId,
      adapterVersion: "ADAPTADOR_DESCONOCIDO_V1",
      fileHash: "sha256:unknown-adapter",
    });

    const error = await ingestion
      .validateBatch(ctxOwner, batch.id, [
        {
          direction: "SALE",
          letter: "A",
          pointOfSale: "0001",
          numberFrom: "900",
          cuit: "20111111111",
          issuedOn: "2026-01-10",
          net: "1000.00",
          hasIva: true,
          iva21: "210.00",
        },
      ])
      .then(() => null)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ code: "UNKNOWN_ADAPTER" });
    expect((error as ImportError).message).toContain("ADAPTADOR_DESCONOCIDO_V1");
    expect((error as ImportError).message).toContain("ARCA_LIBRO_IVA_V1");

    const rows = await ingestion.listBatchRows(ctxOwner, batch.id);
    expect(rows).toHaveLength(0);
    const stored = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.importBatch.findUnique({ where: { id: batch.id } }),
    );
    expect(stored?.status).toBe("UPLOADED");
    expect(stored?.totalRows).toBe(0);
  });
});
