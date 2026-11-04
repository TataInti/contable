import { describe, expect, it } from "vitest";
import { memberActionCopy, memberRowActions, roleChangeCopy } from "./member-row-actions.js";

/**
 * Tests focalizados de UI para el ciclo de vida de usuarios internos
 * (corte F2). El OWNER está protegido: no se ofrece suspensión sobre su
 * cuenta; una membresía suspendida sólo ofrece reactivación explícita.
 */

describe("memberRowActions", () => {
  it("no ofrece acciones para el OWNER (protegido)", () => {
    expect(memberRowActions({ role: "OWNER", membershipStatus: "ACTIVE", userStatus: "ACTIVE" })).toEqual([]);
  });

  it("ofrece suspensión para un ADMIN activo (baja reversible)", () => {
    expect(memberRowActions({ role: "ADMIN", membershipStatus: "ACTIVE", userStatus: "ACTIVE" })).toEqual(["suspend"]);
  });

  it("ofrece suspensión para roles operativos activos", () => {
    for (const role of ["PREPARER", "REVIEWER", "AUDITOR_READONLY"]) {
      expect(memberRowActions({ role, membershipStatus: "ACTIVE", userStatus: "ACTIVE" })).toEqual(["suspend"]);
    }
  });

  it("ofrece sólo reactivación para una membresía suspendida", () => {
    for (const role of ["ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"]) {
      expect(memberRowActions({ role, membershipStatus: "SUSPENDED", userStatus: "SUSPENDED" })).toEqual([
        "reactivate",
      ]);
    }
  });

  it("es defensiva: userStatus suspendido manda aunque la membresía diga ACTIVE", () => {
    expect(memberRowActions({ role: "PREPARER", membershipStatus: "ACTIVE", userStatus: "SUSPENDED" })).toEqual([
      "reactivate",
    ]);
  });

  it("no ofrece acciones sin usuario real (cuenta inexistente)", () => {
    expect(memberRowActions({ role: "PREPARER", membershipStatus: "ACTIVE", userStatus: null })).toEqual([]);
    expect(memberRowActions({ role: "PREPARER", membershipStatus: "ACTIVE" })).toEqual([]);
  });

  it("no ofrece acciones para invitaciones pendientes", () => {
    expect(memberRowActions({ role: "PREPARER", membershipStatus: "INVITED", userStatus: "ACTIVE" })).toEqual([]);
  });
});

describe("memberActionCopy", () => {
  it("la suspensión avisa cierre de sesiones y reversibilidad", () => {
    const copy = memberActionCopy("suspend", "Juan Pérez");
    expect(copy.title).toContain("Juan Pérez");
    expect(copy.tone).toBe("danger");
    expect(copy.description).toMatch(/sesiones activas/);
    expect(copy.description).toMatch(/reactivar/);
    expect(copy.confirmLabel).toBe("Suspender");
  });

  it("la reactivación pide login nuevo y no crea sesiones", () => {
    const copy = memberActionCopy("reactivate", "Ana Gómez");
    expect(copy.tone).toBe("default");
    expect(copy.description).toMatch(/iniciar sesión nuevamente/);
    expect(copy.confirmLabel).toBe("Reactivar");
  });
});

describe("roleChangeCopy", () => {
  it("avisa degradación de administración: sesiones cerradas y guard de último admin", () => {
    const copy = roleChangeCopy("Laura", "ADMIN", "PREPARER");
    expect(copy.description).toMatch(/sesiones activas/);
    expect(copy.description).toMatch(/último titular o administrador/);
    expect(copy.confirmLabel).toBe("Cambiar rol");
  });

  it("un cambio hacia ADMIN no es degradación y no avisa de sesiones", () => {
    const copy = roleChangeCopy("Laura", "PREPARER", "ADMIN");
    expect(copy.description).not.toMatch(/sesiones/);
  });

  it("OWNER a ADMIN es un cambio entre administradores, no degradación", () => {
    const copy = roleChangeCopy("Titular", "OWNER", "ADMIN");
    expect(copy.description).not.toMatch(/sesiones/);
  });
});
