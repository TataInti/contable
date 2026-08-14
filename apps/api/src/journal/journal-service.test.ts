import { describe, expect, it, beforeEach } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { prisma } from "../lib/prisma.js";
import { JournalService, JournalError } from "./journal-service.js";
import { LedgerService } from "./ledger-service.js";
import { EntryError } from "@contable/accounting-engine";

/**
 * Tests de integración del núcleo contable (Fase 6).
 * Requieren PostgreSQL local con migraciones y RLS aplicados.
 */

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const PREPARER_A = "33333333-3333-4333-8333-333333333333";
const FIRM_ALFA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_ALFA = "11111111-2222-4333-8444-555555555555";

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
    return fn(tx);
  });
}

const journal = new JournalService();
const ledger = new LedgerService();

const ctxOwner = { userId: OWNER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };
const ctxPreparer = { userId: PREPARER_A, firmId: FIRM_ALFA, actorKind: "USER" as const };

/** Crea un ejercicio, período y dos cuentas para el cliente de prueba. */
async function setupFixtures(year: number) {
  return runAsRuntime(OWNER_A, FIRM_ALFA, async (tx) => {
    const fy = await tx.fiscalYear.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        startDate: new Date(`${year}-01-01`),
        endDate: new Date(`${year}-12-31`),
        label: `${year}`,
        status: "OPEN",
      },
    });
    const period = await tx.accountingPeriod.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        fiscalYearId: fy.id,
        startDate: new Date(`${year}-01-01`),
        endDate: new Date(`${year}-01-31`),
        ordinal: 1,
        status: "OPEN",
      },
    });
    const caja = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: `1.1.${year}`,
        name: "Caja",
        type: "ASSET",
        normalBalance: "DEBIT",
        isPostable: true,
        path: `1.1.${year}`,
      },
    });
    const capital = await tx.account.create({
      data: {
        firmId: FIRM_ALFA,
        clientId: CLIENT_ALFA,
        code: `3.1.${year}`,
        name: "Capital",
        type: "EQUITY",
        normalBalance: "CREDIT",
        isPostable: true,
        path: `3.1.${year}`,
      },
    });
    return { fy, period, caja, capital };
  });
}

describe("núcleo contable (integración DB)", () => {
  beforeEach(async () => {
    // Limpiar datos de prueba del cliente para idempotencia
    // (incluye tablas de Fase 7 que referencian el ledger)
    await prisma.$executeRawUnsafe(`DELETE FROM bank_matches WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_movements WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_statements WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_reconciliations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM bank_accounts WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_difference_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_runs WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_rates WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM exchange_rate_sources WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_observations WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM inflation_indexes WHERE "clientId" = '${CLIENT_ALFA}'`);
    await prisma.$executeRawUnsafe(
      `DELETE FROM journal_lines WHERE "clientId" = '${CLIENT_ALFA}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM journal_entries WHERE "clientId" = '${CLIENT_ALFA}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM accounts WHERE "clientId" = '${CLIENT_ALFA}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM accounting_periods WHERE "clientId" = '${CLIENT_ALFA}'`,
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM fiscal_years WHERE "clientId" = '${CLIENT_ALFA}'`,
    );
  });

  it("crea borrador, envía, aprueba y postea un asiento balanceado", async () => {
    const fx = await setupFixtures(2026);

    const draft = await journal.createDraft(ctxPreparer, {
      clientId: CLIENT_ALFA,
      fiscalYearId: fx.fy.id,
      periodId: fx.period.id,
      entryDate: "2026-01-15",
      description: "Aporte inicial",
      sourceType: "MANUAL",
      lines: [
        {
          accountId: fx.caja.id,
          currencyCode: "ARS",
          debitOriginal: "100000.00",
          creditOriginal: "0.00",
          debitFunctional: "100000.00",
          creditFunctional: "0.00",
        },
        {
          accountId: fx.capital.id,
          currencyCode: "ARS",
          debitOriginal: "0.00",
          creditOriginal: "100000.00",
          debitFunctional: "0.00",
          creditFunctional: "100000.00",
        },
      ],
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.lines).toHaveLength(2);

    const submitted = await journal.submit(ctxPreparer, draft.id);
    expect(submitted.status).toBe("IN_REVIEW");

    const reviewed = await journal.review(ctxOwner, draft.id);
    expect(reviewed.status).toBe("REVIEWED");

    const posted = await journal.post(ctxOwner, draft.id, reviewed.rowVersion);
    expect(posted.status).toBe("POSTED");
    expect(posted.sequenceNumber).toBe(1);
  });

  it("rechaza asiento desbalanceado", async () => {
    const fx = await setupFixtures(2026);
    await expect(
      journal.createDraft(ctxPreparer, {
        clientId: CLIENT_ALFA,
        fiscalYearId: fx.fy.id,
        periodId: fx.period.id,
        entryDate: "2026-01-15",
        description: "Desbalanceado",
        sourceType: "MANUAL",
        lines: [
          {
            accountId: fx.caja.id,
            currencyCode: "ARS",
            debitOriginal: "100.00",
            creditOriginal: "0.00",
            debitFunctional: "100.00",
            creditFunctional: "0.00",
          },
          {
            accountId: fx.capital.id,
            currencyCode: "ARS",
            debitOriginal: "0.00",
            creditOriginal: "90.00",
            debitFunctional: "0.00",
            creditFunctional: "90.00",
          },
        ],
      }),
    ).rejects.toThrow(EntryError);
  });

  it("maker-checker: el preparador no puede aprobar su propio asiento", async () => {
    const fx = await setupFixtures(2026);
    const draft = await journal.createDraft(ctxPreparer, {
      clientId: CLIENT_ALFA,
      fiscalYearId: fx.fy.id,
      periodId: fx.period.id,
      entryDate: "2026-01-15",
      description: "Auto-aprobación",
      sourceType: "MANUAL",
      lines: [
        {
          accountId: fx.caja.id,
          currencyCode: "ARS",
          debitOriginal: "50.00",
          creditOriginal: "0.00",
          debitFunctional: "50.00",
          creditFunctional: "0.00",
        },
        {
          accountId: fx.capital.id,
          currencyCode: "ARS",
          debitOriginal: "0.00",
          creditOriginal: "50.00",
          debitFunctional: "0.00",
          creditFunctional: "50.00",
        },
      ],
    });
    await journal.submit(ctxPreparer, draft.id);
    await expect(journal.review(ctxPreparer, draft.id)).rejects.toThrow(JournalError);
  });

  it("reversión conserva historia y balancea", async () => {
    const fx = await setupFixtures(2026);
    const draft = await journal.createDraft(ctxPreparer, {
      clientId: CLIENT_ALFA,
      fiscalYearId: fx.fy.id,
      periodId: fx.period.id,
      entryDate: "2026-01-15",
      description: "A revertir",
      sourceType: "MANUAL",
      lines: [
        {
          accountId: fx.caja.id,
          currencyCode: "ARS",
          debitOriginal: "200.00",
          creditOriginal: "0.00",
          debitFunctional: "200.00",
          creditFunctional: "0.00",
        },
        {
          accountId: fx.capital.id,
          currencyCode: "ARS",
          debitOriginal: "0.00",
          creditOriginal: "200.00",
          debitFunctional: "0.00",
          creditFunctional: "200.00",
        },
      ],
    });
    await journal.submit(ctxPreparer, draft.id);
    const reviewed = await journal.review(ctxOwner, draft.id);
    await journal.post(ctxOwner, draft.id, reviewed.rowVersion);

    const reversal = await journal.reverse(ctxOwner, draft.id);
    expect(reversal.status).toBe("POSTED");
    expect(reversal.reversalOfId).toBe(draft.id);

    // El original queda REVERSED
    const original = await runAsRuntime(OWNER_A, FIRM_ALFA, (tx) =>
      tx.journalEntry.findUnique({ where: { id: draft.id } }),
    );
    expect(original?.status).toBe("REVERSED");
    expect(original?.reversedByEntryId).toBe(reversal.id);

    // No se puede revertir dos veces
    await expect(journal.reverse(ctxOwner, draft.id)).rejects.toThrow(JournalError);
  });

  it("balance de sumas y saldos reconcilia", async () => {
    const fx = await setupFixtures(2026);
    const draft = await journal.createDraft(ctxPreparer, {
      clientId: CLIENT_ALFA,
      fiscalYearId: fx.fy.id,
      periodId: fx.period.id,
      entryDate: "2026-01-15",
      description: "Para balance",
      sourceType: "MANUAL",
      lines: [
        {
          accountId: fx.caja.id,
          currencyCode: "ARS",
          debitOriginal: "300.00",
          creditOriginal: "0.00",
          debitFunctional: "300.00",
          creditFunctional: "0.00",
        },
        {
          accountId: fx.capital.id,
          currencyCode: "ARS",
          debitOriginal: "0.00",
          creditOriginal: "300.00",
          debitFunctional: "0.00",
          creditFunctional: "300.00",
        },
      ],
    });
    await journal.submit(ctxPreparer, draft.id);
    const reviewed = await journal.review(ctxOwner, draft.id);
    await journal.post(ctxOwner, draft.id, reviewed.rowVersion);

    const tb = await ledger.trialBalance(FIRM_ALFA, CLIENT_ALFA);
    expect(tb.totals.debitTotal).toBe(tb.totals.creditTotal);
    expect(tb.lines.length).toBeGreaterThan(0);
  });
});
