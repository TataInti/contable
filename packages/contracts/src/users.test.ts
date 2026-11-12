import { describe, expect, it } from "vitest";
import {
  firmProfilePatchSchema,
  internalMemberRolePatchSchema,
  internalMemberStatusSchema,
  memberIdentityPatchSchema,
  portalMembershipPatchSchema,
} from "./users.js";

describe("contratos de administración de usuarios y firma", () => {
  it("normaliza correo y admite sólo nombre/correo para identidad", () => {
    expect(memberIdentityPatchSchema.parse({
      name: "  Ana Pérez  ",
      email: " ANA@Example.COM ",
    })).toEqual({ name: "Ana Pérez", email: "ana@example.com" });
    expect(memberIdentityPatchSchema.safeParse({ phone: "+54 11 1234-5678" }).success).toBe(false);
    expect(memberIdentityPatchSchema.safeParse({}).success).toBe(false);
  });

  it("limita el perfil de firma a sus cuatro campos y permite limpiar taxId", () => {
    expect(firmProfilePatchSchema.parse({ taxId: null, timezone: "UTC" })).toEqual({
      taxId: null,
      timezone: "UTC",
    });
    expect(firmProfilePatchSchema.safeParse({ email: "firm@example.com" }).success).toBe(false);
    expect(firmProfilePatchSchema.safeParse({}).success).toBe(false);
  });

  it("acepta roles y estados de membresía explícitos", () => {
    expect(internalMemberRolePatchSchema.parse({ role: "ADMIN" })).toEqual({ role: "ADMIN" });
    expect(internalMemberStatusSchema.parse({ status: "SUSPENDED" })).toEqual({ status: "SUSPENDED" });
    expect(portalMembershipPatchSchema.parse({ role: "READONLY" })).toEqual({ role: "READONLY" });
    expect(portalMembershipPatchSchema.parse({ status: "ACTIVE" })).toEqual({ status: "ACTIVE" });
    expect(portalMembershipPatchSchema.safeParse({}).success).toBe(false);
    expect(portalMembershipPatchSchema.safeParse({ role: "ADMIN" }).success).toBe(false);
  });
});
