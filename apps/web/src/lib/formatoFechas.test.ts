import { describe, expect, it } from "vitest";
import { formatearFecha, formatearFechaHora, formatearMes, formatearRango } from "./formatoFechas";

describe("formatearFecha", () => {
  it("muestra dd/mm/aaaa con ceros", () => {
    expect(formatearFecha("2026-07-05")).toBe("05/07/2026");
    expect(formatearFecha("2026-11-15")).toBe("15/11/2026");
  });

  it("toma el día calendario del ISO aunque venga con hora UTC (no corre el día en UTC−3)", () => {
    // 2026-07-05 00:00 UTC es 04/07 21:00 en Argentina: se muestra el día que guarda el valor.
    expect(formatearFecha("2026-07-05T00:00:00.000Z")).toBe("05/07/2026");
  });

  it("muestra el 1 de enero con cero delante (fin de año)", () => {
    expect(formatearFecha("2027-01-01")).toBe("01/01/2027");
    expect(formatearFecha("2026-12-31T00:00:00.000Z")).toBe("31/12/2026");
  });

  it("muestra el 29 de febrero de un año bisiesto", () => {
    expect(formatearFecha("2028-02-29")).toBe("29/02/2028");
  });

  it("devuelve el vacío indicado y «—» por defecto", () => {
    expect(formatearFecha(null)).toBe("—");
    expect(formatearFecha(undefined)).toBe("—");
    expect(formatearFecha("")).toBe("—");
    expect(formatearFecha(null, "")).toBe("");
    expect(formatearFecha(null, "Sin vencimiento")).toBe("Sin vencimiento");
  });
});

describe("formatearMes", () => {
  it("muestra el mes en minúscula y el año", () => {
    expect(formatearMes("2026-07-01T00:00:00.000Z")).toBe("julio de 2026");
    expect(formatearMes("2026-02-28")).toBe("febrero de 2026");
  });

  it("cambia de año en diciembre y enero sin corrimientos", () => {
    expect(formatearMes("2026-12-01")).toBe("diciembre de 2026");
    expect(formatearMes("2027-01-01T00:00:00.000Z")).toBe("enero de 2027");
  });

  it("devuelve el vacío indicado", () => {
    expect(formatearMes(null)).toBe("—");
    expect(formatearMes("")).toBe("—");
    expect(formatearMes(null, "")).toBe("");
  });
});

describe("formatearRango", () => {
  it("une los dos extremos con «al», sin flecha ni formato ISO", () => {
    expect(formatearRango("2026-07-01", "2026-07-31")).toBe("01/07/2026 al 31/07/2026");
    expect(formatearRango("2028-02-01", "2028-02-29T00:00:00.000Z")).toBe("01/02/2028 al 29/02/2028");
  });

  it("indica desde o hasta cuando falta un extremo", () => {
    expect(formatearRango("2026-07-01", null)).toBe("Desde 01/07/2026");
    expect(formatearRango(null, "2026-07-31")).toBe("Hasta 31/07/2026");
  });

  it("devuelve el vacío indicado si no hay ningún extremo", () => {
    expect(formatearRango(null, undefined)).toBe("—");
    expect(formatearRango(null, null, "")).toBe("");
  });
});

describe("formatearFechaHora", () => {
  it("muestra día, mes, año y hora de 24 h en hora de Argentina", () => {
    // 17:30 UTC son las 14:30 en Buenos Aires (UTC−3).
    expect(formatearFechaHora("2026-07-05T17:30:00.000Z")).toBe("05/07/2026 14:30");
  });

  it("cambia de día entre UTC y UTC−3", () => {
    // 2026-07-06 01:30 UTC es 05/07 22:30 en Buenos Aires.
    expect(formatearFechaHora("2026-07-06T01:30:00.000Z")).toBe("05/07/2026 22:30");
  });

  it("cruza el fin de año en hora de Argentina", () => {
    expect(formatearFechaHora("2026-12-31T23:30:00.000Z")).toBe("31/12/2026 20:30");
    expect(formatearFechaHora("2027-01-01T02:59:00.000Z")).toBe("31/12/2026 23:59");
  });

  it("incluye el 29 de febrero", () => {
    expect(formatearFechaHora("2028-02-29T12:00:00.000Z")).toBe("29/02/2028 09:00");
  });

  it("devuelve el vacío indicado y «—» por defecto", () => {
    expect(formatearFechaHora(null)).toBe("—");
    expect(formatearFechaHora("")).toBe("—");
    expect(formatearFechaHora(undefined, "")).toBe("");
  });
});
