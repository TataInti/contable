import { describe, expect, it } from "vitest";
import { capabilitiesForRole } from "./resolver.js";

/**
 * Calendarios fiscales (D-C3): lectura para todos los roles de firma; crear,
 * editar, versionar, ocultar y mostrar para OWNER, ADMIN y PREPARER; publicar
 * solo para OWNER y ADMIN. Cada capacidad se prueba con un rol que la tiene y
 * otro que no.
 */
describe("capacidades de calendarios fiscales por rol", () => {
  it("lectura para todos los roles de firma", () => {
    for (const role of ["OWNER", "ADMIN", "PREPARER", "REVIEWER", "AUDITOR_READONLY"] as const) {
      expect(capabilitiesForRole(role).has("tax.calendars.read"), role).toBe(true);
    }
  });

  it("gestión para OWNER, ADMIN y PREPARER; sin gestión para REVIEWER y AUDITOR_READONLY", () => {
    for (const role of ["OWNER", "ADMIN", "PREPARER"] as const) {
      expect(capabilitiesForRole(role).has("tax.calendars.manage"), role).toBe(true);
    }
    for (const role of ["REVIEWER", "AUDITOR_READONLY"] as const) {
      expect(capabilitiesForRole(role).has("tax.calendars.manage"), role).toBe(false);
    }
  });

  it("publicar solo para OWNER y ADMIN, sin revisor distinto", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(capabilitiesForRole(role).has("tax.calendars.publish"), role).toBe(true);
    }
    for (const role of ["PREPARER", "REVIEWER", "AUDITOR_READONLY"] as const) {
      expect(capabilitiesForRole(role).has("tax.calendars.publish"), role).toBe(false);
    }
  });
});
