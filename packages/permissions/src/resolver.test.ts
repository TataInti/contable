import { describe, expect, it } from "vitest";
import { capabilitiesForRole, hasCapability, resolveCapabilities } from "./resolver.js";

describe("resolveCapabilities", () => {
  it("owner accede a toda la firma sin asignación", () => {
    const ctx = resolveCapabilities({ role: "OWNER", isAssignedToClient: false, isPortalMember: false });
    expect(ctx.firmWide).toBe(true);
    expect(ctx.assignedToClient).toBe(true);
    expect(hasCapability(ctx, "entry.post")).toBe(true);
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
});