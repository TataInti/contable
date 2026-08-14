import { prisma } from "../lib/prisma.js";
import { computeBalances, computeTotals, type PostedLine } from "@contable/accounting-engine";

/**
 * Libros contables (Fase 6).
 * Diario, mayor y balance de sumas y saldos, reconstruidos desde líneas posteadas.
 */

export class LedgerService {
  /** Diario: asientos posteados en orden cronológico/numérico. */
  async journal(firmId: string, clientId: string, periodId?: string) {
    const where: Record<string, unknown> = {
      firmId,
      clientId,
      status: { in: ["POSTED", "REVERSED"] },
    };
    if (periodId !== undefined) where.periodId = periodId;

    const entries = await prisma.journalEntry.findMany({
      where,
      include: { lines: { orderBy: { position: "asc" } } },
      orderBy: [{ entryDate: "asc" }, { sequenceNumber: "asc" }],
    });

    return entries.map((e) => ({
      id: e.id,
      sequenceNumber: e.sequenceNumber,
      entryDate: e.entryDate,
      description: e.description,
      status: e.status,
      lines: e.lines.map((l) => ({
        accountId: l.accountId,
        description: l.description,
        debitFunctional: l.debitFunctional.toString(),
        creditFunctional: l.creditFunctional.toString(),
      })),
    }));
  }

  /** Mayor: saldos por cuenta desde líneas posteadas. */
  async ledger(firmId: string, clientId: string, accountId?: string) {
    const where: Record<string, unknown> = {
      firmId,
      clientId,
      entry: { status: { in: ["POSTED", "REVERSED"] } },
    };
    if (accountId !== undefined) where.accountId = accountId;

    const lines = await prisma.journalLine.findMany({
      where,
      include: { account: true },
      orderBy: { position: "asc" },
    });

    const posted: PostedLine[] = lines.map((l) => ({
      accountId: l.accountId,
      debitFunctional: l.debitFunctional.toString(),
      creditFunctional: l.creditFunctional.toString(),
    }));

    const balances = computeBalances(posted);
    const totals = computeTotals(posted);

    return { balances, totals };
  }

  /** Balance de sumas y saldos. */
  async trialBalance(firmId: string, clientId: string, periodId?: string) {
    const where: Record<string, unknown> = {
      firmId,
      clientId,
      entry: { status: { in: ["POSTED", "REVERSED"] } },
    };
    if (periodId !== undefined) where.entry = { ...(where.entry as object), periodId };

    const lines = await prisma.journalLine.findMany({
      where,
      include: { account: true },
    });

    const posted: PostedLine[] = lines.map((l) => ({
      accountId: l.accountId,
      debitFunctional: l.debitFunctional.toString(),
      creditFunctional: l.creditFunctional.toString(),
    }));

    const balances = computeBalances(posted);
    const totals = computeTotals(posted);

    // Enriquecer con código/nombre de cuenta
    const accountMap = new Map(lines.map((l) => [l.accountId, l.account]));
    const enriched = balances.map((b) => {
      const acc = accountMap.get(b.accountId);
      return {
        accountId: b.accountId,
        accountCode: acc?.code ?? "",
        accountName: acc?.name ?? "",
        debitTotal: b.debitTotal,
        creditTotal: b.creditTotal,
        balance: b.balance,
        normalBalance: acc?.normalBalance ?? "DEBIT",
      };
    });

    return {
      clientId,
      cutoff: new Date().toISOString(),
      lines: enriched,
      totals,
    };
  }
}
