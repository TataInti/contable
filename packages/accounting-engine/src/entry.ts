import { dec, moneyToString, type DecimalValue } from "./decimal.js";

/** Códigos de error del motor de asientos. */
export type EntryErrorCode =
  | "ZERO_LINE"
  | "AMBIGUOUS_LINE"
  | "NEGATIVE_AMOUNT"
  | "UNBALANCED_ENTRY"
  | "INSUFFICIENT_LINES"
  | "FUNCTIONAL_MISMATCH";

export class EntryError extends Error {
  readonly code: EntryErrorCode;
  constructor(code: EntryErrorCode, message: string) {
    super(message);
    this.name = "EntryError";
    this.code = code;
  }
}

export interface EngineLine {
  debitOriginal: string | DecimalValue;
  creditOriginal: string | DecimalValue;
  debitFunctional: string | DecimalValue;
  creditFunctional: string | DecimalValue;
  exchangeRate?: string | DecimalValue;
}

/** Valida una línea individual. */
export function validateLine(line: EngineLine): void {
  const debit = dec(line.debitOriginal);
  const credit = dec(line.creditOriginal);

  if (debit.isNegative() || credit.isNegative()) {
    throw new EntryError("NEGATIVE_AMOUNT", "Los importes no pueden ser negativos");
  }
  if (debit.isZero() && credit.isZero()) {
    throw new EntryError("ZERO_LINE", "Una línea no puede estar en cero");
  }
  if (debit.greaterThan(0) && credit.greaterThan(0)) {
    throw new EntryError("AMBIGUOUS_LINE", "No puede haber débito y crédito simultáneos");
  }
}

/**
 * Valida que el importe funcional = original × tasa (o = original si no hay tasa),
 * dentro de la política de redondeo.
 */
export function validateFunctional(line: EngineLine): void {
  const debitOriginal = dec(line.debitOriginal);
  const creditOriginal = dec(line.creditOriginal);
  const functionalDebit = dec(line.debitFunctional);
  const functionalCredit = dec(line.creditFunctional);

  if (debitOriginal.greaterThan(0)) {
    const rate = line.exchangeRate ? dec(line.exchangeRate) : dec(1);
    const expected = debitOriginal.mul(rate);
    if (!expected.eq(functionalDebit)) {
      throw new EntryError(
        "FUNCTIONAL_MISMATCH",
        `Débito funcional ${functionalDebit} ≠ original ${debitOriginal} × tasa ${rate}`,
      );
    }
  }
  if (creditOriginal.greaterThan(0)) {
    const rate = line.exchangeRate ? dec(line.exchangeRate) : dec(1);
    const expected = creditOriginal.mul(rate);
    if (!expected.eq(functionalCredit)) {
      throw new EntryError(
        "FUNCTIONAL_MISMATCH",
        `Crédito funcional ${functionalCredit} ≠ original ${creditOriginal} × tasa ${rate}`,
      );
    }
  }
}

export interface ValidationResult {
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
}

/** Valida un asiento completo (líneas + balance). */
export function validateEntry(lines: EngineLine[]): ValidationResult {
  if (lines.length < 2) {
    throw new EntryError("INSUFFICIENT_LINES", "Un asiento requiere al menos dos líneas");
  }

  let totalDebit = dec(0);
  let totalCredit = dec(0);

  for (const line of lines) {
    validateLine(line);
    validateFunctional(line);
    totalDebit = totalDebit.plus(dec(line.debitFunctional));
    totalCredit = totalCredit.plus(dec(line.creditFunctional));
  }

  const balanced = totalDebit.eq(totalCredit);
  return {
    totalDebit: moneyToString(totalDebit),
    totalCredit: moneyToString(totalCredit),
    balanced,
  };
}

/** Verifica que el asiento balancee; lanza si no. */
export function assertBalanced(lines: EngineLine[]): ValidationResult {
  const result = validateEntry(lines);
  if (!result.balanced) {
    throw new EntryError(
      "UNBALANCED_ENTRY",
      `Asiento desbalanceado: débitos ${result.totalDebit} ≠ créditos ${result.totalCredit}`,
    );
  }
  return result;
}