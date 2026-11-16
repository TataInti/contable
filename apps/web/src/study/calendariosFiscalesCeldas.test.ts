import { describe, expect, it } from "vitest";
import {
  celdasVisibles,
  esCeldaDudosa,
  reviewStatus,
  resumenCeldas,
  textoDudosas,
  textoPieCeldas,
  type CalendarEntryRow,
  type ReviewStateKey,
} from "./calendariosFiscales";

const ESTADOS: Array<ReviewStateKey | null> = ["PROPOSED", "REVIEWED", "FLAGGED", null];

function celda(reviewState: ReviewStateKey | null): Pick<CalendarEntryRow, "reviewState"> {
  return { reviewState };
}

describe("celdas dudosas (hallazgo 80)", () => {
  it("«dudosa» es exactamente el estado que el rótulo muestra como Dudosa", () => {
    for (const estado of ESTADOS) {
      expect(esCeldaDudosa(celda(estado))).toBe(reviewStatus(estado).label === "Dudosa");
    }
    expect(esCeldaDudosa(celda("FLAGGED"))).toBe(true);
  });

  it("sin filtro muestra todas las celdas; con «Solo dudosas», solo las dudosas, en su orden", () => {
    const entradas = [celda("REVIEWED"), celda("FLAGGED"), celda(null), celda("FLAGGED")];
    expect(celdasVisibles(entradas, false)).toEqual(entradas);
    expect(celdasVisibles(entradas, true)).toEqual([celda("FLAGGED"), celda("FLAGGED")]);
  });

  it("el resumen cuenta total y dudosas, y el texto del pie concuerda en singular y plural", () => {
    expect(
      resumenCeldas([celda("FLAGGED"), celda("REVIEWED"), celda("PROPOSED"), celda("FLAGGED")]),
    ).toEqual({ total: 4, dudosas: 2 });
    expect(textoDudosas(1)).toBe("1 dudosa");
    expect(textoDudosas(0)).toBe("0 dudosas");
    expect(textoDudosas(297)).toBe("297 dudosas");
    expect(textoPieCeldas(412, 297)).toBe("412 celdas · 297 dudosas");
    expect(textoPieCeldas(3, 1)).toBe("3 celdas · 1 dudosa");
    expect(textoPieCeldas(1, 0)).toBe("1 celda · 0 dudosas");
  });
});
