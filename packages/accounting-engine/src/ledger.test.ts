import { beforeEach, describe, expect, it } from "vitest";
import { computeBalances, computeTotals } from "./ledger.js";
import { peekNext, reserveNext, resetSequencer, seedState } from "./sequencer.js";

describe("computeBalances", () => {
  it("agrega débitos y créditos por cuenta", () => {
    const balances = computeBalances([
      { accountId: "a", debitFunctional: "100", creditFunctional: "0" },
      { accountId: "a", debitFunctional: "50", creditFunctional: "0" },
      { accountId: "b", debitFunctional: "0", creditFunctional: "150" },
    ]);
    expect(balances).toContainEqual({
      accountId: "a",
      debitTotal: "150.0000",
      creditTotal: "0.0000",
      balance: "150.0000",
    });
    expect(balances).toContainEqual({
      accountId: "b",
      debitTotal: "0.0000",
      creditTotal: "150.0000",
      balance: "-150.0000",
    });
  });

  it("es reconstruible: mismo input → mismo output", () => {
    const lines = [
      { accountId: "a", debitFunctional: "100", creditFunctional: "0" },
      { accountId: "b", debitFunctional: "0", creditFunctional: "100" },
    ];
    expect(computeBalances(lines)).toEqual(computeBalances(lines));
  });
});

describe("computeTotals", () => {
  it("suma débitos y créditos globales", () => {
    const totals = computeTotals([
      { accountId: "a", debitFunctional: "100", creditFunctional: "0" },
      { accountId: "b", debitFunctional: "0", creditFunctional: "100" },
    ]);
    expect(totals).toEqual({ debitTotal: "100.0000", creditTotal: "100.0000" });
  });
});

describe("sequencer", () => {
  beforeEach(() => resetSequencer());

  it("L-010 asigna números consecutivos por cliente/ejercicio", () => {
    expect(reserveNext("c1", "fy1")).toBe(1);
    expect(reserveNext("c1", "fy1")).toBe(2);
    expect(reserveNext("c2", "fy1")).toBe(1);
    expect(reserveNext("c1", "fy2")).toBe(1);
  });

  it("peekNext no consume", () => {
    seedState("c1", "fy1", 10);
    expect(peekNext("c1", "fy1")).toBe(10);
    expect(peekNext("c1", "fy1")).toBe(10);
  });
});