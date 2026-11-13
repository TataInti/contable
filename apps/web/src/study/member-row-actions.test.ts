import { describe, expect, it } from "vitest";
import { memberActionCopy, memberRecoveryCopy, memberRowActions, roleChangeCopy } from "./member-row-actions.js";

/**
 * Tests focalizados de UI para el ciclo de vida de usuarios internos
 * (corte F2). El servidor protege al último administrador activo; la pantalla
 * ofrece suspensión para cualquier miembro activo y reactivación explícita.
 */

describe("memberRowActions", () => {
  it("ofrece suspensión y recuperación también para el OWNER activo", () => {
    expect(memberRowActions({ role: "OWNER", membershipStatus: "ACTIVE", userStatus: "ACTIVE" })).toEqual([
      "suspend",
      "recover-access",
    ]);
  });

  it("ofrece suspensión y recuperación para un ADMIN activo (baja reversible)", () => {
    expect(memberRowActions({ role: "ADMIN", membershipStatus: "ACTIVE", userStatus: "ACTIVE" })).toEqual([
      "suspend",
      "recover-access",
    ]);
  });

  it("ofrece suspensión y recuperación para roles operativos activos", () => {
    for (const role of ["PREPARER", "REVIEWER", "AUDITOR_READONLY"]) {
      expect(memberRowActions({ role, membershipStatus: "ACTIVE", userStatus: "ACTIVE" })).toEqual([
        "suspend",
        "recover-access",
      ]);
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

describe("memberRecoveryCopy", () => {
  it("avisa el cierre de sesiones y que el enlace es de un solo uso con caducidad", () => {
    const copy = memberRecoveryCopy("Ana Gómez");
    expect(copy.title).toContain("Ana Gómez");
    expect(copy.description).toMatch(/sesiones activas/);
    expect(copy.description).toMatch(/un solo uso/);
    expect(copy.description).toMatch(/30 minutos/);
    expect(copy.confirmLabel).toBe("Generar enlace");
  });

  it("deja claro que el gestor no ve ni define la contraseña", () => {
    const copy = memberRecoveryCopy("Ana Gómez");
    expect(copy.description).toMatch(/no ves ni definís esa contraseña/);
  });

  it("no expone ningún dato sensible en el texto", () => {
    const copy = memberRecoveryCopy("Ana Gómez");
    expect(copy.description).not.toMatch(/token|contraseña temporal|hash/i);
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
