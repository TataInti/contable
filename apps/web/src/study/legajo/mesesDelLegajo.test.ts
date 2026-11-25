import { describe, expect, it } from "vitest";
import { periodoIibbDemo, periodoIvaDemo } from "./datosDemoLegajo";
import { agruparPorMes, mesEnFrase, mesParaAbrir, rotuloMes } from "./mesesDelLegajo";

const periodoDe = (id: string, inicio: string, fin: string) => ({ ...periodoIibbDemo, id, startDate: inicio, endDate: fin });

describe("meses del Legajo (09-2)", () => {
  it("agrupa los impuestos de un mismo mes en una sola entrada, la más reciente primero", () => {
    const meses = agruparPorMes([
      periodoDe("sep", "2026-09-01", "2026-09-30"),
      periodoIibbDemo,
      periodoIvaDemo,
    ]);
    expect(meses.map((mes) => rotuloMes(mes))).toEqual(["Octubre de 2026", "Septiembre de 2026"]);
    expect(meses[0]!.periodos.map((periodo) => periodo.id)).toEqual(["period-a", "period-iva"]);
  });

  it("un período que no es un mes entero muestra su rango", () => {
    const [mes] = agruparPorMes([periodoDe("x", "2026-10-15", "2026-11-14")]);
    expect(rotuloMes(mes!)).toBe("15/10/2026 al 14/11/2026");
  });

  it("escribe el mes en una frase", () => {
    expect(mesEnFrase("2026-10")).toBe("octubre de 2026");
    expect(mesEnFrase("2027-02")).toBe("febrero de 2027");
  });

  it("sin meses ofrece el mes anterior al actual, también al cruzar el año", () => {
    expect(mesParaAbrir([], new Date(2026, 10, 25))).toBe("2026-10");
    expect(mesParaAbrir([], new Date(2027, 0, 5))).toBe("2026-12");
  });

  it("con meses ofrece el siguiente al último abierto, sin pasar del mes actual", () => {
    const meses = agruparPorMes([periodoDe("sep", "2026-09-01", "2026-09-30")]);
    expect(mesParaAbrir(meses, new Date(2026, 10, 25))).toBe("2026-10");
    const hastaOctubre = agruparPorMes([periodoIibbDemo, periodoDe("sep", "2026-09-01", "2026-09-30")]);
    expect(mesParaAbrir(hastaOctubre, new Date(2026, 10, 25))).toBe("2026-11");
    const hastaNoviembre = agruparPorMes([periodoDe("nov", "2026-11-01", "2026-11-30")]);
    expect(mesParaAbrir(hastaNoviembre, new Date(2026, 10, 25))).toBeNull();
    const diciembre = agruparPorMes([periodoDe("dic", "2026-12-01", "2026-12-31")]);
    expect(mesParaAbrir(diciembre, new Date(2026, 11, 25))).toBeNull();
  });
});
