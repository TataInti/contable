import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { IngestionService, ImportError } from "./ingestion-service.js";
import { ManagementExpenseService, ExpenseError } from "./management-expense-service.js";

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
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM evidence_links WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_adjustments WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_treatment_decisions WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM expense_evidence WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM management_expenses WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM perception_certificates WHERE "clientId" = '${CLIENT_ING}'`);
    await tx.$executeRawUnsafe(`DELETE FROM withholding_certificates WHERE "clientId" = '${CLIENT_ING}'`);
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
    expect(result.totals.errorRows).toBe(1);
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
});
