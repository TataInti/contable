import { describe, expect, it } from "vitest";
import {
  buildLevelActivityContext,
  evaluateSaleActivities,
  mensajeActividadNoVigente,
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
// Vínculo sin cambio registrado: vale desde siempre (brief 4L). La fecha del alta no le pone límite.
const link = (code: string, validFrom = "2026-11-22") => ({
  code,
  name: `Actividad ${code}`,
  validFrom: new Date(validFrom),
  validTo: null,
  isChange: false,
});
// Cambio de actividad registrado: rige desde el mes del cambio.
const cambio = (code: string, validFrom: string) => ({ ...link(code, validFrom), isChange: true });
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
      { voucherId: "v1", kind: "UNCLASSIFIED", multipleInForce: true },
    ]);
  });

  it("de otro nivel con una sola actividad vigente en el nivel → la asigna sin hallazgo", () => {
    const ctx = contexto([link("A", "2026-01-01")]);
    expect(evaluateSaleActivities(ctx, [venta([{ activityCode: "X", hasNetAmount: true }])], cutoff)).toEqual([]);
  });

  it("el texto de «sin clasificar» distingue una venta de varias", () => {
    expect(mensajeActividadSinClasificar(1, true)).toMatch(/^1 venta tiene una actividad de otro nivel/);
    expect(mensajeActividadSinClasificar(2, false)).toMatch(/^2 ventas tienen una actividad que el cliente no tiene vinculada/);
  });
});

describe("4L — la vigencia por defecto es siempre; solo un cambio registrado corta en el tiempo", () => {
  it("una actividad vinculada sin cambio registrado vale para octubre aunque el alta sea posterior", () => {
    // Alta el 22/11/2026: la actividad no tiene límite inferior, así que la venta de octubre no es un hallazgo.
    const ctx = contexto([link("A", "2026-11-22")]);
    expect(ctx.inForce.map((l) => l.code)).toEqual(["A"]);
    expect(evaluateSaleActivities(ctx, [venta([{ activityCode: "A", hasNetAmount: true }])], cutoff)).toEqual([]);
  });

  it("con cambio registrado: febrero usa A, marzo usa B; cada mes resuelve su actividad", () => {
    const levelLinks = [
      { ...link("A"), validTo: new Date("2027-02-28T00:00:00Z") },
      cambio("B", "2027-03-01"),
    ];
    const feb = buildLevelActivityContext({
      periodStart: new Date("2027-02-01T00:00:00Z"),
      periodEnd: new Date("2027-02-28T00:00:00Z"),
      jurisdictionId: JUR,
      levelLinks,
      catalog,
      withSingleLocal: false,
    });
    const mar = buildLevelActivityContext({
      periodStart: new Date("2027-03-01T00:00:00Z"),
      periodEnd: new Date("2027-03-31T00:00:00Z"),
      jurisdictionId: JUR,
      levelLinks,
      catalog,
      withSingleLocal: false,
    });
    expect(feb.inForce.map((l) => l.code)).toEqual(["A"]);
    expect(mar.inForce.map((l) => l.code)).toEqual(["B"]);
  });

  it("venta de abril clasificada con A (cambio a B en marzo) → NOT_IN_FORCE con salida hacia B", () => {
    const levelLinks = [
      { ...link("A"), validTo: new Date("2027-02-28T00:00:00Z") },
      cambio("B", "2027-03-01"),
    ];
    const abril = buildLevelActivityContext({
      periodStart: new Date("2027-04-01T00:00:00Z"),
      periodEnd: new Date("2027-04-30T00:00:00Z"),
      jurisdictionId: JUR,
      levelLinks,
      catalog,
      withSingleLocal: false,
    });
    const hallazgos = evaluateSaleActivities(
      abril,
      [{ voucherId: "v4", issuedOn: new Date("2027-04-10T00:00:00Z"), lines: [{ activityCode: "A", hasNetAmount: true }], classification: null }],
      "2027-04-30T23:59:59.999Z",
    );
    expect(hallazgos).toContainEqual(
      expect.objectContaining({
        voucherId: "v4",
        kind: "NOT_IN_FORCE",
        activityCode: "A",
        successor: expect.objectContaining({ code: "B", validFrom: new Date("2027-03-01T00:00:00Z") }),
      }),
    );
    const issue = hallazgos[0] as { activityName: string; successor: { name: string; validFrom: Date } | null };
    expect(mensajeActividadNoVigente({ activityName: issue.activityName, successor: issue.successor }, { startDate: new Date("2027-04-01T00:00:00Z") })).toBe(
      "La actividad Actividad A no rige en abril 2027. Reclasificá con Actividad B, vigente desde marzo 2027.",
    );
  });

  it("venta de septiembre clasificada con la actividad que rige desde octubre → NOT_IN_FORCE con salida a la de septiembre", () => {
    const septiembre = buildLevelActivityContext({
      periodStart: new Date("2026-09-01T00:00:00Z"),
      periodEnd: new Date("2026-09-30T00:00:00Z"),
      jurisdictionId: JUR,
      levelLinks: [{ ...link("A", "2026-01-01"), validTo: new Date("2026-09-30T00:00:00Z") }, cambio("B", "2026-10-01")],
      catalog,
      withSingleLocal: false,
    });
    const hallazgos = evaluateSaleActivities(
      septiembre,
      [{ voucherId: "v9", issuedOn: new Date("2026-09-10T00:00:00Z"), lines: [{ activityCode: "B", hasNetAmount: true }], classification: null }],
      "2026-09-30T23:59:59.999Z",
    );
    expect(hallazgos).toContainEqual(
      expect.objectContaining({ kind: "NOT_IN_FORCE", activityCode: "B", successor: expect.objectContaining({ code: "A" }) }),
    );
  });

  it("mensaje sin salida cuando no hay actividad vigente en el nivel", () => {
    expect(
      mensajeActividadNoVigente({ activityName: "Actividad A", successor: null }, { startDate: new Date("2026-10-01T00:00:00Z") }),
    ).toBe("La actividad Actividad A no rige en octubre 2026. Vinculá la actividad que rige ese mes en Configuración fiscal → Actividades.");
  });
});
