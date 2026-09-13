import { describe, expect, it } from "vitest";
import { calculateLateInterest } from "./interest.js";

describe("mora fiscal determinista", () => {
  it("calcula capital × tasa mensual / 30 × días", () => {
    const result = calculateLateInterest({
      principal: "1000",
      dueDate: "2026-02-20",
      asOfDate: "2026-03-22",
      monthlyRate: "0.06",
    });
    expect(result.daysLate).toBe(30);
    expect(result.amount).toBe("60.00");
    expect(result.outstandingAmount).toBe("1000.0000");
  });

  it("segmenta pagos parciales desde la fecha de pago", () => {
    const result = calculateLateInterest({
      principal: "1000",
      dueDate: "2026-02-20",
      asOfDate: "2026-03-22",
      monthlyRate: "0.06",
      payments: [{ id: "p1", paidAt: "2026-03-02", amount: "400" }],
    });
    // 1000 × 0.06 / 30 × 10 + 600 × 0.06 / 30 × 20
    expect(result.amount).toBe("44.00");
    expect(result.outstandingAmount).toBe("600.0000");
    expect(result.segments).toHaveLength(2);
  });

  it("aplica pagos anteriores al vencimiento sin generar interés", () => {
    const result = calculateLateInterest({
      principal: "1000",
      dueDate: "2026-02-20",
      asOfDate: "2026-03-22",
      monthlyRate: "0.06",
      payments: [{ id: "p1", paidAt: "2026-02-10", amount: "1000" }],
    });
    expect(result.amount).toBe("0.00");
    expect(result.outstandingAmount).toBe("0.0000");
  });

  it("produce el mismo hash aunque los pagos lleguen desordenados", () => {
    const base = {
      principal: "1000",
      dueDate: "2026-02-20",
      asOfDate: "2026-03-22",
      monthlyRate: "0.06",
    } as const;
    const p1 = { id: "p1", paidAt: "2026-03-01", amount: "100" };
    const p2 = { id: "p2", paidAt: "2026-03-02", amount: "100" };
    expect(calculateLateInterest({ ...base, payments: [p1, p2] }).inputHash).toBe(
      calculateLateInterest({ ...base, payments: [p2, p1] }).inputHash,
    );
  });
});
