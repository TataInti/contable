import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { calculateVatRi, VAT_RI_ENGINE_VERSION } from "./vat-ri.js";
import { dec } from "./core.js";

/**
 * Golden tests del motor IVA RI por componente/alícuota (F1.3).
 * Cada caso fija entrada y resultado esperado al centavo.
 */

const PERIOD = { startDate: "2026-01-01", endDate: "2026-01-31", cutoff: "2026-01-31" };

const RULES = [
  { concept: "IVA_21", rate: dec("0.21"), validFrom: "2026-01-01" },
  { concept: "IVA_105", rate: dec("0.105"), validFrom: "2026-01-01" },
  { concept: "IVA_27", rate: dec("0.27"), validFrom: "2026-01-01" },
];

function comp(
  id: string,
  direction: "SALE" | "PURCHASE",
  date: string,
  rate: "21" | "10.5" | "27" | "EXENTO" | "NO_GRAVADO",
  net: string,
  isCreditNote = false,
) {
  return { id, direction, date, rate, net: new Decimal(net), isCreditNote };
}

describe("motor IVA RI por componente (F1.3)", () => {
  it("ventas y compras al 21%: débito − crédito = total", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [
        comp("f1", "SALE", "2026-01-10", "21", "100000.00"),
        comp("f2", "PURCHASE", "2026-01-12", "21", "40000.00"),
      ],
      rules: RULES,
    });
    expect(result.subtotals["DEBITO_FISCAL"]).toBe("21000.00");
    expect(result.subtotals["CREDITO_FISCAL"]).toBe("8400.00");
    expect(result.totalDue).toBe("12600.00");
    expect(result.blocks).toHaveLength(0);
  });

  it("desglosa por alícuota 21/10.5/27", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [
        comp("f1", "SALE", "2026-01-10", "21", "100000.00"),
        comp("f2", "SALE", "2026-01-11", "10.5", "50000.00"),
        comp("f3", "SALE", "2026-01-12", "27", "20000.00"),
      ],
      rules: RULES,
    });
    expect(result.subtotals["DEBITO_FISCAL"]).toBe("31650.00"); // 21000 + 5250 + 5400
    expect(result.lines.some((l) => l.concept === "DEBITO_IVA_21")).toBe(true);
    expect(result.lines.some((l) => l.concept === "DEBITO_IVA_105")).toBe(true);
    expect(result.lines.some((l) => l.concept === "DEBITO_IVA_27")).toBe(true);
  });

  it("nota de crédito resta del débito de su alícuota", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [
        comp("f1", "SALE", "2026-01-10", "21", "100000.00"),
        comp("nc1", "SALE", "2026-01-15", "21", "10000.00", true),
      ],
      rules: RULES,
    });
    expect(result.subtotals["DEBITO_FISCAL"]).toBe("18900.00"); // (100000 - 10000) × 0.21
  });

  it("crédito Dto. 814 desde F.931", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [comp("f1", "SALE", "2026-01-10", "21", "100000.00")],
      rules: RULES,
      decree814: { netRemuneration: dec("50000.00"), rate: dec("0.21") },
    });
    expect(result.subtotals["CREDITO_DTO_814"]).toBe("10500.00");
    expect(result.lines.some((l) => l.concept === "CREDITO_DTO_814")).toBe(true);
  });

  it("saldo técnico anterior (primer párrafo) se aplica antes que el libre", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [comp("f1", "PURCHASE", "2026-01-10", "21", "100000.00")],
      rules: RULES,
      credits: {
        withholding: dec(0),
        perception: dec(0),
        restitution: dec(0),
        compensation: dec(0),
        technicalPrevious: dec("5000.00"),
        freeAvailabilityPrevious: dec("3000.00"),
      },
    });
    // Crédito 21000 − débito 0 = 21000 a favor. Se consume 5000 técnico y
    // 3000 libre; quedan 13000 técnico.
    expect(result.subtotals["SALDO_TECNICO_AFTER"]).toBe("13000.00");
    expect(result.subtotals["SALDO_LIBRE_AFTER"]).toBe("0.00");
    expect(result.totalDue).toBe("0.00");
  });

  it("débito neto aplica saldo libre anterior (segundo párrafo)", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [comp("f1", "SALE", "2026-01-10", "21", "100000.00")],
      rules: RULES,
      credits: {
        withholding: dec(0),
        perception: dec(0),
        restitution: dec(0),
        compensation: dec(0),
        technicalPrevious: dec(0),
        freeAvailabilityPrevious: dec("5000.00"),
      },
    });
    expect(result.totalDue).toBe("16000.00"); // 21000 - 5000
    expect(result.subtotals["SALDO_LIBRE_AFTER"]).toBe("0.00");
  });

  it("restituciones y compensaciones reducen el total", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [comp("f1", "SALE", "2026-01-10", "21", "100000.00")],
      rules: RULES,
      credits: {
        withholding: dec(0),
        perception: dec(0),
        restitution: dec("2000.00"),
        compensation: dec("1000.00"),
        technicalPrevious: dec(0),
        freeAvailabilityPrevious: dec(0),
      },
    });
    expect(result.totalDue).toBe("18000.00"); // 21000 - 2000 - 1000
  });

  it("misma entrada → mismo hash (determinismo)", () => {
    const input = {
      period: PERIOD,
      components: [
        comp("f1", "SALE", "2026-01-10", "21", "100000.00"),
        comp("f2", "PURCHASE", "2026-01-12", "21", "40000.00"),
      ],
      rules: RULES,
    };
    const a = calculateVatRi(input);
    const b = calculateVatRi(input);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.outputHash).toBe(b.outputHash);
    expect(a.engineVersion).toBe(VAT_RI_ENGINE_VERSION);
  });

  it("componente fuera del cutoff no afecta el resultado", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [
        comp("f1", "SALE", "2026-01-10", "21", "100000.00"),
        comp("f2", "PURCHASE", "2026-02-05", "21", "40000.00"),
      ],
      rules: RULES,
    });
    expect(result.totalDue).toBe("21000.00");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});