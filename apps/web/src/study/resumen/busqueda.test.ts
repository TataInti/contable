import { describe, expect, it } from "vitest";
import type { ClientSummary } from "../../lib/api";
import { buildSearchResults, matchesSearch, normalizeSearchValue } from "./busqueda";

// Datos sintéticos rotulados «SINTÉTICO» (CUIT 20111111112). El motor de búsqueda es puro: se prueba sin render.
const FECHA = "2026-11-01T00:00:00.000Z";
const FIN = "2026-11-30T00:00:00.000Z";
const impuesto = { id: "tax-1", code: "IVA", name: "IVA", isActive: true };
const jurisdiccion = { id: "jur-1", code: "AR", name: "Argentina", isActive: true };
const regimen = { id: "regime-1", code: "REG-1", name: "Régimen general", isActive: true, taxType: impuesto, jurisdiction: jurisdiccion };
const obligacion = {
  id: "obligation-1",
  status: "PENDING",
  dueDate: "2026-12-20T00:00:00.000Z",
  regime: regimen,
  period: { id: "period-1", label: "Noviembre 2026", startDate: FECHA, endDate: FIN },
};

function resumenSintetico(partes: { obligaciones?: unknown[]; periodos?: unknown[] } = {}): ClientSummary {
  return {
    client: {
      id: "client-a",
      legalName: "Cliente SINTÉTICO A",
      tradeName: "SINTÉTICO",
      cuit: "20111111112",
      status: "ONBOARDING",
      createdAt: FECHA,
      updatedAt: FECHA,
      profile: null,
      onboarding: { completed: false, updatedAt: FECHA },
    },
    accounting: { fiscalYears: [] },
    fiscal: {
      profiles: [],
      registrations: [],
      activities: [],
      periods: partes.periodos ?? [],
      obligations: partes.obligaciones ?? [],
    },
    counts: { accounts: 1, counterparties: 2, costCenters: 3 },
  } as unknown as ClientSummary;
}

describe("busqueda del Resumen del cliente (R1 y R2, funciones puras)", () => {
  it("R1 · por CUIT devuelve un resultado con razón social y «CUIT …»; por período, el período fiscal; sin coincidencias, lista vacía", () => {
    const resumen = resumenSintetico({
      periodos: [{ id: "period-1", startDate: FECHA, endDate: FIN, label: "Noviembre 2026", taxType: impuesto }],
    });
    expect(buildSearchResults(resumen, "20111111112")).toEqual([
      { sectionId: "overview", sectionLabel: "Datos generales", title: "Cliente SINTÉTICO A", detail: "CUIT 20111111112" },
    ]);
    expect(buildSearchResults(resumen, "noviembre").map((resultado) => resultado.title)).toContain("IVA · noviembre de 2026");
    expect(buildSearchResults(resumen, "zzz")).toEqual([]);
  });

  it("R2 · sin tope: con 8 obligaciones coincidentes devuelve las 8", () => {
    const obligaciones = Array.from({ length: 8 }, (_, indice) => ({
      ...obligacion,
      id: `obligation-${indice + 1}`,
      period: { ...obligacion.period, id: `period-${indice + 1}`, label: `Mes ${indice + 1}` },
    }));
    const resultados = buildSearchResults(resumenSintetico({ obligaciones }), "IVA");
    expect(resultados).toHaveLength(8);
    expect(resultados.every((resultado) => resultado.sectionId === "obligations")).toBe(true);
    // vigente: defecto 3.1.1 (el contador cuenta solo lo devuelto); lo cambia 7a.2 (sin D7A-N en §7.2)
  });

  it("normaliza sin acentos y en minúsculas (es-AR) antes de comparar", () => {
    expect(normalizeSearchValue("Sintético Árbol")).toBe("sintetico arbol");
    expect(matchesSearch("sintetico", "Cliente SINTÉTICO A")).toBe(true);
    expect(matchesSearch("zzz", "Cliente SINTÉTICO A", null)).toBe(false);
  });
});
