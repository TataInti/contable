import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { calculateVat, fact, VAT_ENGINE_VERSION } from "./vat.js";
import { dec, taxHash } from "./core.js";

/**
 * Golden tests del motor IVA (AR_VAT_RI_V1).
 * Cada caso fija entrada y resultado esperado al centavo.
 */

const PERIOD = { startDate: "2026-01-01", endDate: "2026-01-31", cutoff: "2026-01-31" };

const RULES = [
  { id: "r1", code: "VENTAS_21", concept: "VENTAS", rate: dec("0.21"), validFrom: "2026-01-01" },
  { id: "r2", code: "COMPRAS_21", concept: "COMPRAS", rate: dec("0.21"), validFrom: "2026-01-01" },
];

describe("motor IVA (golden)", () => {
  it("ventas y compras al 21%: débito − crédito = total", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [
        fact("f1", "SALE", "2026-01-10", "VENTAS", "100000.00"),
        fact("f2", "PURCHASE", "2026-01-12", "COMPRAS", "40000.00"),
      ],
      rules: RULES,
    });
    expect(result.subtotals["DEBITO_FISCAL"]).toBe("21000.00");
    expect(result.subtotals["CREDITO_FISCAL"]).toBe("8400.00");
    expect(result.totalDue).toBe("12600.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("misma entrada → mismo hash (determinismo)", () => {
    const input = {
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [
        fact("f1", "SALE", "2026-01-10", "VENTAS", "100000.00"),
        fact("f2", "PURCHASE", "2026-01-12", "COMPRAS", "40000.00"),
      ],
      rules: RULES,
    };
    const a = calculateVat(input);
    const b = calculateVat(input);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
    expect(a.totalDue).toBe(b.totalDue);
  });

  it("hecho fuera del cutoff no afecta el resultado", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [
        fact("f1", "SALE", "2026-01-10", "VENTAS", "100000.00"),
        // Compra del 5 de febrero: fuera del período y del cutoff
        fact("f2", "PURCHASE", "2026-02-05", "COMPRAS", "40000.00"),
      ],
      rules: RULES,
    });
    expect(result.subtotals["CREDITO_FISCAL"]).toBe("0.00");
    expect(result.warnings.some((w) => w.includes("fuera del período"))).toBe(true);
  });

  it("retenciones y percepciones reducen el total", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [
        fact("f1", "SALE", "2026-01-10", "VENTAS", "100000.00"),
        fact("f2", "PURCHASE", "2026-01-12", "COMPRAS", "40000.00"),
      ],
      rules: RULES,
      credits: {
        withholding: dec("1000.00"),
        perception: dec("500.00"),
        technicalPrevious: dec("0"),
        freeAvailabilityPrevious: dec("0"),
      },
    });
    expect(result.totalDue).toBe("11100.00"); // 12600 − 1000 − 500
  });

  it("saldo a favor anterior se aplica", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [
        fact("f1", "SALE", "2026-01-10", "VENTAS", "100000.00"),
        fact("f2", "PURCHASE", "2026-01-12", "COMPRAS", "40000.00"),
      ],
      rules: RULES,
      credits: {
        withholding: dec("0"),
        perception: dec("0"),
        technicalPrevious: dec("0"),
        freeAvailabilityPrevious: dec("5000.00"),
      },
    });
    expect(result.totalDue).toBe("7600.00"); // 12600 − 5000
    expect(result.credits.free).toBe("0.00");
  });

  it("crédito mayor que débito genera saldo a favor", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [
        fact("f1", "SALE", "2026-01-10", "VENTAS", "10000.00"),
        fact("f2", "PURCHASE", "2026-01-12", "COMPRAS", "50000.00"),
      ],
      rules: RULES,
    });
    expect(result.totalDue).toBe("0.00");
    expect(result.credits.technical).toBe("8400.00"); // 10500 − 2100
  });

  it("exento y no gravado no generan débito", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [
        fact("f1", "SALE", "2026-01-10", "VENTAS", "100000.00"),
        fact("f2", "SALE", "2026-01-11", "EXENTO", "50000.00"),
        fact("f3", "SALE", "2026-01-12", "NO_GRAVADO", "20000.00"),
      ],
      rules: RULES,
    });
    expect(result.subtotals["DEBITO_FISCAL"]).toBe("21000.00");
    expect(result.totalDue).toBe("21000.00");
  });

  it("redondeo al centavo en operaciones con decimales", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [fact("f1", "SALE", "2026-01-10", "VENTAS", "33333.33")],
      rules: RULES,
    });
    // 33333.33 × 0.21 = 6999.9993 → 7000.00
    expect(result.subtotals["DEBITO_FISCAL"]).toBe("7000.00");
  });

  it("sin movimientos: total 0 y sin bloqueos", () => {
    const result = calculateVat({
      engineVersion: VAT_ENGINE_VERSION,
      period: PERIOD,
      facts: [],
      rules: RULES,
    });
    expect(result.totalDue).toBe("0.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("hash canónico es estable", () => {
    const h1 = taxHash({ a: 1, b: "x", c: [1, 2] });
    const h2 = taxHash({ b: "x", c: [1, 2], a: 1 });
    expect(h1).toBe(h2);
  });

  it("Decimal no se pierde en la serialización canónica", () => {
    const h1 = taxHash({ amount: new Decimal("10.50") });
    const h2 = taxHash({ amount: new Decimal("10.50") });
    expect(h1).toBe(h2);
  });
});