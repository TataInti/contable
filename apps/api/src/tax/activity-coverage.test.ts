import { describe, expect, it } from "vitest";
import {
  buildLevelActivityContext,
  evaluateSaleActivities,
  mensajeActividadSinClasificar,
} from "./activity-coverage.js";

const JUR = "jur-tuc";
const period = { startDate: new Date("2026-10-01T00:00:00Z"), endDate: new Date("2026-10-31T00:00:00Z") };
const cutoff = "2026-10-31T23:59:59.999Z";
const catalog = [
  { code: "A", jurisdictionId: JUR },
  { code: "B", jurisdictionId: JUR },
  { code: "X", jurisdictionId: "jur-otra" },
];
const link = (code: string, validFrom: string) => ({
  code,
  name: `Actividad ${code}`,
  validFrom: new Date(validFrom),
  validTo: null,
});
const venta = (lines: Array<{ activityCode: string | null; hasNetAmount: boolean }>, classification: { activityCode: string | null } | null = null) => ({
  voucherId: "v1",
  issuedOn: new Date("2026-10-10T00:00:00Z"),
  lines,
  classification,
});
const contexto = (levelLinks: ReturnType<typeof link>[], withSingleLocal = true) =>
  buildLevelActivityContext({
    periodStart: period.startDate,
    periodEnd: period.endDate,
    jurisdictionId: JUR,
    levelLinks,
    catalog,
    withSingleLocal,
  });

describe("4J — criterio único de actividades por venta", () => {
  it("de otro nivel con más de una actividad vigente en el nivel → ACTIVITY_UNCLASSIFIED con varias vigentes", () => {
    const ctx = contexto([link("A", "2026-01-01"), link("B", "2026-01-01")]);
    expect(evaluateSaleActivities(ctx, [venta([{ activityCode: "X", hasNetAmount: true }])], cutoff)).toEqual([
      { voucherId: "v1", code: "ACTIVITY_UNCLASSIFIED", multipleInForce: true },
    ]);
  });

  it("de otro nivel con una sola actividad vigente en el nivel → la asigna sin hallazgo", () => {
    const ctx = contexto([link("A", "2026-01-01")]);
    expect(evaluateSaleActivities(ctx, [venta([{ activityCode: "X", hasNetAmount: true }])], cutoff)).toEqual([]);
  });

  it("actividad propia no vigente → ACTIVITY_NOT_IN_FORCE con nombre y «Desde»; corregida, sin hallazgo", () => {
    const sinCorregir = contexto([link("A", "2026-11-22")]);
    // Como en el cálculo: la línea no vigente cuenta también como sin clasificar; el texto prioriza «no vigente».
    const hallazgos = evaluateSaleActivities(sinCorregir, [venta([{ activityCode: "A", hasNetAmount: true }])], cutoff);
    expect(hallazgos).toContainEqual({
      voucherId: "v1",
      code: "ACTIVITY_NOT_IN_FORCE",
      activityCode: "A",
      activityName: "Actividad A",
      validFrom: new Date("2026-11-22"),
    });
    const corregida = contexto([link("A", "2026-10-01")]);
    expect(evaluateSaleActivities(corregida, [venta([{ activityCode: "A", hasNetAmount: true }])], cutoff)).toEqual([]);
  });

  it("el texto de «sin clasificar» distingue una venta de varias", () => {
    expect(mensajeActividadSinClasificar(1, true)).toMatch(/^1 venta tiene una actividad de otro nivel/);
    expect(mensajeActividadSinClasificar(2, false)).toMatch(/^2 ventas tienen una actividad que el cliente no tiene vinculada/);
  });
});
