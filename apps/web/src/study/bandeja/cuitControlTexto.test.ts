import { describe, expect, it } from "vitest";
import type { Document } from "../../lib/api";
import { etiquetaCuitEstado, planDeBloqueCuit, validarMotivoCuit } from "./cuitControlTexto";

const doc = (id: string, cuitControl: Document["cuitControl"]): Document => ({
  id,
  status: "EXTRACTED",
  createdAt: "2026-11-22T10:00:00.000Z",
  cuitControl,
});

const pendiente = (clientId: string, estado: "OTRO_CLIENTE" | "NO_LEIDO" = "OTRO_CLIENTE") => ({
  estado,
  pendiente: true,
  aceptado: false,
  motivo: null,
  emisor: null,
  receptor: null,
  mensaje: "mensaje",
  sugerido: { clientId, legalName: `Cliente ${clientId}`, cuit: "30222222229" },
});

describe("textos del control de CUIT", () => {
  it("usa un solo nombre por estado", () => {
    expect(etiquetaCuitEstado("OTRO_CLIENTE")).toBe("CUIT de otro cliente");
    expect(etiquetaCuitEstado("NO_LEIDO")).toBe("CUIT no leído");
  });

  it("pide un motivo de al menos tres caracteres y dice qué falta", () => {
    expect(validarMotivoCuit("  ")).toBe("Escribí el motivo: al menos 3 caracteres.");
    expect(validarMotivoCuit("ok")).toBe("Escribí el motivo: al menos 3 caracteres.");
    expect(validarMotivoCuit("Socio")).toBeNull();
  });
});

describe("planDeBloqueCuit", () => {
  it("ofrece mover en bloque solo si todos los pendientes sugieren el mismo cliente", () => {
    const plan = planDeBloqueCuit([
      doc("1", pendiente("cli-b")),
      doc("2", pendiente("cli-b")),
      doc("3", null),
    ]);
    expect(plan.pendientes.map((d) => d.id)).toEqual(["1", "2"]);
    expect(plan.destino).toEqual({ clientId: "cli-b", legalName: "Cliente cli-b" });
  });

  it("no ofrece mover en bloque si las sugerencias difieren", () => {
    const plan = planDeBloqueCuit([doc("1", pendiente("cli-b")), doc("2", pendiente("cli-c"))]);
    expect(plan.pendientes).toHaveLength(2);
    expect(plan.destino).toBeNull();
  });

  it("no ofrece nada si no hay pendientes ni sugerencia (CUIT no leído)", () => {
    expect(planDeBloqueCuit([doc("1", null)])).toEqual({ pendientes: [], destino: null });
    const sinSugerencia = planDeBloqueCuit([doc("1", { ...pendiente("x"), estado: "NO_LEIDO", sugerido: null })]);
    expect(sinSugerencia.pendientes).toHaveLength(1);
    expect(sinSugerencia.destino).toBeNull();
  });
});
