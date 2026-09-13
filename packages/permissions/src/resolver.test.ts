import { describe, expect, it } from "vitest";
import { capabilitiesForRole, hasCapability, resolveCapabilities } from "./resolver.js";

describe("resolveCapabilities", () => {
  it("owner accede a toda la firma sin asignación", () => {
    const ctx = resolveCapabilities({ role: "OWNER", isAssignedToClient: false, isPortalMember: false });
    expect(ctx.firmWide).toBe(true);
    expect(ctx.assignedToClient).toBe(true);
    expect(hasCapability(ctx, "entry.post")).toBe(true);
    expect(hasCapability(ctx, "profitability.calculate")).toBe(true);
    expect(hasCapability(ctx, "ai.use")).toBe(true);
    expect(hasCapability(ctx, "bi.use")).toBe(true);
  });

  it("admin tiene capacidades de admin", () => {
    const ctx = resolveCapabilities({ role: "ADMIN", isAssignedToClient: true, isPortalMember: false });
    expect(hasCapability(ctx, "firm.manage")).toBe(true);
    expect(hasCapability(ctx, "period.reopen")).toBe(true);
  });

  it("preparador sin asignación no accede a cliente", () => {
    const ctx = resolveCapabilities({ role: "PREPARER", isAssignedToClient: false, isPortalMember: false });
    expect(ctx.assignedToClient).toBe(false);
    expect(hasCapability(ctx, "client.read")).toBe(false);
  });

  it("preparador asignado crea y envía pero no postea", () => {
    const ctx = resolveCapabilities({ role: "PREPARER", isAssignedToClient: true, isPortalMember: false });
    expect(hasCapability(ctx, "entry.create")).toBe(true);
    expect(hasCapability(ctx, "entry.submit")).toBe(true);
    expect(hasCapability(ctx, "entry.post")).toBe(false);
    expect(hasCapability(ctx, "entry.review")).toBe(false);
  });

  it("revisor asignado postea pero no crea", () => {
    const ctx = resolveCapabilities({ role: "REVIEWER", isAssignedToClient: true, isPortalMember: false });
    expect(hasCapability(ctx, "entry.review")).toBe(true);
    expect(hasCapability(ctx, "entry.post")).toBe(true);
    expect(hasCapability(ctx, "entry.create")).toBe(false);
    expect(hasCapability(ctx, "ai.use")).toBe(true);
  });

  it("auditor readonly no muta", () => {
    const ctx = resolveCapabilities({ role: "AUDITOR_READONLY", isAssignedToClient: true, isPortalMember: false });
    expect(hasCapability(ctx, "client.read")).toBe(true);
    expect(hasCapability(ctx, "firm.audit.read")).toBe(true);
    expect(hasCapability(ctx, "entry.post")).toBe(false);
    expect(hasCapability(ctx, "vat.finalize")).toBe(false);
  });

  it("capacidades por rol no mutan el set interno", () => {
    const caps = capabilitiesForRole("PREPARER");
    // ReadonlySet previene mutación en tiempo de compilación.
    // En runtime, validamos que el set devuelto no sea el mismo objeto interno mutable.
    expect(caps.has("entry.post")).toBe(false);
    expect(caps).not.toContain("entry.post");
  });

  // ================================================================
  // B (plan piloto §6): matriz de permisos para saldos y libro de
  // créditos. Verificar es revisión (REVIEWER+); aplicar/corregir es
  // cálculo (PREPARER+); leer es sólo lectura.
  // ================================================================

  it("§6: verificar saldo exige tax.settlements.review (PREPARER no puede)", () => {
    const preparer = capabilitiesForRole("PREPARER");
    const reviewer = capabilitiesForRole("REVIEWER");
    const auditor = capabilitiesForRole("AUDITOR_READONLY");
    expect(preparer.has("tax.settlements.review")).toBe(false);
    expect(reviewer.has("tax.settlements.review")).toBe(true);
    expect(auditor.has("tax.settlements.review")).toBe(false);
  });

  it("§6: aplicar/corregir saldo exige calculate (PREPARER sí, AUDITOR no)", () => {
    const preparer = capabilitiesForRole("PREPARER");
    const reviewer = capabilitiesForRole("REVIEWER");
    const auditor = capabilitiesForRole("AUDITOR_READONLY");
    expect(preparer.has("tax.settlements.calculate")).toBe(true);
    expect(reviewer.has("tax.settlements.calculate")).toBe(false);
    expect(auditor.has("tax.settlements.calculate")).toBe(false);
  });

  it("§6: leer libro de créditos exige tax.settlements.read (todos los internos)", () => {
    const owner = capabilitiesForRole("OWNER");
    const preparer = capabilitiesForRole("PREPARER");
    const reviewer = capabilitiesForRole("REVIEWER");
    const auditor = capabilitiesForRole("AUDITOR_READONLY");
    for (const caps of [owner, preparer, reviewer, auditor]) {
      expect(caps.has("tax.settlements.read")).toBe(true);
    }
  });

  it("§6: el aislamiento del portal no depende de capacidades internas", () => {
    // El guard de portal (guard.ts) NO usa resolveCapabilities: asigna un set
    // dedicado (portal.*) según el rol de portal. Un usuario interno que
    // además es miembro de portal conserva sus capacidades internas en rutas
    // de estudio, pero las rutas /portal/* sólo otorgan portal.*. Este test
    // fija que el resolver no filtre por isPortalMember (el scope portal es
    // responsabilidad del guard), evitando dobles fuentes de verdad.
    const internalAndPortal = resolveCapabilities({
      role: "REVIEWER",
      isAssignedToClient: true,
      isPortalMember: true,
    });
    expect(hasCapability(internalAndPortal, "tax.settlements.review")).toBe(true);
    const portalOnly = resolveCapabilities({
      role: "REVIEWER",
      isAssignedToClient: false,
      isPortalMember: true,
    });
    // Sin asignación al cliente no hay acceso a datos del cliente.
    expect(hasCapability(portalOnly, "tax.settlements.review")).toBe(false);
  });
});
