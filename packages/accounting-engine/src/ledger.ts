import { dec, type DecimalValue } from "./decimal.js";

export interface PostedLine {
  accountId: string;
  debitFunctional: string | DecimalValue;
  creditFunctional: string | DecimalValue;
}

/** Saldo por cuenta derivado de líneas posteadas. */
export interface AccountBalance {
  accountId: string;
  debitTotal: string;
  creditTotal: string;
  balance: string;
}

export interface LedgerTotals {
  debitTotal: string;
  creditTotal: string;
}

/**
 * Reconstruye saldos por cuenta desde líneas posteadas.
 * Es el dato canónico; los agregados son siempre reconstruibles.
 */
export function computeBalances(lines: PostedLine[]): AccountBalance[] {
  const map = new Map<string, { debit: DecimalValue; credit: DecimalValue }>();

  for (const line of lines) {
    const entry = map.get(line.accountId) ?? { debit: dec(0), credit: dec(0) };
    entry.debit = entry.debit.plus(dec(line.debitFunctional));
    entry.credit = entry.credit.plus(dec(line.creditFunctional));
    map.set(line.accountId, entry);
  }

  const result: AccountBalance[] = [];
  for (const [accountId, { debit, credit }] of map) {
    result.push({
      accountId,
      debitTotal: debit.toFixed(4),
      creditTotal: credit.toFixed(4),
      balance: debit.minus(credit).toFixed(4),
    });
  }
  return result;
}

/** Totales globales de débitos y créditos. */
export function computeTotals(lines: PostedLine[]): LedgerTotals {
  let debit = dec(0);
  let credit = dec(0);
  for (const line of lines) {
    debit = debit.plus(dec(line.debitFunctional));
    credit = credit.plus(dec(line.creditFunctional));
  }
  return { debitTotal: debit.toFixed(4), creditTotal: credit.toFixed(4) };
}