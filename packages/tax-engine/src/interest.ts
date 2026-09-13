import { Decimal } from "decimal.js";
import { fmtMoney, roundMoney, taxHash } from "./core.js";

export const LATE_INTEREST_ENGINE_VERSION = "ar-late-interest-v1.0.0";

export interface LateInterestPayment {
  id: string;
  paidAt: string;
  amount: string;
}

export interface LateInterestInput {
  principal: string;
  dueDate: string;
  asOfDate: string;
  /** Tasa mensual expresada como ratio: 0.05 equivale a 5 %. */
  monthlyRate: string;
  payments?: readonly LateInterestPayment[];
}

export interface LateInterestSegment {
  from: string;
  to: string;
  days: number;
  base: string;
  interest: string;
  paymentApplied: string;
}

export interface LateInterestResult {
  engineVersion: string;
  baseAmount: string;
  outstandingAmount: string;
  dueDate: string;
  asOfDate: string;
  daysLate: number;
  monthlyRate: string;
  amount: string;
  segments: LateInterestSegment[];
  inputHash: string;
}

function isoDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Fecha inválida: ${value}`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Fecha inválida: ${value}`);
  }
  return value;
}

function calendarDays(from: string, to: string): number {
  return Math.max(
    0,
    Math.floor(
      (new Date(`${to}T00:00:00.000Z`).getTime() -
        new Date(`${from}T00:00:00.000Z`).getTime()) /
        86_400_000,
    ),
  );
}

/**
 * Interés resarcitorio simple: saldo × (tasa mensual / 30) × días.
 * Cada pago reduce la base desde su fecha, por lo que no se cobra mora sobre
 * capital ya cancelado. El redondeo monetario se aplica al total final.
 */
export function calculateLateInterest(input: LateInterestInput): LateInterestResult {
  const dueDate = isoDay(input.dueDate);
  const asOfDate = isoDay(input.asOfDate);
  const principal = new Decimal(input.principal);
  const monthlyRate = new Decimal(input.monthlyRate);
  if (principal.isNegative()) throw new Error("El capital de mora no puede ser negativo");
  if (monthlyRate.isNegative()) throw new Error("La tasa de mora no puede ser negativa");

  const payments = [...(input.payments ?? [])]
    .map((payment) => ({
      ...payment,
      paidAt: isoDay(payment.paidAt),
      decimalAmount: new Decimal(payment.amount),
    }))
    .filter((payment) => payment.paidAt <= asOfDate)
    .sort((a, b) => a.paidAt.localeCompare(b.paidAt) || a.id.localeCompare(b.id));
  if (payments.some((payment) => payment.decimalAmount.lessThanOrEqualTo(0))) {
    throw new Error("Los pagos aplicados a la mora deben ser positivos");
  }

  let outstanding = principal;
  let cursor = dueDate;
  let accrued = new Decimal(0);
  const segments: LateInterestSegment[] = [];

  for (const payment of payments) {
    const effectiveDate = payment.paidAt < dueDate ? dueDate : payment.paidAt;
    if (effectiveDate > asOfDate) continue;
    const days = calendarDays(cursor, effectiveDate);
    const segmentInterest = outstanding.mul(monthlyRate).div(30).mul(days);
    const applied = Decimal.min(outstanding, payment.decimalAmount);
    if (days > 0 || applied.greaterThan(0)) {
      segments.push({
        from: cursor,
        to: effectiveDate,
        days,
        base: outstanding.toFixed(4),
        interest: segmentInterest.toFixed(8),
        paymentApplied: applied.toFixed(4),
      });
    }
    accrued = accrued.plus(segmentInterest);
    outstanding = Decimal.max(outstanding.minus(applied), 0);
    cursor = effectiveDate;
  }

  const finalDays = calendarDays(cursor, asOfDate);
  const finalInterest = outstanding.mul(monthlyRate).div(30).mul(finalDays);
  if (finalDays > 0) {
    segments.push({
      from: cursor,
      to: asOfDate,
      days: finalDays,
      base: outstanding.toFixed(4),
      interest: finalInterest.toFixed(8),
      paymentApplied: "0.0000",
    });
  }
  accrued = accrued.plus(finalInterest);

  const canonicalInput = {
    engineVersion: LATE_INTEREST_ENGINE_VERSION,
    principal: principal.toFixed(4),
    dueDate,
    asOfDate,
    monthlyRate: monthlyRate.toFixed(6),
    payments: payments.map((payment) => ({
      id: payment.id,
      paidAt: payment.paidAt,
      amount: payment.decimalAmount.toFixed(4),
    })),
  };
  return {
    engineVersion: LATE_INTEREST_ENGINE_VERSION,
    baseAmount: principal.toFixed(4),
    outstandingAmount: outstanding.toFixed(4),
    dueDate,
    asOfDate,
    daysLate: calendarDays(dueDate, asOfDate),
    monthlyRate: monthlyRate.toFixed(6),
    amount: fmtMoney(roundMoney(accrued)),
    segments,
    inputHash: taxHash(canonicalInput),
  };
}
