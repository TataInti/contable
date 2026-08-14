import { describe, expect, it } from "vitest";
import {
  EntryError,
  assertBalanced,
  validateEntry,
  validateLine,
} from "./entry.js";
import { moneyToString, toFunctional } from "./decimal.js";

describe("validateLine", () => {
  it("L-003 rechaza línea en cero", () => {
    expect(() =>
      validateLine({
        debitOriginal: "0",
        creditOriginal: "0",
        debitFunctional: "0",
        creditFunctional: "0",
      }),
    ).toThrowError(EntryError);
  });

  it("L-004 rechaza débito y crédito simultáneos", () => {
    expect(() =>
      validateLine({
        debitOriginal: "100",
        creditOriginal: "50",
        debitFunctional: "100",
        creditFunctional: "50",
      }),
    ).toThrowError(/débito y crédito simultáneos/);
  });

  it("L-005 rechaza importe negativo", () => {
    expect(() =>
      validateLine({
        debitOriginal: "-100",
        creditOriginal: "0",
        debitFunctional: "-100",
        creditFunctional: "0",
      }),
    ).toThrowError(/negativos/);
  });
});

describe("assertBalanced", () => {
  it("L-001 acepta asiento balanceado", () => {
    const result = assertBalanced([
      {
        debitOriginal: "121000",
        creditOriginal: "0",
        debitFunctional: "121000",
        creditFunctional: "0",
      },
      {
        debitOriginal: "0",
        creditOriginal: "121000",
        debitFunctional: "0",
        creditFunctional: "121000",
      },
    ]);
    expect(result.balanced).toBe(true);
    expect(result.totalDebit).toBe("121000.0000");
    expect(result.totalCredit).toBe("121000.0000");
  });

  it("L-002 rechaza asiento desbalanceado", () => {
    expect(() =>
      assertBalanced([
        {
          debitOriginal: "121000",
          creditOriginal: "0",
          debitFunctional: "121000",
          creditFunctional: "0",
        },
        {
          debitOriginal: "0",
          creditOriginal: "120000",
          debitFunctional: "0",
          creditFunctional: "120000",
        },
      ]),
    ).toThrowError(/desbalanceado/);
  });

  it("L-001b rechaza asiento de una sola línea", () => {
    expect(() =>
      assertBalanced([
        {
          debitOriginal: "100",
          creditOriginal: "0",
          debitFunctional: "100",
          creditFunctional: "0",
        },
      ]),
    ).toThrowError(/al menos dos líneas/);
  });
});

describe("toFunctional", () => {
  it("L-023 convierte original × tasa", () => {
    expect(moneyToString(toFunctional("1000", "1200.00000000"))).toBe("1200000.0000");
  });

  it("L-022 redondea correctamente", () => {
    expect(moneyToString(toFunctional("1000", "1.23456789"))).toBe("1234.5679");
  });
});

describe("validateEntry", () => {
  it("reporta totales", () => {
    const result = validateEntry([
      {
        debitOriginal: "100",
        creditOriginal: "0",
        debitFunctional: "100",
        creditFunctional: "0",
      },
      {
        debitOriginal: "0",
        creditOriginal: "100",
        debitFunctional: "0",
        creditFunctional: "100",
      },
    ]);
    expect(result).toEqual({
      totalDebit: "100.0000",
      totalCredit: "100.0000",
      balanced: true,
    });
  });
});