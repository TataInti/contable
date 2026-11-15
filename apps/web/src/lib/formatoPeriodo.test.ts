import { describe, expect, it } from "vitest";
import { formatearPeriodo } from "./formatoFechas";

describe("formatearPeriodo", () => {
  it("muestra el mes cuando el período cubre un mes calendario completo", () => {
    expect(formatearPeriodo("2026-09-01", "2026-09-30")).toBe("septiembre de 2026");
  });

  it("reconoce el último día de febrero en años bisiestos y no bisiestos", () => {
    expect(formatearPeriodo("2028-02-01", "2028-02-29")).toBe("febrero de 2028");
    expect(formatearPeriodo("2026-02-01", "2026-02-28")).toBe("febrero de 2026");
  });

  it("muestra el rango cuando cubre medio mes", () => {
    expect(formatearPeriodo("2026-09-01", "2026-09-15")).toBe("01/09/2026 al 15/09/2026");
    expect(formatearPeriodo("2026-09-16", "2026-09-30")).toBe("16/09/2026 al 30/09/2026");
  });

  it("muestra el rango cuando cubre varios meses", () => {
    expect(formatearPeriodo("2026-08-01", "2026-09-30")).toBe("01/08/2026 al 30/09/2026");
  });

  it("no toma como mes calendario un inicio que no es el primer día", () => {
    expect(formatearPeriodo("2026-09-02", "2026-09-30")).toBe("02/09/2026 al 30/09/2026");
  });

  it("muestra el rango con «Desde» o «Hasta» cuando falta un extremo, y el vacío si no hay fechas", () => {
    expect(formatearPeriodo("2026-09-01", null)).toBe("Desde 01/09/2026");
    expect(formatearPeriodo(null, "2026-09-30")).toBe("Hasta 30/09/2026");
    expect(formatearPeriodo(null, null)).toBe("—");
    expect(formatearPeriodo(null, null, "")).toBe("");
  });
});
