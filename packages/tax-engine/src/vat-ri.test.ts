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
  const taxRates = { "21": "0.21", "10.5": "0.105", "27": "0.27" } as const;
  return {
    id,
    direction,
    date,
    rate,
    net: new Decimal(net),
    tax: rate === "EXENTO" || rate === "NO_GRAVADO"
      ? new Decimal(0)
      : new Decimal(net).times(taxRates[rate]),
    isCreditNote,
  };
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
      decree814: { netRemuneration: dec("50000.00"), rate: dec("0.065"), runCount: 1 },
    });
    expect(result.subtotals["CREDITO_DTO_814"]).toBe("3250.00");
    expect(result.lines.some((l) => l.concept === "CREDITO_DTO_814")).toBe(true);
  });

  it("arrastra por separado los saldos técnico y libre anteriores", () => {
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
    // Crédito 21000 + saldo técnico anterior 5000 = 26000 de primer párrafo.
    // El saldo libre mantiene sus 3000 porque no existe saldo técnico a pagar.
    expect(result.subtotals["SALDO_TECNICO_AFTER"]).toBe("26000.00");
    expect(result.subtotals["SALDO_LIBRE_AFTER"]).toBe("3000.00");
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

  it("compensaciones reducen y restituciones aumentan el total", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [comp("f1", "SALE", "2026-01-10", "21", "100000.00")],
      rules: RULES,
      credits: {
        withholding: dec(0),
        perception: dec(0),
        restitution: dec("1000.00"),
        compensation: dec("2000.00"),
        technicalPrevious: dec(0),
        freeAvailabilityPrevious: dec(0),
      },
    });
    expect(result.totalDue).toBe("20000.00"); // 21000 - (2000 - 1000)
  });

  it("retenciones y percepciones no alteran el saldo técnico", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [comp("f1", "SALE", "2026-01-10", "21", "100000.00")],
      rules: RULES,
      credits: {
        withholding: dec("2000.00"),
        perception: dec("1000.00"),
        restitution: dec(0),
        compensation: dec(0),
        technicalPrevious: dec(0),
        freeAvailabilityPrevious: dec(0),
      },
    });
    expect(result.subtotals["SALDO_TECNICO_A_INGRESAR"]).toBe("21000.00");
    expect(result.totalDue).toBe("18000.00");
    expect(result.subtotals["SALDO_TECNICO_AFTER"]).toBe("0.00");
  });

  it("bloquea una alícuota sin regla activa", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [comp("f1", "SALE", "2026-01-10", "27", "10000.00")],
      rules: RULES.filter((rule) => rule.concept !== "IVA_27"),
    });
    expect(result.blocks).toContain("Falta la regla activa IVA_27 para calcular IVA");
  });

  it("suma el IVA fuente y bloquea una diferencia material contra base × tasa", () => {
    const component = comp("f1", "SALE", "2026-01-10", "21", "100000.00");
    component.tax = dec("20900.00");
    const result = calculateVatRi({ period: PERIOD, components: [component], rules: RULES });
    expect(result.subtotals["DEBITO_FISCAL"]).toBe("20900.00");
    expect(result.blocks.some((block) => block.includes("difiere 100.00"))).toBe(true);
  });

  it("bloquea Dto. 814 con múltiples F.931 revisados", () => {
    const result = calculateVatRi({
      period: PERIOD,
      components: [],
      rules: [...RULES, { concept: "DTO_814", rate: dec("0.065") }],
      decree814: { netRemuneration: dec("50000"), rate: dec("0.065"), runCount: 2 },
    });
    expect(result.blocks).toContain(
      "Dto. 814 requiere una única corrida F.931 revisada para el período",
    );
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
