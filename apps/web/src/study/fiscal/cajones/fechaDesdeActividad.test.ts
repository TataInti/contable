import { describe, expect, it } from "vitest";
import type { TaxRegistration } from "../utilidades";
import { fechaDesdeActividad } from "./fechaDesdeActividad";

function inscripcion(jurisdictionId: string, validFrom: string, status = "ACTIVE"): TaxRegistration {
  return {
    id: `${jurisdictionId}-${validFrom}`,
    status,
    validFrom,
    validTo: null,
    registrationNumber: null,
    regime: { id: "r", code: "R", name: "R", isActive: true, taxType: { id: "t", name: "T", isActive: true }, jurisdiction: { name: "J", isActive: true }, jurisdictionId },
  } as TaxRegistration;
}

describe("fechaDesdeActividad (brief 4H)", () => {
  it("propone el inicio de la inscripción vigente del mismo nivel", () => {
    const inscripciones = [inscripcion("AR-T", "2026-10-01"), inscripcion("AR-SMT", "2026-09-15")];
    expect(fechaDesdeActividad("AR-T", inscripciones, "2026-01-01T00:00:00.000Z")).toBe("2026-10-01");
    expect(fechaDesdeActividad("AR-SMT", inscripciones, "2026-01-01T00:00:00.000Z")).toBe("2026-09-15");
  });

  it("si el nivel no tiene inscripción vigente, propone el inicio del perfil fiscal", () => {
    const inscripciones = [inscripcion("AR-T", "2026-10-01", "CANCELLED")];
    expect(fechaDesdeActividad("AR-T", inscripciones, "2026-03-05T00:00:00.000Z")).toBe("2026-03-05");
    expect(fechaDesdeActividad(undefined, inscripciones, "2026-03-05")).toBe("2026-03-05");
  });

  it("con varias inscripciones del nivel usa la más antigua", () => {
    const inscripciones = [inscripcion("AR-T", "2026-11-01"), inscripcion("AR-T", "2026-10-01")];
    expect(fechaDesdeActividad("AR-T", inscripciones, "2026-01-01")).toBe("2026-10-01");
  });
});
