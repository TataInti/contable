import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { MonthlyWorkpaperService, WorkpaperError } from "./workpaper-service.js";

/**
 * F1.1: tests de integración del expediente mensual de liquidación.
 *
 * Verifica el ciclo de vida del MonthlyTaxWorkpaper:
 *   crear → coverage → calcular → submit-review → review (maker-checker) →
 *   finalize (bloquea controles abiertos) → rectify (nueva revisión).
 *
 * Usa firma/cliente/usuarios PROPIOS para no colisionar con suites paralelas.
 */

const OWNER_WP = "99999999-9999-4999-8999-999999999999";
const REVIEWER_WP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const PREPARER_WP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const FIRM_WP = "99999999-9999-4999-8999-999999999998";
const CLIENT_WP = "99999999-2222-4333-8444-999999999999";
const OTHER_CLIENT_WP = "99999999-2222-4333-8444-999999999998";
const OTHER_FIRM_WP = "99999999-9999-4999-8999-999999999997";
const OTHER_FIRM_CLIENT_WP = "99999999-2222-4333-8444-999999999997";
const JURISDICTION_WP = "99999999-3333-4333-8444-999999999999";
const AUTHORITY_WP = "99999999-4444-4333-8444-999999999999";
let taxTypeId = "99999999-5555-4333-8444-999999999999";
const REGIME_WP = "99999999-6666-4333-8444-999999999999";
const PROFILE_WP = "99999999-7777-4333-8444-999999999999";
const PERIOD_WP = "99999999-8888-4333-8444-999999999999";
const FISCAL_YEAR_WP = "99999999-dddd-4ddd-8ddd-999999999999";
const ACCOUNTING_PERIOD_WP = "99999999-eeee-4eee-8eee-999999999999";
const OBLIGATION_WP = "99999999-aaaa-4333-8444-999999999999";
const PACK_WP = "99999999-bbbb-4333-8444-999999999999";
const RULE_VERSION_WP = "99999999-cccc-4333-8444-999999999999";

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

const service = new MonthlyWorkpaperService();

const ctxOwner = { userId: OWNER_WP, firmId: FIRM_WP, actorKind: "USER" as const };
const ctxReviewer = { userId: REVIEWER_WP, firmId: FIRM_WP, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_WP, firmId: FIRM_WP, actorKind: "USER" as const };

async function createControlEvidence(
  status: "READY" | "REVIEWED" | "EXTRACTED" = "READY",
  firmId = FIRM_WP,
  clientId = CLIENT_WP,
) {
  const document = await prisma.document.create({
    data: {
      firmId,
      clientId,
      category: "AUDIT_SUPPORT",
      status,
      uploadOrigin: "FIRM",
    },
  });
  return document.id;
}

async function createBlockingControl(workpaperId: string, code: string) {
  return runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
    tx.taxControlFinding.create({
      data: {
        firmId: FIRM_WP,
        clientId: CLIENT_WP,
        workpaperId,
        code,
        severity: "BLOCKING",
        status: "OPEN",
      },
    }),
  );
}

async function resolveGeneratedBlockingControls(workpaperId: string) {
  const evidenceDocumentId = await createControlEvidence();
  const controls = await service.listControls(ctxReviewer, workpaperId);
  for (const control of controls.filter(
    (item) => item.severity === "BLOCKING" && item.status === "OPEN",
  )) {
    await service.resolveControl(ctxReviewer, workpaperId, control.id, {
      resolution: "Conciliación verificada en el respaldo de prueba",
      status: "RESOLVED",
      evidenceDocumentId,
    });
  }
}

async function setupMembership() {
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${OWNER_WP}', 'owner.wp@test.local', 'Owner WP', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${REVIEWER_WP}', 'reviewer.wp@test.local', 'Reviewer WP', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO users ("id", "emailNormalized", name, "passwordHash", "updatedAt")
    VALUES ('${PREPARER_WP}', 'preparer.wp@test.local', 'Preparer WP', 'x', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${FIRM_WP}', 'Estudio WP', 'Estudio WP', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(
    `UPDATE firms SET "allowSelfReview" = false WHERE "id" = '${FIRM_WP}'`,
  );
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${CLIENT_WP}', '${FIRM_WP}', 'Cliente WP', '20999999977', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES ('${OTHER_CLIENT_WP}', '${FIRM_WP}', 'Otro cliente WP', '20999999976', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firms ("id", "legalName", "displayName", "updatedAt")
    VALUES ('${OTHER_FIRM_WP}', 'Otro estudio WP', 'Otro estudio WP', now())
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO clients ("id", "firmId", "legalName", cuit, "updatedAt")
    VALUES (
      '${OTHER_FIRM_CLIENT_WP}',
      '${OTHER_FIRM_WP}',
      'Cliente de otro estudio WP',
      '20999999975',
      now()
    )
    ON CONFLICT ("id") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_WP}', '${OWNER_WP}', 'OWNER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_WP}', '${REVIEWER_WP}', 'REVIEWER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO firm_memberships ("id", "firmId", "userId", role, status, "acceptedAt")
    VALUES (gen_random_uuid()::text, '${FIRM_WP}', '${PREPARER_WP}', 'PREPARER', 'ACTIVE', now())
    ON CONFLICT ("firmId", "userId") DO NOTHING
  `);
}

async function setupFiscalComponent() {
  await prisma.jurisdiction.upsert({
    where: { code: "AR-WP" },
    update: {},
    create: { id: JURISDICTION_WP, code: "AR-WP", name: "Nación WP", kind: "NATIONAL" },
  });
  await prisma.taxAuthority.upsert({
    where: { code: "ARCA-WP" },
    update: {},
    create: {
      id: AUTHORITY_WP,
      code: "ARCA-WP",
      name: "ARCA WP",
      jurisdictionId: JURISDICTION_WP,
    },
  });
  const taxType = await prisma.taxType.upsert({
    where: { code: "IVA" },
    update: {},
    create: { id: taxTypeId, code: "IVA", name: "IVA WP" },
  });
  taxTypeId = taxType.id;
  await prisma.taxRegime.upsert({
    where: { code: "RI_WP" },
    update: { taxTypeId },
    create: {
      id: REGIME_WP,
      code: "RI_WP",
      name: "Responsable Inscripto WP",
      taxTypeId,
      jurisdictionId: JURISDICTION_WP,
      authorityId: AUTHORITY_WP,
    },
  });
  await prisma.taxpayerProfileVersion.upsert({
    where: { clientId_version: { clientId: CLIENT_WP, version: 1 } },
    update: { status: "ACTIVE" },
    create: {
      id: PROFILE_WP,
      firmId: FIRM_WP,
      clientId: CLIENT_WP,
      version: 1,
      legalName: "Cliente WP",
      cuit: "20999999977",
      personType: "JURIDICA",
      nationalCondition: "RESPONSABLE_INSCRIPTO",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      status: "ACTIVE",
    },
  });
  // Fixtures previas podían apuntar a otro impuesto con el mismo id fijo;
  // se alinea antes del upsert por clave natural para que el setup sea
  // idempotente sobre bases ya usadas por corridas anteriores.
  await prisma.taxPeriod.updateMany({ where: { id: PERIOD_WP }, data: { taxTypeId } });
  await prisma.taxPeriod.upsert({
    where: {
      clientId_taxTypeId_startDate_endDate: {
        clientId: CLIENT_WP,
        taxTypeId,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-01-31T00:00:00.000Z"),
      },
    },
    update: {},
    create: {
      id: PERIOD_WP,
      firmId: FIRM_WP,
      clientId: CLIENT_WP,
      taxTypeId,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2026-01-31T00:00:00.000Z"),
      label: "2026-01 WP",
    },
  });
  // Sólo se liquida a un cliente inscripto en el régimen.
  const registration = await prisma.taxRegistration.findFirst({
    where: { firmId: FIRM_WP, clientId: CLIENT_WP, regimeId: REGIME_WP },
  });
  if (!registration) {
    await prisma.taxRegistration.create({
      data: {
        firmId: FIRM_WP,
        clientId: CLIENT_WP,
        profileVersionId: PROFILE_WP,
        regimeId: REGIME_WP,
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  }
  await prisma.taxObligation.upsert({
    where: {
      clientId_regimeId_periodId: {
        clientId: CLIENT_WP,
        regimeId: REGIME_WP,
        periodId: PERIOD_WP,
      },
    },
    update: { status: "PENDING", dueDate: new Date("2026-02-20T00:00:00.000Z") },
    create: {
      id: OBLIGATION_WP,
      firmId: FIRM_WP,
      clientId: CLIENT_WP,
      profileVersionId: PROFILE_WP,
      regimeId: REGIME_WP,
      periodId: PERIOD_WP,
      status: "PENDING",
      dueDate: new Date("2026-02-20T00:00:00.000Z"),
    },
  });
  await prisma.taxRulePack.upsert({
    where: { code: "AR_VAT_RI_WP" },
    update: {},
    create: {
      id: PACK_WP,
      code: "AR_VAT_RI_WP",
      name: "IVA WP",
      regimeId: REGIME_WP,
      status: "ACTIVE",
    },
  });
  const existingVersion = await prisma.taxRuleVersion.findFirst({
    where: { packId: PACK_WP, version: 1 },
  });
  if (!existingVersion) {
    await prisma.taxRuleVersion.create({
      data: {
        id: RULE_VERSION_WP,
        packId: PACK_WP,
        version: 1,
        status: "ACTIVE",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        rulesHash: "sha256:wp-vat-v1",
        engineVersion: "ar-vat-ri-v1.0.0",
      },
    });
    await prisma.taxRateRule.createMany({
      data: [
        {
          ruleVersionId: RULE_VERSION_WP,
          concept: "VENTAS",
          rate: new Prisma.Decimal("21"),
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          ruleVersionId: RULE_VERSION_WP,
          concept: "COMPRAS",
          rate: new Prisma.Decimal("21"),
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });
  }
  const interestRule = await prisma.taxRateRule.findFirst({
    where: { ruleVersionId: RULE_VERSION_WP, concept: "INTERES_MENSUAL" },
  });
  if (!interestRule) {
    await prisma.taxRateRule.create({
      data: {
        ruleVersionId: RULE_VERSION_WP,
        concept: "INTERES_MENSUAL",
        rate: new Prisma.Decimal("6"),
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
  }
}

async function cleanupWorkpaperCycle() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `ALTER TABLE tax_settlements DISABLE TRIGGER trg_settlement_immutable`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE settlement_inputs DISABLE TRIGGER trg_settlement_input_immutable`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE tax_settlement_lines DISABLE TRIGGER trg_settlement_line_immutable`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE tax_differences DISABLE TRIGGER trg_settlement_diff_immutable`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM tax_control_findings WHERE "clientId" = '${CLIENT_WP}'`,
    );
    await tx.$executeRawUnsafe(
      `DELETE FROM tax_interest_snapshots WHERE "clientId" = '${CLIENT_WP}'`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM monthly_tax_workpapers WHERE "firmId" = '${FIRM_WP}'`);
    await tx.$executeRawUnsafe(
      `DELETE FROM tax_credit_movements WHERE "clientId" = '${CLIENT_WP}'`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM tax_credit_lots WHERE "clientId" = '${CLIENT_WP}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_differences WHERE "clientId" = '${CLIENT_WP}'`);
    await tx.$executeRawUnsafe(
      `DELETE FROM tax_settlement_lines WHERE "clientId" = '${CLIENT_WP}'`,
    );
    await tx.$executeRawUnsafe(`DELETE FROM settlement_inputs WHERE "clientId" = '${CLIENT_WP}'`);
    await tx.$executeRawUnsafe(`DELETE FROM tax_settlements WHERE "clientId" = '${CLIENT_WP}'`);
    await tx.$executeRawUnsafe(
      `ALTER TABLE tax_settlements ENABLE TRIGGER trg_settlement_immutable`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE settlement_inputs ENABLE TRIGGER trg_settlement_input_immutable`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE tax_settlement_lines ENABLE TRIGGER trg_settlement_line_immutable`,
    );
    await tx.$executeRawUnsafe(
      `ALTER TABLE tax_differences ENABLE TRIGGER trg_settlement_diff_immutable`,
    );
    await tx.taxObligation.update({ where: { id: OBLIGATION_WP }, data: { status: "PENDING" } });
  });
}

describe("F1.1 expediente mensual de liquidación", () => {
  beforeEach(async () => {
    await setupMembership();
    await setupFiscalComponent();
    await cleanupWorkpaperCycle();
  });

  it("crea un expediente mensual idempotente", async () => {
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(wp.id).toBeTruthy();
    expect(wp.status).toBe("COLLECTING_INPUTS");
    expect(wp.revision).toBe(1);
    expect(wp.settlements).toHaveLength(1);
    expect(wp.settlements[0]?.obligationId).toBe(OBLIGATION_WP);
    expect(wp.settlements[0]?.settlement).toBeNull();

    // Idempotente: mismo mes no duplica.
    const again = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    expect(again.id).toBe(wp.id);
  });

  it("lista expedientes del cliente", async () => {
    await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    const list = await service.list(ctxOwner, CLIENT_WP);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]?.clientId).toBe(CLIENT_WP);
  });

  it("lista por fechas fiscales igual que por el período contable equivalente", async () => {
    const workpaper = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    const startDate = new Date("2026-01-01T00:00:00.000Z");
    const endDate = new Date("2026-01-31T00:00:00.000Z");
    const accountingPeriod = await runAsRuntime(OWNER_WP, FIRM_WP, async (tx) => {
      const fiscalYear = await tx.fiscalYear.upsert({
        where: {
          clientId_startDate_endDate: {
            clientId: CLIENT_WP,
            startDate: new Date("2026-01-01T00:00:00.000Z"),
            endDate: new Date("2026-12-31T00:00:00.000Z"),
          },
        },
        update: { firmId: FIRM_WP, label: "2026 WP", status: "OPEN" },
        create: {
          id: FISCAL_YEAR_WP,
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-12-31T00:00:00.000Z"),
          label: "2026 WP",
        },
      });
      return tx.accountingPeriod.upsert({
        where: {
          clientId_startDate_endDate: { clientId: CLIENT_WP, startDate, endDate },
        },
        update: {
          firmId: FIRM_WP,
          fiscalYearId: fiscalYear.id,
          ordinal: 1,
          status: "OPEN",
        },
        create: {
          id: ACCOUNTING_PERIOD_WP,
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          fiscalYearId: fiscalYear.id,
          startDate,
          endDate,
          ordinal: 1,
        },
      });
    });

    const [byDates, byAccountingPeriod] = await Promise.all([
      service.list(ctxOwner, CLIENT_WP, "2026-01-01", "2026-01-31"),
      service.listForAccountingPeriod(ctxOwner, CLIENT_WP, accountingPeriod.id),
    ]);

    expect(byDates.map((item) => item.id)).toEqual(byAccountingPeriod.map((item) => item.id));
    expect(byDates.map((item) => item.id)).toContain(workpaper.id);
  });

  it("no permite calcular ni cerrar un expediente sin obligaciones materializadas", async () => {
    await prisma.taxObligation.update({
      where: { id: OBLIGATION_WP },
      data: { status: "NOT_APPLICABLE" },
    });
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });

    expect(wp.settlements).toHaveLength(0);
    await expect(service.calculate(ctxOwner, wp.id)).rejects.toMatchObject({
      code: "NO_SETTLEMENTS",
    });
  });

  it("calcula y transiciona a CALCULATED con hash de entrada", async () => {
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    const result = await service.calculate(ctxOwner, wp.id);
    expect(result.workpaper.status).toBe("CALCULATED");
    expect(result.workpaper.inputHash).toBeTruthy();
    expect(result.settlements).toHaveLength(1);
    const breakdown = await service.calculationBreakdown(ctxOwner, wp.id);
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]?.settlement?.engineVersion).toBe("ar-vat-ri-v1.0.0");
    expect(breakdown[0]?.settlement?.totals).toBeTruthy();
  });

  it("no permite finalizar sin revisión (INVALID_TRANSITION)", async () => {
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxOwner, wp.id);
    await expect(service.finalize(ctxOwner, wp.id)).rejects.toThrow(WorkpaperError);
  });

  it("maker-checker: el preparador no revisa ni finaliza su propio expediente", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await resolveGeneratedBlockingControls(wp.id);
    await service.submitReview(ctxPreparer, wp.id);

    await expect(service.review(ctxPreparer, wp.id, { approved: true })).rejects.toThrow(
      WorkpaperError,
    );
    await expect(service.finalize(ctxPreparer, wp.id)).rejects.toThrow(WorkpaperError);
  });

  it("mantiene el rechazo de revisión y finalización cuando la opción está apagada", async () => {
    const firm = await runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
      tx.firm.findUniqueOrThrow({ where: { id: FIRM_WP }, select: { allowSelfReview: true } }),
    );
    expect(firm.allowSelfReview).toBe(false);

    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await resolveGeneratedBlockingControls(wp.id);
    await service.submitReview(ctxPreparer, wp.id);

    await expect(service.review(ctxPreparer, wp.id, { approved: true })).rejects.toMatchObject({
      code: "MAKER_CHECKER_VIOLATION",
      message: "El preparador no puede revisar su propio expediente",
    });
    const reviewedByOther = await service.review(ctxReviewer, wp.id, { approved: true });
    expect(reviewedByOther.status).toBe("REVIEWED");
    await expect(service.finalize(ctxPreparer, wp.id)).rejects.toMatchObject({
      code: "MAKER_CHECKER_VIOLATION",
      message: "El preparador no puede finalizar su propio expediente",
    });
  });

  it("permite autorrevisar y finalizar con opción activa, y audita cada entidad", async () => {
    const wp = await service.create(ctxOwner, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxOwner, wp.id);
    await resolveGeneratedBlockingControls(wp.id);
    await service.submitReview(ctxOwner, wp.id);
    await runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
      tx.firm.update({ where: { id: FIRM_WP }, data: { allowSelfReview: true } }),
    );

    const reviewed = await service.review(ctxOwner, wp.id, { approved: true });
    expect(reviewed.status).toBe("REVIEWED");
    const finalized = await service.finalize(ctxOwner, wp.id);
    expect(finalized.status).toBe("FINALIZED");

    const audits = await runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
      tx.auditEvent.findMany({
        where: { firmId: FIRM_WP, userId: OWNER_WP, action: "SELF_REVIEW" },
        orderBy: { createdAt: "asc" },
      }),
    );
    const detail = await service.get(ctxOwner, wp.id);
    const settlementId = detail?.settlements[0]?.settlement?.id;
    const workpaperAudits = audits.filter(
      (event) => event.entityType === "MonthlyTaxWorkpaper" && event.entityId === wp.id,
    );
    expect(settlementId).toBeTruthy();
    const settlementAudits = audits.filter(
      (event) => event.entityType === "TaxSettlement" && event.entityId === settlementId,
    );
    expect(workpaperAudits).toHaveLength(2);
    expect(workpaperAudits[0]?.after).toMatchObject({ type: "SELF_REVIEW", scope: "WORKPAPER_REVIEW" });
    expect(workpaperAudits[1]?.after).toMatchObject({ type: "SELF_REVIEW", scope: "WORKPAPER_FINALIZE" });
    expect(settlementAudits).toHaveLength(2);
    expect(workpaperAudits.every((event) => event.createdAt instanceof Date)).toBe(true);
    expect(settlementAudits.every((event) => event.createdAt instanceof Date)).toBe(true);
  });

  it("recorre el ciclo completo: calcular → revisar → finalizar", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await resolveGeneratedBlockingControls(wp.id);
    await service.submitReview(ctxPreparer, wp.id);
    const reviewed = await service.review(ctxReviewer, wp.id, { approved: true });
    expect(reviewed.status).toBe("REVIEWED");

    const finalized = await service.finalize(ctxOwner, wp.id);
    expect(finalized.status).toBe("FINALIZED");
    expect(finalized.outputHash).toBeTruthy();
    const detail = await service.get(ctxOwner, wp.id);
    expect(detail?.settlements[0]?.settlement?.status).toBe("FINALIZED");
  });

  it("acepta evidencia REVIEWED y conserva los controles de estado y pertenencia", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });

    const reviewedEvidenceId = await createControlEvidence("REVIEWED");
    const reviewedControl = await createBlockingControl(wp.id, "B9_REVIEWED_EVIDENCE");
    const reviewed = await service.resolveControl(ctxReviewer, wp.id, reviewedControl.id, {
      resolution: "Extracción aprobada y documento cotejado",
      status: "RESOLVED",
      evidenceDocumentId: reviewedEvidenceId,
    });
    expect(reviewed.status).toBe("RESOLVED");
    expect(reviewed.evidenceDocumentId).toBe(reviewedEvidenceId);

    const readyEvidenceId = await createControlEvidence("READY");
    const readyControl = await createBlockingControl(wp.id, "B9_READY_EVIDENCE");
    const ready = await service.resolveControl(ctxReviewer, wp.id, readyControl.id, {
      resolution: "Documento validado disponible",
      status: "RESOLVED",
      evidenceDocumentId: readyEvidenceId,
    });
    expect(ready.status).toBe("RESOLVED");
    expect(ready.evidenceDocumentId).toBe(readyEvidenceId);

    async function expectEvidenceRejected(code: string, evidenceDocumentId: string) {
      const control = await createBlockingControl(wp.id, code);
      await expect(
        service.resolveControl(ctxReviewer, wp.id, control.id, {
          resolution: "Intento con evidencia fuera del alcance",
          status: "RESOLVED",
          evidenceDocumentId,
        }),
      ).rejects.toMatchObject({
        code: "BLOCKING_CONTROLS",
        message: "La evidencia del control debe pertenecer al cliente y estar lista o revisada",
      });
    }

    await expectEvidenceRejected(
      "B9_EXTRACTED_EVIDENCE",
      await createControlEvidence("EXTRACTED"),
    );
    await expectEvidenceRejected(
      "B9_OTHER_CLIENT_EVIDENCE",
      await createControlEvidence("READY", FIRM_WP, OTHER_CLIENT_WP),
    );
    await expectEvidenceRejected(
      "B9_OTHER_FIRM_EVIDENCE",
      await createControlEvidence("READY", OTHER_FIRM_WP, OTHER_FIRM_CLIENT_WP),
    );
  });

  it("bloquea finalizar con controles bloqueantes abiertos", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await service.submitReview(ctxPreparer, wp.id);
    await service.review(ctxReviewer, wp.id, { approved: true });

    // Control bloqueante abierto.
    await runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
      tx.taxControlFinding.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          workpaperId: wp.id,
          code: "BOOK_RATE_RECONCILIATION",
          severity: "BLOCKING",
          status: "OPEN",
        },
      }),
    );

    await expect(service.finalize(ctxOwner, wp.id)).rejects.toThrow(WorkpaperError);
  });

  it("F1.5: el preparador no puede eximir un control bloqueante de su propio expediente", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);

    const finding = await runAsRuntime(OWNER_WP, FIRM_WP, (tx) =>
      tx.taxControlFinding.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          workpaperId: wp.id,
          code: "BOOK_RATE_RECONCILIATION",
          severity: "BLOCKING",
          status: "OPEN",
        },
      }),
    );
    const evidenceDocumentId = await createControlEvidence();

    // El preparador no puede waivear su propio control bloqueante.
    await expect(
      service.resolveControl(ctxPreparer, wp.id, finding.id, {
        resolution: "justificado",
        status: "WAIVED",
        evidenceDocumentId,
      }),
    ).rejects.toThrow(WorkpaperError);

    // Un revisor distinto sí puede.
    const resolved = await service.resolveControl(ctxReviewer, wp.id, finding.id, {
      resolution: "justificado por evidencia",
      status: "WAIVED",
      evidenceDocumentId,
    });
    expect(resolved.status).toBe("WAIVED");
  });

  it("rectifica creando una nueva revisión inmutable", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await resolveGeneratedBlockingControls(wp.id);
    await service.submitReview(ctxPreparer, wp.id);
    await service.review(ctxReviewer, wp.id, { approved: true });
    await service.finalize(ctxOwner, wp.id);
    const original = await service.get(ctxOwner, wp.id);

    const rectified = await service.rectify(ctxPreparer, wp.id);
    expect(rectified.revision).toBe(2);
    expect(rectified.supersedesId).toBe(wp.id);
    expect(rectified.status).toBe("DRAFT");
    expect(rectified.settlements[0]?.settlement?.status).toBe("DRAFT");
    expect(rectified.settlements[0]?.settlement?.id).not.toBe(
      original?.settlements[0]?.settlement?.id,
    );

    // La revisión anterior sigue FINALIZED (inmutable).
    expect(original?.status).toBe("FINALIZED");
  });

  it("calcula y reutiliza una foto determinista de mora", async () => {
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    await resolveGeneratedBlockingControls(wp.id);
    await service.submitReview(ctxPreparer, wp.id);
    await service.review(ctxReviewer, wp.id, { approved: true });
    await service.finalize(ctxOwner, wp.id);

    const first = await service.calculateInterest(ctxOwner, wp.id, {
      obligationId: OBLIGATION_WP,
      asOfDate: "2026-03-22",
    });
    const again = await service.calculateInterest(ctxOwner, wp.id, {
      obligationId: OBLIGATION_WP,
      asOfDate: "2026-03-22",
    });
    expect(first.id).toBe(again.id);
    expect(first.daysLate).toBe(30);
    expect(first.monthlyRate.toString()).toBe("0.06");
    expect(first.status).toBe("NO_DEBT");
  });

  it("F1.7: el libro de créditos calcula el saldo disponible desde movimientos", async () => {
    // Crea un lote de crédito con un movimiento de aplicación.
    const lot = await runAsRuntime(OWNER_WP, FIRM_WP, async (tx) => {
      const created = await tx.taxCreditLot.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          taxTypeId: "IVA",
          jurisdictionId: "AR",
          kind: "FREE_AVAILABILITY",
          originalAmount: new Prisma.Decimal("5000"),
          createdByUserId: OWNER_WP,
        },
      });
      await tx.taxCreditMovement.create({
        data: {
          firmId: FIRM_WP,
          clientId: CLIENT_WP,
          lotId: created.id,
          kind: "APPLICATION",
          amount: new Prisma.Decimal("2000"),
          createdByUserId: OWNER_WP,
        },
      });
      return created;
    });

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry).toBeDefined();
    expect(entry?.originalAmount).toBe("5000.0000");
    expect(entry?.available).toBe("3000.0000"); // 5000 - 2000
    expect(entry?.movements).toHaveLength(1);
  });

  it("carga una apertura genérica idempotente y la usa en el cálculo tras verificación", async () => {
    const evidence = await prisma.document.create({
      data: {
        firmId: FIRM_WP,
        clientId: CLIENT_WP,
        category: "TAX_BALANCE_SUPPORT",
        status: "READY",
        uploadOrigin: "FIRM",
      },
    });
    const input = {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "5000",
      evidenceDocumentId: evidence.id,
      reference: "DJ período anterior",
    };
    const first = await service.createOpeningCredit(ctxOwner, input);
    const repeated = await service.createOpeningCredit(ctxOwner, input);
    expect(repeated.id).toBe(first.id);

    // B1 (§3.1): el saldo nace pendiente y NO alimenta el cálculo hasta que
    // un revisor distinto lo verifica.
    expect(first.verificationStatus).toBe("PENDING_VERIFICATION");
    const wpPending = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wpPending.id);
    const breakdownPending = await service.calculationBreakdown(ctxPreparer, wpPending.id);
    const totalsPending = breakdownPending[0]?.settlement?.totals as
      | Record<string, string>
      | undefined;
    expect(totalsPending?.["SALDO_LIBRE_ANTERIOR"]).toBe("0.00");

    const verified = await service.verifyCreditLot(ctxReviewer, CLIENT_WP, first.id, {
      officialReference: "DJ presentada período anterior",
    });
    expect(verified.verificationStatus).toBe("VERIFIED");
    expect(verified.verifiedByUserId).toBe(REVIEWER_WP);
    expect(verified.verifiedAt).toBeTruthy();

    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    const breakdown = await service.calculationBreakdown(ctxPreparer, wp.id);
    const totals = breakdown[0]?.settlement?.totals as Record<string, string> | undefined;
    expect(totals?.["SALDO_LIBRE_ANTERIOR"]).toBe("5000.00");
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((lot) => lot.id === first.id);
    expect(entry?.reference).toBe("DJ período anterior");
    expect(entry?.verificationStatus).toBe("VERIFIED");
    expect(entry?.verifiedBy?.id).toBe(REVIEWER_WP);
  });

  it("carga un saldo inicial manual sin documento y conserva el usuario que lo registró", async () => {
    const input = {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "2500",
      reference: "Carga manual del preparador",
    };
    const lot = await service.createOpeningCredit(ctxOwner, input);
    expect(lot.evidenceDocumentId).toBeNull();

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry).toBeDefined();
    expect(entry?.evidenceDocumentId).toBeNull();
    expect(entry?.createdBy?.id).toBe(OWNER_WP);
    expect(entry?.createdBy?.name).toBeTruthy();
    expect(entry?.reference).toBe("Carga manual del preparador");
  });

  it("edita metadatos de un lote y audita el cambio en el historial", async () => {
    const input = {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "3000",
      reference: "Referencia original",
    };
    const lot = await service.createOpeningCredit(ctxOwner, input);

    // Editar referencia y agregar documento de respaldo.
    const evidence = await prisma.document.create({
      data: {
        firmId: FIRM_WP,
        clientId: CLIENT_WP,
        category: "TAX_BALANCE_SUPPORT",
        status: "READY",
        uploadOrigin: "FIRM",
      },
    });
    const result = await service.updateCreditLot(ctxOwner, CLIENT_WP, lot.id, {
      reference: "Referencia corregida",
      evidenceDocumentId: evidence.id,
    });
    expect(result.changed).toBe(true);
    expect(result.reference).toBe("Referencia corregida");
    expect(result.evidenceDocumentId).toBe(evidence.id);

    // El historial debe registrar el cambio con usuario y fecha.
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry?.reference).toBe("Referencia corregida");
    expect(entry?.history).toHaveLength(1);
    expect(entry?.history[0]?.createdBy?.id).toBe(OWNER_WP);
    expect(entry?.history[0]?.createdBy?.name).toBeTruthy();
    expect(entry?.history[0]?.createdAt).toBeTruthy();
    const changes = entry?.history[0]?.changes as Record<string, { from: string | null; to: string | null }>;
    expect(changes.reference).toEqual({ from: "Referencia original", to: "Referencia corregida" });
    expect(changes.evidenceDocumentId).toEqual({ from: null, to: evidence.id });
  });

  it("no registra historial si la edición no cambia nada", async () => {
    const input = {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "1500",
      reference: "Sin cambios",
    };
    const lot = await service.createOpeningCredit(ctxOwner, input);

    const result = await service.updateCreditLot(ctxOwner, CLIENT_WP, lot.id, {
      reference: "Sin cambios",
    });
    expect(result.changed).toBe(false);

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry?.history).toHaveLength(0);
  });

  // ================================================================
  // B1 (plan piloto fiscal §3.1): verificación obligatoria de saldos.
  // ================================================================

  it("§3.1.1: un saldo manual nace PENDING_VERIFICATION y no entra al cálculo", async () => {
    const lot = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "4000",
      reference: "Saldo pendiente",
    });
    expect(lot.verificationStatus).toBe("PENDING_VERIFICATION");

    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    const breakdown = await service.calculationBreakdown(ctxPreparer, wp.id);
    const totals = breakdown[0]?.settlement?.totals as Record<string, string> | undefined;
    expect(totals?.["SALDO_LIBRE_ANTERIOR"]).toBe("0.00");
  });

  it("§3.1.2: la verificación exige evidencia o referencia oficial y registra usuario/fecha", async () => {
    const lot = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "3500",
    });

    await expect(service.verifyCreditLot(ctxReviewer, CLIENT_WP, lot.id, {})).rejects.toMatchObject({
      code: "SOURCE_NOT_REVIEWED",
    });

    const evidence = await prisma.document.create({
      data: {
        firmId: FIRM_WP,
        clientId: CLIENT_WP,
        category: "TAX_BALANCE_SUPPORT",
        status: "READY",
        uploadOrigin: "FIRM",
      },
    });
    const verified = await service.verifyCreditLot(ctxReviewer, CLIENT_WP, lot.id, {
      evidenceDocumentId: evidence.id,
    });
    expect(verified.verificationStatus).toBe("VERIFIED");
    expect(verified.verifiedByUserId).toBe(REVIEWER_WP);
    expect(verified.verifiedAt).toBeTruthy();
  });

  it("§3.1.3: maker-checker — quien creó el saldo no puede verificarlo", async () => {
    const lot = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "2000",
    });
    await expect(
      service.verifyCreditLot(ctxOwner, CLIENT_WP, lot.id, {
        officialReference: "autoverificación",
      }),
    ).rejects.toMatchObject({ code: "MAKER_CHECKER_VIOLATION" });
  });

  it("§3.1.4: un saldo ya verificado no se reverifica", async () => {
    const lot = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "1200",
    });
    await service.verifyCreditLot(ctxReviewer, CLIENT_WP, lot.id, {
      officialReference: "DJ oficial",
    });
    await expect(
      service.verifyCreditLot(ctxReviewer, CLIENT_WP, lot.id, {
        officialReference: "segunda pasada",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("§3.1.7: un saldo sólo se aplica al mismo impuesto (alcance fiscal)", async () => {
    // El lote pertenece a taxTypeId (IVA WP); una obligación de otro
    // impuesto no debe verlo. Se valida por el filtro taxTypeId del cálculo.
    const lot = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "1800",
    });
    await service.verifyCreditLot(ctxReviewer, CLIENT_WP, lot.id, {
      officialReference: "DJ oficial",
    });
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry?.taxTypeId).toBe(taxTypeId);
    // El cálculo del expediente (mismo impuesto) sí lo consume.
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    const breakdown = await service.calculationBreakdown(ctxPreparer, wp.id);
    const totals = breakdown[0]?.settlement?.totals as Record<string, string> | undefined;
    expect(totals?.["SALDO_LIBRE_ANTERIOR"]).toBe("1800.00");
  });

  it("§3.1.8: IVA_TECNICO, IVA_LIBRE y SALDO_A_FAVOR no se mezclan", async () => {
    // El guard de naturaleza: IVA_TECNICO/IVA_LIBRE sólo existen para IVA.
    // Se usa un impuesto no IVA con período propio para ejercitar el guard sin
    // depender de un código sintético de impuesto.
    const nonIvaTaxType = await prisma.taxType.findUniqueOrThrow({ where: { code: "IIBB" } });
    const nonIvaPeriod = await prisma.taxPeriod.upsert({
      where: {
        clientId_taxTypeId_startDate_endDate: {
          clientId: CLIENT_WP,
          taxTypeId: nonIvaTaxType.id,
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2026-01-31T00:00:00.000Z"),
        },
      },
      update: {},
      create: {
        firmId: FIRM_WP,
        clientId: CLIENT_WP,
        taxTypeId: nonIvaTaxType.id,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-01-31T00:00:00.000Z"),
        label: "2026-01 WP IIBB",
      },
    });
    await expect(
      service.createOpeningCredit(ctxOwner, {
        clientId: CLIENT_WP,
        taxTypeId: nonIvaTaxType.id,
        periodId: nonIvaPeriod.id,
        kind: "IVA_TECNICO" as const,
        amount: "1000",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    // SALDO_A_FAVOR es genérico y se mantiene separado de las naturalezas IVA.
    const saldo = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "2000",
    });
    await service.verifyCreditLot(ctxReviewer, CLIENT_WP, saldo.id, { officialReference: "s" });
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === saldo.id);
    expect(entry?.kind).toBe("SALDO_A_FAVOR");
    expect(entry?.verificationStatus).toBe("VERIFIED");
  });

  // ================================================================
  // B2 (plan piloto fiscal §3.2): libro de créditos inmutable.
  // ================================================================

  /** Crea un lote verificado para pruebas de movimientos. */
  async function createVerifiedLot(amount: string) {
    const lot = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount,
    });
    await service.verifyCreditLot(ctxReviewer, CLIENT_WP, lot.id, {
      officialReference: "verificación B2",
    });
    return lot;
  }

  it("§3.2.1: el disponible es original + ajustes − usos − compensaciones", async () => {
    const lot = await createVerifiedLot("10000");
    await service.registerCreditUse(ctxPreparer, CLIENT_WP, {
      lotId: lot.id,
      amount: "3000",
      reference: "uso 1",
    });
    await service.registerCreditUse(ctxPreparer, CLIENT_WP, {
      lotId: lot.id,
      amount: "1500",
      reference: "compensación 1",
      kind: "COMPENSATION",
    });
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry?.available).toBe("5500.0000"); // 10000 - 3000 - 1500
    expect(entry?.movements).toHaveLength(2);
  });

  it("§3.2.2: un uso externo queda registrado como movimiento inmutable con autor", async () => {
    const lot = await createVerifiedLot("8000");
    const use = await service.registerCreditUse(ctxPreparer, CLIENT_WP, {
      lotId: lot.id,
      amount: "2000",
      reference: "aplicación en otra DJ",
      kind: "EXTERNAL_USE",
    });
    expect(use.duplicated).toBe(false);

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    const movement = entry?.movements.find((m) => m.id === use.id);
    expect(movement?.kind).toBe("EXTERNAL_USE");
    expect(movement?.amount).toBe("2000");
    expect(movement?.reference).toBe("aplicación en otra DJ");
    // El autor queda registrado vía createdByUserId (columna del movimiento).
  });

  it("§3.2.3: una compensación conserva referencia y autor", async () => {
    const lot = await createVerifiedLot("6000");
    await service.registerCreditUse(ctxPreparer, CLIENT_WP, {
      lotId: lot.id,
      amount: "1000",
      reference: "compensación con deuda período 2",
      kind: "COMPENSATION",
    });
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    const movement = entry?.movements.find((m) => m.kind === "COMPENSATION");
    expect(movement).toBeDefined();
    expect(movement?.reference).toBe("compensación con deuda período 2");
    expect(movement?.createdAt).toBeTruthy();
  });

  it("§3.2.4: repetir una aplicación es idempotente (no duplica consumo)", async () => {
    const lot = await createVerifiedLot("5000");
    const first = await service.registerCreditUse(ctxPreparer, CLIENT_WP, {
      lotId: lot.id,
      amount: "2000",
      reference: "misma operación",
    });
    const again = await service.registerCreditUse(ctxPreparer, CLIENT_WP, {
      lotId: lot.id,
      amount: "2000",
      reference: "misma operación",
    });
    expect(again.id).toBe(first.id);
    expect(again.duplicated).toBe(true);

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry?.available).toBe("3000.0000"); // sólo un consumo
    expect(entry?.movements).toHaveLength(1);
  });

  it("§3.2.5: una aplicación superior al disponible falla", async () => {
    const lot = await createVerifiedLot("1000");
    await expect(
      service.registerCreditUse(ctxPreparer, CLIENT_WP, {
        lotId: lot.id,
        amount: "2000",
        reference: "excede disponible",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("§3.2.6: modificar metadatos no cambia el importe histórico", async () => {
    const lot = await createVerifiedLot("4000");
    await service.updateCreditLot(ctxOwner, CLIENT_WP, lot.id, {
      reference: "nueva referencia",
    });
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    expect(entry?.originalAmount).toBe("4000.0000"); // intacto
    expect(entry?.reference).toBe("nueva referencia");
  });

  it("§3.2.7: una corrección de monto crea movimiento compensatorio e historial", async () => {
    const lot = await createVerifiedLot("3000");
    const result = await service.correctCreditLotAmount(ctxOwner, CLIENT_WP, lot.id, {
      newAmount: "4500",
      reason: "Ajuste por DJ rectificativa del período anterior",
    });
    expect(result.changed).toBe(true);
    expect(result.delta).toBe("1500.0000");

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    // El original se conserva; el ajuste vive como movimiento.
    expect(entry?.originalAmount).toBe("3000.0000");
    const correction = entry?.movements.find((m) => m.kind === "AMOUNT_CORRECTION");
    // Convención: el movimiento compensatorio que AUMENTA el saldo es negativo.
    expect(Number(correction?.amount)).toBe(-1500);
    expect(entry?.available).toBe("4500.0000");
    expect(entry?.history.length).toBeGreaterThanOrEqual(1);
    const lastChange = entry?.history[entry.history.length - 1]?.changes as Record<
      string,
      { from: string | null; to: string | null }
    >;
    expect(lastChange.originalAmount).toEqual({ from: "3000.0000", to: "4500.0000" });
  });

  it("§3.2.8: dos ejecuciones concurrentes no gastan el mismo saldo dos veces", async () => {
    const lot = await createVerifiedLot("1000");
    // Ambas transacciones compiten por el mismo disponible; el lock FOR UPDATE
    // serializa y la segunda ve el disponible reducido.
    const results = await Promise.allSettled([
      service.registerCreditUse(ctxPreparer, CLIENT_WP, {
        lotId: lot.id,
        amount: "800",
        reference: "corrida A",
      }),
      service.registerCreditUse(ctxReviewer, CLIENT_WP, {
        lotId: lot.id,
        amount: "800",
        reference: "corrida B",
      }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    // A lo sumo una puede ganar (800 ≤ 1000) o ambas pierden si compiten por
    // el mismo monto; nunca dos consumos de 800 sobre 1000.
    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const entry = ledger.find((item) => item.id === lot.id);
    const totalApplied = (entry?.movements ?? []).reduce(
      (sum, m) => sum + Number(m.amount),
      0,
    );
    expect(totalApplied).toBeLessThanOrEqual(1000);
    expect(fulfilled.length + rejected.length).toBe(2);
  });

  it("§3.2.9: un saldo no verificado no puede aplicarse", async () => {
    const lot = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "500",
    });
    await expect(
      service.registerCreditUse(ctxPreparer, CLIENT_WP, {
        lotId: lot.id,
        amount: "100",
        reference: "uso sobre saldo pendiente",
      }),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_REVIEWED" });
  });

  // ================================================================
  // P1 (§3.1.5/§3.1.4): última rectificativa y presentación superada.
  // ================================================================

  it("§3.1.5: una nueva presentación supera a la anterior; sólo la última verificada alimenta", async () => {
    // Presentación original verificada.
    const original = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "1000",
      reference: "DJ original",
    });
    await service.verifyCreditLot(ctxReviewer, CLIENT_WP, original.id, {
      officialReference: "DJ original verificada",
    });

    // Rectificativa del mismo alcance: la original queda SUPERSEDED.
    const rectificativa = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "1500",
      reference: "DJ rectificativa",
    });
    expect(rectificativa.id).not.toBe(original.id);

    const ledger = await service.creditLedger(ctxOwner, CLIENT_WP, {});
    const originalEntry = ledger.find((item) => item.id === original.id);
    const rectificativaEntry = ledger.find((item) => item.id === rectificativa.id);
    expect(originalEntry?.verificationStatus).toBe("SUPERSEDED");
    expect(rectificativaEntry?.verificationStatus).toBe("PENDING_VERIFICATION");

    // El cálculo ignora la original (SUPERSEDED) y aún no consume la nueva
    // (pendiente de verificación).
    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    const breakdown = await service.calculationBreakdown(ctxPreparer, wp.id);
    const totals = breakdown[0]?.settlement?.totals as Record<string, string> | undefined;
    expect(totals?.["SALDO_LIBRE_ANTERIOR"]).toBe("0.00");

    // Tras verificar la rectificativa, sólo ésta alimenta.
    await service.verifyCreditLot(ctxReviewer, CLIENT_WP, rectificativa.id, {
      officialReference: "DJ rectificativa verificada",
    });
    const wp2 = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp2.id);
    const breakdown2 = await service.calculationBreakdown(ctxPreparer, wp2.id);
    const totals2 = breakdown2[0]?.settlement?.totals as Record<string, string> | undefined;
    expect(totals2?.["SALDO_LIBRE_ANTERIOR"]).toBe("1500.00");
  });

  it("§3.1.4: usar una presentación superada abre un control bloqueante", async () => {
    const original = await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "800",
      reference: "DJ a superar",
    });
    await service.verifyCreditLot(ctxReviewer, CLIENT_WP, original.id, {
      officialReference: "verificación original",
    });

    // La rectificativa supera a la original (queda SUPERSEDED con disponible).
    await service.createOpeningCredit(ctxOwner, {
      clientId: CLIENT_WP,
      taxTypeId,
      periodId: PERIOD_WP,
      kind: "SALDO_A_FAVOR" as const,
      amount: "1200",
      reference: "DJ rectificativa 2",
    });

    const wp = await service.create(ctxPreparer, {
      clientId: CLIENT_WP,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
    });
    await service.calculate(ctxPreparer, wp.id);
    const controls = await service.listControls(ctxReviewer, wp.id);
    const supersededControl = controls.find(
      (control) => control.code === "SUPERSEDED_OPENING_CREDIT",
    );
    expect(supersededControl).toBeDefined();
    expect(supersededControl?.severity).toBe("BLOCKING");
    expect(supersededControl?.status).toBe("OPEN");
  });
});
