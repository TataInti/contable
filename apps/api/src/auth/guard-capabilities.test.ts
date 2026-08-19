import { describe, expect, it } from "vitest";
import { requiredCapability } from "./guard.js";

/**
 * Fija el mapeo ruta→capacidad del guard deny-by-default (PLAN §4.3).
 * Estos tests protegen contra escapes de permisos: una ruta de mutación
 * nunca debe caer en una capacidad de lectura o en una de menor privilegio.
 */
describe("requiredCapability (mapeo ruta → capacidad)", () => {
  it("rectify-with-delta exige tax.settlements.rectify (no calculate)", () => {
    // G4.4 fix: un PREPARER tiene calculate pero NO rectify; no debe poder
    // iniciar una rectificativa con delta.
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-settlements/s/rectify-with-delta"),
    ).toBe("tax.settlements.rectify");
  });

  it("rectify exige tax.settlements.rectify", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-settlements/s/rectify"),
    ).toBe("tax.settlements.rectify");
  });

  it("calculate exige tax.settlements.calculate", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-settlements/calculate"),
    ).toBe("tax.settlements.calculate");
  });

  it("finalize exige tax.settlements.finalize", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-settlements/s/finalize"),
    ).toBe("tax.settlements.finalize");
  });

  it("artifacts exige tax.settlements.export", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-settlements/s/artifacts"),
    ).toBe("tax.settlements.export");
  });

  it("profitability/calculate exige profitability.calculate (no read)", () => {
    // G5 fix: AUDITOR_READONLY tiene profitability.read pero no calculate;
    // calcular crea snapshots (escritura) y no debe permitirse a sólo lectura.
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/profitability/calculate"),
    ).toBe("profitability.calculate");
  });

  it("profitability/publish exige profitability.publish", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/profitability/publish"),
    ).toBe("profitability.publish");
  });

  it("GET profitability exige profitability.read", () => {
    expect(
      requiredCapability("GET", "/api/v1/firms/f/clients/c/profitability"),
    ).toBe("profitability.read");
  });

  it("filings exige tax.filings.record", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-obligations/o/filings"),
    ).toBe("tax.filings.record");
  });

  it("payments exige tax.payments.record", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-obligations/o/payments"),
    ).toBe("tax.payments.record");
  });

  it("management-expenses approve-treatment exige approve_treatment", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/management-expenses/e/approve-treatment"),
    ).toBe("tax.management_expenses.approve_treatment");
  });
});
