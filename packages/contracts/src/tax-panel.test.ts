import { describe, expect, it } from "vitest";
import { TAX_PANEL_DJ_STATES, TAX_PANEL_GROUPINGS, taxPanelQuerySchema } from "./tax-panel.js";

const issueOf = (input: Record<string, unknown>) => {
  const result = taxPanelQuerySchema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues[0];
};

describe("contrato del panel de trabajo (corte 4a)", () => {
  it("aplica los defaults de la API: orden por vencimiento ascendente, límite 50 y sin desplazamiento", () => {
    expect(taxPanelQuerySchema.parse({})).toEqual({
      orden: "vencimiento",
      dir: "asc",
      limit: 50,
      offset: 0,
    });
  });

  it("acepta «me», identificadores de usuario, terminaciones y grupo", () => {
    const parsed = taxPanelQuerySchema.parse({
      responsable: "me,11111111-1111-4111-8111-111111111111",
      terminacion: "1,5",
      grupo: "0123",
    });
    expect(parsed.responsable).toEqual(["me", "11111111-1111-4111-8111-111111111111"]);
    expect(parsed.terminacion).toEqual(["1", "5"]);
    expect(parsed.grupo).toEqual(["0", "1", "2", "3"]);
  });

  it("rechaza valores desconocidos con el campo y el motivo", () => {
    expect(issueOf({ responsable: "juan" })).toMatchObject({ path: ["responsable"] });
    expect(issueOf({ terminacion: "10" })).toMatchObject({ path: ["terminacion"] });
    expect(issueOf({ grupo: "0,1" })).toMatchObject({ path: ["grupo"] });
    expect(issueOf({ estado: "PAGADO" })).toMatchObject({ path: ["estado"] });
    expect(issueOf({ agrupar: "provincia" })).toMatchObject({ path: ["agrupar"] });
    expect(issueOf({ orden: "monto" })).toMatchObject({ path: ["orden"] });
    expect(issueOf({ responsables: "me" })).toMatchObject({ path: [] });
  });

  it("rechaza fechas inexistentes y un rango de vencimiento invertido", () => {
    expect(issueOf({ dueFrom: "2026-02-30" })).toMatchObject({ path: ["dueFrom"] });
    expect(issueOf({ dueFrom: "2026-05-01", dueTo: "2026-04-01" })).toMatchObject({
      path: ["dueTo"],
    });
    expect(taxPanelQuerySchema.parse({ dueFrom: "2026-04-01", dueTo: "2026-04-30" })).toMatchObject(
      {
        dueFrom: "2026-04-01",
        dueTo: "2026-04-30",
      },
    );
  });

  it("limita el tamaño de página entre 1 y 200 y la desplazada desde 0", () => {
    expect(issueOf({ limit: "0" })).toMatchObject({ path: ["limit"] });
    expect(issueOf({ limit: "201" })).toMatchObject({ path: ["limit"] });
    expect(issueOf({ offset: "-1" })).toMatchObject({ path: ["offset"] });
    expect(taxPanelQuerySchema.parse({ limit: "200", offset: "40" })).toMatchObject({
      limit: 200,
      offset: 40,
    });
  });

  it("expone solo los estados verificables hoy y las agrupaciones del plan", () => {
    expect(TAX_PANEL_DJ_STATES).toEqual([
      "SIN_LEGAJO",
      "LEGAJO_EN_CURSO",
      "DJ_PENDIENTE",
      "PRESENTACION_SIN_ACUSE",
      "PRESENTADO",
    ]);
    expect(TAX_PANEL_GROUPINGS).toEqual(["terminacion", "vencimiento", "responsable", "cliente"]);
  });
});
