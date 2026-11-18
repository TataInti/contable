import { describe, expect, it } from "vitest";
import { periodoIvaDemo } from "./datosDemoLegajo";
import { rotuloPeriodoFiscal } from "./periodoFiscal";

describe("rótulo del período en el desplegable de la barra (Barra 2c)", () => {
  it("empieza por el mes y el año y sigue con el rótulo de siempre, con las mismas palabras", () => {
    expect(rotuloPeriodoFiscal(periodoIvaDemo)).toBe("Octubre de 2026 · IVA · 2026-10");
  });

  it("un período que no es un mes entero muestra su rango antes del rótulo", () => {
    expect(
      rotuloPeriodoFiscal({ ...periodoIvaDemo, startDate: "2026-10-15", endDate: "2026-11-14" }),
    ).toBe("15/10/2026 al 14/11/2026 · IVA · 2026-10");
  });
});

describe("rótulo del período: el mes y el año no se repiten (Barra 2d, A29)", () => {
  const marzoIibb = {
    ...periodoIvaDemo,
    startDate: "2025-03-01",
    endDate: "2025-03-31",
    taxType: { name: "Ingresos Brutos · IIBB", isActive: true },
  };
  const junioIva = {
    ...periodoIvaDemo,
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    taxType: { name: "IVA — Impuesto al Valor Agregado", isActive: true },
  };

  it("un rótulo «Marzo 2025» (el que genera la API) no repite el mes", () => {
    expect(rotuloPeriodoFiscal({ ...marzoIibb, label: "Marzo 2025" })).toBe(
      "Marzo de 2025 · Ingresos Brutos · IIBB",
    );
  });

  it("un rótulo «marzo de 2025» se compara sin mayúsculas y sin la palabra «de»", () => {
    expect(rotuloPeriodoFiscal({ ...marzoIibb, label: "marzo de 2025" })).toBe(
      "Marzo de 2025 · Ingresos Brutos · IIBB",
    );
  });

  it("sin rótulo, el nombre queda en mes, año e impuesto", () => {
    expect(rotuloPeriodoFiscal({ ...marzoIibb, label: null })).toBe(
      "Marzo de 2025 · Ingresos Brutos · IIBB",
    );
  });

  it("un rótulo propio que dice otra cosa se agrega al final", () => {
    expect(rotuloPeriodoFiscal({ ...junioIva, label: "DEMO IVA 2026-06" })).toBe(
      "Junio de 2026 · IVA — Impuesto al Valor Agregado · DEMO IVA 2026-06",
    );
  });
});
