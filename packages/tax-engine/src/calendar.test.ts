import { describe, expect, it } from "vitest";
import { calculateDueDate, nextBusinessDay, periodsForRange } from "./calendar.js";

describe("calendario fiscal (G1-10)", () => {
  it("vencimiento en día hábil se mantiene", () => {
    // Lunes 20 de enero de 2026
    const result = calculateDueDate(
      { id: "r1", frequency: "MONTHLY", dueDay: 20, validFrom: "2026-01-01" },
      { startDate: "2026-01-01", endDate: "2026-01-31" },
      [],
    );
    expect(result.dueDate).toBe("2026-01-20");
    expect(result.adjusted).toBe(false);
  });

  it("fin de semana se corre al lunes", () => {
    // 2026-01-18 cae domingo → lunes 19
    const result = calculateDueDate(
      { id: "r1", frequency: "MONTHLY", dueDay: 18, validFrom: "2026-01-01" },
      { startDate: "2026-01-01", endDate: "2026-01-31" },
      [],
    );
    expect(result.dueDate).toBe("2026-01-19");
    expect(result.adjusted).toBe(true);
  });

  it("feriado corre al día hábil siguiente", () => {
    const result = calculateDueDate(
      { id: "r1", frequency: "MONTHLY", dueDay: 20, validFrom: "2026-01-01" },
      { startDate: "2026-01-01", endDate: "2026-01-31" },
      [{ jurisdictionId: "AR", date: "2026-01-20" }],
    );
    expect(result.dueDate).toBe("2026-01-21");
  });

  it("terminación de CUIT filtra reglas", () => {
    expect(() =>
      calculateDueDate(
        { id: "r1", frequency: "MONTHLY", dueDay: 15, cuitEnding: "5", validFrom: "2026-01-01" },
        { startDate: "2026-01-01", endDate: "2026-01-31" },
        [],
        "9", // CUIT termina en 9
      ),
    ).toThrow(/no aplica/);
  });

  it("nextBusinessDay salta sábado y domingo", () => {
    expect(nextBusinessDay("2026-01-17", [])).toBe("2026-01-19"); // sáb 17 → lun 19
    expect(nextBusinessDay("2026-01-18", [])).toBe("2026-01-19"); // dom 18 → lun 19
  });

  it("genera períodos mensuales y trimestrales", () => {
    const monthly = periodsForRange("MONTHLY", "2026-01", "2026-03");
    expect(monthly).toHaveLength(3);
    expect(monthly[0]).toEqual({ startDate: "2026-01-01", endDate: "2026-01-31" });
    expect(monthly[2]).toEqual({ startDate: "2026-03-01", endDate: "2026-03-31" });

    const quarterly = periodsForRange("QUARTERLY", "2026-01", "2026-12");
    expect(quarterly).toHaveLength(4);
    expect(quarterly[1]).toEqual({ startDate: "2026-04-01", endDate: "2026-04-30" });
  });
});