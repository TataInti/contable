import { describe, expect, it } from "vitest";
import { capabilitiesForRole } from "@contable/permissions";
import { assertCapability, requiredCapability } from "./guard.js";

/**
 * Fija el mapeo ruta→capacidad del guard deny-by-default (PLAN §4.3).
 * Estos tests protegen contra escapes de permisos: una ruta de mutación
 * nunca debe caer en una capacidad de lectura o en una de menor privilegio.
 */
describe("requiredCapability (mapeo ruta → capacidad)", () => {
  it("GET dashboard del estudio exige client.read", () => {
    expect(requiredCapability("GET", "/api/v1/firms/f/dashboard")).toBe("client.read");
    // POST dashboard no existe: sin mapeo → null → deny-by-default (404).
    expect(requiredCapability("POST", "/api/v1/firms/f/dashboard")).toBeNull();
  });

  it("GET resumen del cliente exige client.read", () => {
    expect(requiredCapability("GET", "/api/v1/firms/f/clients/c/summary")).toBe("client.read");
  });

  it("aprobar y rechazar extracciones mantienen document.review", () => {
    const base = "/api/v1/firms/f/clients/c/extractions/e";
    expect(requiredCapability("POST", `${base}/approve`)).toBe("document.review");
    expect(requiredCapability("POST", `${base}/reject`)).toBe("document.review");
    expect(capabilitiesForRole("REVIEWER").has("document.review")).toBe(true);
    const auditor = { capabilities: capabilitiesForRole("AUDITOR_READONLY") } as never;
    expect(() => assertCapability(auditor, "document.review")).toThrow(
      expect.objectContaining({ statusCode: 403, code: "CAPABILITY_REQUIRED" }),
    );
  });

  it("identidad y contactos requieren client.manage, con rechazo 403 para sólo lectura", () => {
    expect(requiredCapability("PATCH", "/api/v1/firms/f/clients/c")).toBe("client.manage");
    for (const [method, path] of [
      ["GET", "/api/v1/firms/f/clients/c/contacts"],
      ["POST", "/api/v1/firms/f/clients/c/contacts"],
      ["PATCH", "/api/v1/firms/f/clients/c/contacts/contact-a"],
    ]) {
      expect(requiredCapability(method!, path!)).toBe("client.manage");
    }
    const auditor = { capabilities: capabilitiesForRole("AUDITOR_READONLY") } as never;
    expect(() => assertCapability(auditor, "client.manage")).toThrow(
      expect.objectContaining({ statusCode: 403, code: "CAPABILITY_REQUIRED" }),
    );
  });

  it("el catálogo de actividad de la ficha se lee con client.read", () => {
    const path = "/api/v1/firms/f/client-profile-catalogs/activities";
    expect(requiredCapability("GET", path)).toBe("client.read");
    expect(requiredCapability("POST", path)).toBeNull();
  });

  it("deny-by-default: ruta de negocio sin mapeo devuelve null", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/ruta-inexistente"),
    ).toBeNull();
    expect(
      requiredCapability("GET", "/api/v1/firms/f/otra-ruta-sin-mapeo"),
    ).toBeNull();
  });

  it("activities de cliente exige tax.profile.read (GET) / write (POST)", () => {
    expect(
      requiredCapability("GET", "/api/v1/firms/f/clients/c/activities"),
    ).toBe("tax.profile.read");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/activities"),
    ).toBe("tax.profile.write");
  });

  it("crear una sucesora del perfil requiere permiso de escritura fiscal", () => {
    const successorPath = "/api/v1/firms/f/clients/c/tax-profile-versions/p/versions";
    expect(requiredCapability("POST", successorPath)).toBe("tax.profile.write");
    expect(capabilitiesForRole("PREPARER").has("tax.profile.write")).toBe(true);
    expect(capabilitiesForRole("AUDITOR_READONLY").has("tax.profile.write")).toBe(false);
  });

  it("catálogos fiscales: lectura y alta requieren capacidades distintas", () => {
    const authoritiesPath = "/api/v1/tax/authorities";
    expect(requiredCapability("GET", authoritiesPath)).toBe("tax.rules.read");
    expect(requiredCapability("POST", authoritiesPath)).toBe("tax.rules.propose");
    expect(capabilitiesForRole("OWNER").has("tax.rules.propose")).toBe(true);
    expect(capabilitiesForRole("ADMIN").has("tax.rules.propose")).toBe(true);
    expect(capabilitiesForRole("AUDITOR_READONLY").has("tax.rules.propose")).toBe(false);
  });

  it("activar reglas fiscales requiere tax.rules.propose para OWNER/ADMIN", () => {
    const activationPath = "/api/v1/tax/rule-versions/version-1/activate";
    expect(requiredCapability("POST", activationPath)).toBe("tax.rules.propose");
    expect(capabilitiesForRole("OWNER").has("tax.rules.propose")).toBe(true);
    expect(capabilitiesForRole("ADMIN").has("tax.rules.propose")).toBe(true);
    for (const role of ["PREPARER", "REVIEWER", "AUDITOR_READONLY"] as const) {
      const actor = { capabilities: capabilitiesForRole(role) } as never;
      expect(() => assertCapability(actor, "tax.rules.propose")).toThrow(
        expect.objectContaining({ statusCode: 403, code: "CAPABILITY_REQUIRED" }),
      );
    }
  });

  it("los cinco catálogos requieren tax.rules.propose y el guard devuelve 403 sin esa capacidad", () => {
    for (const path of [
      "/api/v1/tax/jurisdictions",
      "/api/v1/tax/types",
      "/api/v1/tax/authorities",
      "/api/v1/tax/regimes",
      "/api/v1/tax/activities",
    ]) {
      expect(requiredCapability("GET", path)).toBe("tax.rules.read");
      expect(requiredCapability("POST", path)).toBe("tax.rules.propose");
      expect(requiredCapability("PATCH", `${path}/id`)).toBe("tax.rules.propose");
    }

    const auditor = { capabilities: capabilitiesForRole("AUDITOR_READONLY") } as never;
    expect(() => assertCapability(auditor, "tax.rules.propose")).toThrow(
      expect.objectContaining({ statusCode: 403, code: "CAPABILITY_REQUIRED" }),
    );
  });

  it("portal-invitations exige client.read (GET) / client.manage (POST)", () => {
    expect(
      requiredCapability("GET", "/api/v1/firms/f/clients/c/portal-invitations"),
    ).toBe("client.read");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/portal-invitations"),
    ).toBe("client.manage");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/portal-invitations/i/revoke"),
    ).toBe("client.manage");
  });

  it("adjustments de bancos exigen bank.reconcile", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/adjustments/exchange-difference"),
    ).toBe("bank.reconcile");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/adjustments/inflation"),
    ).toBe("bank.reconcile");
  });

  it("preview de document-request-item exige client.read", () => {
    expect(
      requiredCapability("GET", "/api/v1/firms/f/clients/c/document-request-items/i/preview"),
    ).toBe("client.read");
  });

  it("las transiciones de asientos prevalecen sobre la regla genérica", () => {
    const base = "/api/v1/firms/f/clients/c/journal-entries/e";
    expect(requiredCapability("POST", `${base}/submit`)).toBe("entry.submit");
    expect(requiredCapability("POST", `${base}/review`)).toBe("entry.review");
    expect(requiredCapability("POST", `${base}/post`)).toBe("entry.post");
    expect(requiredCapability("POST", `${base}/reverse`)).toBe("entry.reverse");
  });

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

  it("vouchers submit-review exige tax.vouchers.prepare", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/vouchers/v/submit-review"),
    ).toBe("tax.vouchers.prepare");
  });

  it("vouchers approve/reject exige tax.vouchers.review", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/vouchers/v/approve"),
    ).toBe("tax.vouchers.review");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/vouchers/v/reject"),
    ).toBe("tax.vouchers.review");
  });

  it("management-expenses submit-review exige write, reject exige approve_treatment", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/management-expenses/e/submit-review"),
    ).toBe("tax.management_expenses.write");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/management-expenses/e/reject"),
    ).toBe("tax.management_expenses.approve_treatment");
  });

  // ================================================================
  // B1/B2 (plan piloto §3.1/§3.2): rutas del libro de créditos.
  // ================================================================

  it("verificación de saldo exige tax.settlements.review (no calculate)", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-credit-ledger/l/verify"),
    ).toBe("tax.settlements.review");
  });

  it("movements/corrections del libro exigen tax.settlements.calculate", () => {
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-credit-ledger/l/movements"),
    ).toBe("tax.settlements.calculate");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-credit-ledger/l/corrections"),
    ).toBe("tax.settlements.calculate");
  });

  it("GET ledger exige read; POST opening exige calculate", () => {
    expect(
      requiredCapability("GET", "/api/v1/firms/f/clients/c/tax-credit-ledger"),
    ).toBe("tax.settlements.read");
    expect(
      requiredCapability("POST", "/api/v1/firms/f/clients/c/tax-credit-ledger/opening"),
    ).toBe("tax.settlements.calculate");
  });

  // ================================================================
  // B3 (plan piloto §5.1): transiciones del pedido documental.
  // ================================================================

  it("transiciones del pedido documental exigen request.manage", () => {
    const base = "/api/v1/firms/f/clients/c/document-requests/r";
    expect(requiredCapability("POST", `${base}/send`)).toBe("request.manage");
    expect(requiredCapability("POST", `${base}/cancel`)).toBe("request.manage");
    expect(requiredCapability("POST", `${base}/items/i/accept`)).toBe("request.manage");
    expect(requiredCapability("POST", `${base}/items/i/reject`)).toBe("request.manage");
    expect(requiredCapability("POST", `${base}/items/i/waive`)).toBe("request.manage");
  });

  it("reserva previews y borrados definitivos de clientes y catálogos al OWNER", () => {
    const paths = [
      "/api/v1/firms/f/clients/c",
      "/api/v1/firms/f/tax/authorities/a",
      "/api/v1/firms/f/tax/regimes/r",
      "/api/v1/firms/f/tax/activities/a",
      "/api/v1/firms/f/tax/jurisdictions/j",
      "/api/v1/firms/f/tax/types/t",
      "/api/v1/firms/f/tax/rule-packs/p",
      "/api/v1/firms/f/tax/rule-versions/v",
    ];
    for (const path of paths) {
      expect(requiredCapability("GET", `${path}/deletion-preview`)).toBe("data.delete");
      expect(requiredCapability("DELETE", path)).toBe("data.delete");
    }

    expect(capabilitiesForRole("OWNER").has("data.delete")).toBe(true);
    for (const role of ["ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"] as const) {
      expect(capabilitiesForRole(role).has("data.delete")).toBe(false);
    }
  });
});
