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
