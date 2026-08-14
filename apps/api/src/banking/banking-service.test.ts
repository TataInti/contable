import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { BankService, BankError } from "./bank-service.js";
import { AdjustmentService } from "./adjustment-service.js";

/**
 * Tests de integración de bancos, moneda e inflación (Fase 7).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "11111111-2222-4333-8444-666666666666";

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

const bank = new BankService();
const adjustments = new AdjustmentService();
const ctx = { userId: OWNER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };

async function setupFixtures() {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const fy = await tx.fiscalYear.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        label: "2026",
        status: "OPEN",
      },
    });
    const period = await tx.accountingPeriod.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        fiscalYearId: fy.id,
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-01-31"),
        ordinal: 1,
        status: "OPEN",
      },
    });
    const caja = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: "1.1.1",
        name: "Caja",
        type: "ASSET",
        normalBalance: "DEBIT",
        isPostable: true,
        monetaryClassification: "MONETARY",
        path: "1.1.1",
      },
    });
    const banco = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: "1.1.2",
        name: "Banco",
        type: "ASSET",
        normalBalance: "DEBIT",
        isPostable: true,
        monetaryClassification: "MONETARY",
        path: "1.1.2",
      },
    });
    const capital = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: "3.1.1",
        name: "Capital",
        type: "EQUITY",
        normalBalance: "CREDIT",
        isPostable: true,
        monetaryClassification: "NOT_APPLICABLE",
        path: "3.1.1",
      },
    });
    return { fy, period, caja, banco, capital };
  });
}

describe("bancos (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM bank_matches WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_movements WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_statements WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_reconciliations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_difference_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_lines WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM fiscal_years WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("importa movimientos con dedupe por externalId", async () => {
    const fx = await setupFixtures();
    const bankAccount = await bank.createBankAccount(ctx, {
      clientId: CLIENT_ALFA,
      accountId: fx.banco.id,
      bankName: "Banco Nación",
      accountNumber: "1234",
    });

    const first = await bank.importMovements(ctx, {
      bankAccountId: bankAccount.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: "0.00",
      closingBalance: "1000.00",
      rows: [
        { externalId: "m1", valueDate: "2026-01-10", description: "Depósito", amount: "1000.00" },
      ],
    });
    expect(first.created).toBe(1);

    // Reimportar mismo externalId → dedupe
    const second = await bank.importMovements(ctx, {
      bankAccountId: bankAccount.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: "0.00",
      closingBalance: "1000.00",
      rows: [
        { externalId: "m1", valueDate: "2026-01-10", description: "Depósito", amount: "1000.00" },
      ],
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("lote con errores no escribe parcial (B-002)", async () => {
    const fx = await setupFixtures();
    const bankAccount = await bank.createBankAccount(ctx, {
      clientId: CLIENT_ALFA,
      accountId: fx.banco.id,
      bankName: "Banco Nación",
      accountNumber: "5678",
    });

    await expect(
      bank.importMovements(ctx, {
        bankAccountId: bankAccount.id,
        periodStart: "2026-01-01",
        periodEnd: "2026-01-31",
        openingBalance: "0.00",
        closingBalance: "0.00",
        rows: [
          { externalId: "ok", valueDate: "2026-01-10", description: "Válido", amount: "100.00" },
          { externalId: "bad", valueDate: "2026-01-11", description: "Inválido", amount: "abc" },
        ],
      }),
    ).rejects.toThrow(BankError);

    // No se escribió ningún movimiento
    const count = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.bankMovement.count({ where: { bankAccountId: bankAccount.id } }),
    );
    expect(count).toBe(0);
  });

  it("match no sobreaplica (B-003)", async () => {
    const fx = await setupFixtures();
    const bankAccount = await bank.createBankAccount(ctx, {
      clientId: CLIENT_ALFA,
      accountId: fx.banco.id,
      bankName: "Banco Nación",
      accountNumber: "9012",
    });
    const { statement } = await bank.importMovements(ctx, {
      bankAccountId: bankAccount.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: "0.00",
      closingBalance: "500.00",
      rows: [{ externalId: "m1", valueDate: "2026-01-10", description: "Pago", amount: "500.00" }],
    });
    const movement = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.bankMovement.findFirst({ where: { statementId: statement.id } }),
    );
    if (!movement) throw new Error("movimiento no creado");

    await expect(
      bank.confirmMatch(ctx, { movementId: movement.id, entryId: "00000000-0000-4000-8000-000000000000", appliedAmount: "600.00" }),
    ).rejects.toThrow(BankError);
  });

  it("snapshot reproduce saldos (B-004)", async () => {
    const fx = await setupFixtures();
    const bankAccount = await bank.createBankAccount(ctx, {
      clientId: CLIENT_ALFA,
      accountId: fx.banco.id,
      bankName: "Banco Nación",
      accountNumber: "3456",
    });
    await bank.importMovements(ctx, {
      bankAccountId: bankAccount.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: "1000.00",
      closingBalance: "1500.00",
      rows: [{ externalId: "m1", valueDate: "2026-01-10", description: "Depósito", amount: "500.00" }],
    });

    const rec = await bank.finalizeReconciliation(ctx, {
      bankAccountId: bankAccount.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: "1000.00",
      closingBalance: "1500.00",
    });
    expect(rec.status).toBe("RECONCILED");
    expect(rec.snapshot).not.toBeNull();
  });

  it("reabrir conserva snapshot (B-005)", async () => {
    const fx = await setupFixtures();
    const bankAccount = await bank.createBankAccount(ctx, {
      clientId: CLIENT_ALFA,
      accountId: fx.banco.id,
      bankName: "Banco Nación",
      accountNumber: "7890",
    });
    await bank.importMovements(ctx, {
      bankAccountId: bankAccount.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: "0.00",
      closingBalance: "200.00",
      rows: [{ externalId: "m1", valueDate: "2026-01-10", description: "Depósito", amount: "200.00" }],
    });
    const rec = await bank.finalizeReconciliation(ctx, {
      bankAccountId: bankAccount.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      openingBalance: "0.00",
      closingBalance: "200.00",
    });

    const reopened = await bank.reopenReconciliation(ctx, rec.id, "Error en importe");
    expect(reopened.status).toBe("REOPENED");
    expect(reopened.snapshot).not.toBeNull();
  });
});

describe("ajustes (integración DB)", () => {
  beforeEach(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM bank_matches WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_movements WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_statements WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_reconciliations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_lines WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM journal_entries WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_difference_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_rates WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_rate_sources WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_observations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_indexes WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM fiscal_years WHERE "clientId" = '${CLIENT_ALFA}'`);
  });

  it("run de diferencia de cambio produce worksheet sin tocar ledger (I-001)", async () => {
    const fx = await setupFixtures();
    const source = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.exchangeRateSource.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          name: "BCRA",
          provider: "BCRA",
          baseCurrency: "ARS",
          quoteCurrency: "USD",
        },
      }),
    );
    await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.exchangeRate.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          sourceId: source.id,
          date: new Date("2026-01-31"),
          rate: "1000.00",
        },
      }),
    );

    // Asiento en USD posteado
    await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      await tx.journalEntry.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          fiscalYearId: fx.fy.id,
          periodId: fx.period.id,
          entryDate: new Date("2026-01-15"),
          description: "Compra USD",
          sourceType: "MANUAL",
          status: "POSTED",
          preparedByUserId: OWNER_A,
          postedByUserId: OWNER_A,
          postedAt: new Date(),
          sequenceNumber: 1,
          lines: {
            create: [
              {
                firmId: FIRM_ALFA,
                clientId: CLIENT_ALFA,
                position: 1,
                accountId: fx.caja.id,
                currencyCode: "USD",
                debitOriginal: "100.00",
                creditOriginal: "0.00",
                exchangeRate: "1000.00",
                debitFunctional: "100000.00",
                creditFunctional: "0.00",
              },
              {
                firmId: FIRM_ALFA,
                clientId: CLIENT_ALFA,
                position: 2,
                accountId: fx.capital.id,
                currencyCode: "ARS",
                debitOriginal: "0.00",
                creditOriginal: "100000.00",
                debitFunctional: "0.00",
                creditFunctional: "100000.00",
              },
            ],
          },
        },
      });
    });

    const run = await adjustments.runExchangeDifference(ctx, {
      clientId: CLIENT_ALFA,
      fiscalYearId: fx.fy.id,
      periodId: fx.period.id,
      asOfDate: "2026-01-31",
      rateSourceId: source.id,
    });
    expect(run.status).toBe("DRAFT");
    expect(run.worksheet).not.toBeNull();
    expect(run.draftEntryId).toBeNull();
  });

  it("run de inflación reproducible (I-002)", async () => {
    const fx = await setupFixtures();
    const index = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.inflationIndex.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          code: "IPC",
          name: "IPC Nacional",
          baseDate: new Date("2025-12-31"),
          baseValue: "100.00",
        },
      }),
    );
    await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.inflationObservation.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          indexId: index.id,
          date: new Date("2026-01-31"),
          value: "110.00",
        },
      }),
    );

    // Asiento en ARS posteado en cuenta monetaria
    await runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
      await tx.journalEntry.create({
        data: {
          firmId: FIRM_ALFA,
          clientId: CLIENT_ALFA,
          fiscalYearId: fx.fy.id,
          periodId: fx.period.id,
          entryDate: new Date("2026-01-15"),
          description: "Aporte",
          sourceType: "MANUAL",
          status: "POSTED",
          preparedByUserId: OWNER_A,
          postedByUserId: OWNER_A,
          postedAt: new Date(),
          sequenceNumber: 1,
          lines: {
            create: [
              {
                firmId: FIRM_ALFA,
                clientId: CLIENT_ALFA,
                position: 1,
                accountId: fx.caja.id,
                currencyCode: "ARS",
                debitOriginal: "100000.00",
                creditOriginal: "0.00",
                debitFunctional: "100000.00",
                creditFunctional: "0.00",
              },
              {
                firmId: FIRM_ALFA,
                clientId: CLIENT_ALFA,
                position: 2,
                accountId: fx.capital.id,
                currencyCode: "ARS",
                debitOriginal: "0.00",
                creditOriginal: "100000.00",
                debitFunctional: "0.00",
                creditFunctional: "100000.00",
              },
            ],
          },
        },
      });
    });

    const run = await adjustments.runInflation(ctx, {
      clientId: CLIENT_ALFA,
      fiscalYearId: fx.fy.id,
      periodId: fx.period.id,
      asOfDate: "2026-01-31",
      indexId: index.id,
      indexVersion: "v1",
      policyVersion: "p1",
      ledgerCutoff: "2026-01-31",
    });
    expect(run.status).toBe("DRAFT");
    expect(run.worksheet).not.toBeNull();
    expect(run.draftEntryId).toBeNull();
  });
});