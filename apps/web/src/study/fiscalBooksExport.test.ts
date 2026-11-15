import { describe, expect, it } from "vitest";
import { FISCAL_BOOK_COLUMN_KEYS } from "@contable/contracts";
import {
  buildFiscalBookExportUrl,
  fiscalBooksSummaryUrl,
  formatFiscalAmount,
  orderFiscalBookColumns,
} from "./fiscalBooksExport";

// Datos sintéticos rotulados (cliente y período de prueba del corte 7b).
const scope = { firmId: "firma-sintetica-7b", clientId: "cliente-sintetico-7b", periodId: "periodo-sintetico-7b" };

describe("dirección de la descarga de libros", () => {
  it("lleva periodId, book, format, columns, sortBy y sortDir correctos", () => {
    const url = buildFiscalBookExportUrl({
      ...scope,
      book: "sales",
      format: "csv",
      columns: ["total", "issuedOn"],
      sortBy: "total",
      sortDir: "desc",
    });
    const [path, query = ""] = url.split("?");
    const params = new URLSearchParams(query);

    expect(path).toBe(`/firms/${scope.firmId}/clients/${scope.clientId}/fiscal-books/export`);
    expect(params.get("periodId")).toBe(scope.periodId);
    expect(params.get("book")).toBe("sales");
    expect(params.get("format")).toBe("csv");
    expect(params.get("columns")).toBe("issuedOn,total");
    expect(params.get("sortBy")).toBe("total");
    expect(params.get("sortDir")).toBe("desc");
  });

  it("con todas las columnas envía la lista completa en el orden del libro", () => {
    const url = buildFiscalBookExportUrl({
      ...scope,
      book: "purchases",
      format: "xlsx",
      columns: FISCAL_BOOK_COLUMN_KEYS,
      sortBy: "issuedOn",
      sortDir: "asc",
    });
    const params = new URLSearchParams(url.split("?")[1]);

    expect(params.get("columns")).toBe(FISCAL_BOOK_COLUMN_KEYS.join(","));
    expect(params.get("book")).toBe("purchases");
    expect(params.get("format")).toBe("xlsx");
    expect(params.get("sortBy")).toBe("issuedOn");
    expect(params.get("sortDir")).toBe("asc");
  });

  it("ordena las columnas según el libro y quita las repetidas", () => {
    expect(orderFiscalBookColumns(["total", "number", "total", "issuedOn"])).toEqual([
      "issuedOn",
      "number",
      "total",
    ]);
  });

  it("no arma la descarga sin columnas", () => {
    expect(() =>
      buildFiscalBookExportUrl({ ...scope, book: "purchases", format: "xlsx", columns: [], sortBy: "issuedOn", sortDir: "asc" }),
    ).toThrow(/al menos una columna/);
  });
});

describe("resumen del período", () => {
  it("consulta el período con su identificador codificado", () => {
    expect(fiscalBooksSummaryUrl({ ...scope, periodId: "p 1&x" })).toBe(
      `/firms/${scope.firmId}/clients/${scope.clientId}/fiscal-books/summary?periodId=p+1%26x`,
    );
  });

  it("muestra importes en pesos con separadores es-AR", () => {
    expect(formatFiscalAmount("14294")).toContain("14.294,00");
    expect(formatFiscalAmount("-1250.5")).toContain("1.250,50");
    expect(formatFiscalAmount(undefined)).toContain("0,00");
  });
});
