import { describe, expect, it } from "vitest";
import { cambiosDeActividadDelMes, lineaDeTiempoActividades, mesYAnio } from "./historialActividades";
import type { ClientActivityLink } from "./utilidades";

const vinculo = (id: string, nombre: string, extra: Partial<ClientActivityLink> = {}): ClientActivityLink => ({
  id,
  isPrimary: false,
  validFrom: "2026-11-22",
  validTo: null,
  activity: { code: nombre.replace(/\s/g, "-").toUpperCase(), name: nombre, isActive: true, jurisdiction: { name: "Tucumán", isActive: true } },
  ...extra,
});

describe("4L — historial y aviso de cambios de actividad", () => {
  it("mes en español para los textos de la línea de tiempo", () => {
    expect(mesYAnio("2026-10-01")).toBe("octubre 2026");
  });

  it("una vinculación sin cambio se lista como vinculada, sin pedir fecha", () => {
    expect(lineaDeTiempoActividades([vinculo("a", "Actividad A")])).toEqual([
      { fecha: "2026-11-22", texto: "Vinculada: Actividad A" },
    ]);
  });

  it("el cambio muestra desde qué mes rige, con su motivo, y la anterior queda con su corte «Hasta»", () => {
    const entradas = lineaDeTiempoActividades([
      vinculo("a", "Actividad A", { validTo: "2026-09-30", validFrom: "2026-01-01" }),
      vinculo("b", "Actividad B", { isChange: true, validFrom: "2026-10-01", changeReason: "Suma de ventas de servicios" }),
    ]);
    expect(entradas.map((entrada) => entrada.texto)).toEqual([
      "Vinculada: Actividad A",
      "Hasta septiembre 2026: Actividad A",
      "Desde octubre 2026 rige Actividad B (cambio de actividad) · Suma de ventas de servicios",
    ]);
  });

  it("el aviso del mes del cambio nombra la actividad anterior y la nueva, sin bloquear", () => {
    const links = [
      vinculo("a", "Actividad A", { validTo: "2026-09-30", validFrom: "2026-01-01" }),
      vinculo("b", "Actividad B", { isChange: true, validFrom: "2026-10-01" }),
    ];
    expect(cambiosDeActividadDelMes(links, "2026-10-01")).toEqual([
      { desde: "octubre 2026", de: "Actividad A", a: "Actividad B" },
    ]);
    expect(cambiosDeActividadDelMes(links, "2026-11-01")).toEqual([]);
  });

  it("sin actividad anterior identificable, el aviso no inventa un nombre", () => {
    const links = [vinculo("b", "Actividad B", { isChange: true, validFrom: "2026-03-01" })];
    expect(cambiosDeActividadDelMes(links, "2026-03-01")).toEqual([
      { desde: "marzo 2026", de: "la actividad anterior", a: "Actividad B" },
    ]);
  });
});
