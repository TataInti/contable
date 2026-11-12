import { describe, expect, it } from "vitest";
import {
  cm03CoefficientSourceRowsFromFacts,
  resolveCm03CoefficientJurisdictionIds,
  WorkpaperError,
} from "./workpaper-service.js";

describe("coeficientes CM03 del expediente", () => {
  it("lee la jurisdicción estructurada y la resuelve por el catálogo", () => {
    const rows = cm03CoefficientSourceRowsFromFacts([
      {
        rowId: "synthetic-coef-1",
        sourceType: "CM03_COEFFICIENT",
        normalized: {
          activityCode: "ETIQUETA_LIBRE",
          jurisdiction: " tuc ",
          coefficient: "0.6",
        },
      },
      {
        rowId: "synthetic-income",
        sourceType: "FISCAL_VOUCHER",
        normalized: { jurisdiction: "CBA", coefficient: "0.4" },
      },
    ]);
    const resolved = resolveCm03CoefficientJurisdictionIds(
      rows,
      new Map([["TUC", "jurisdiction-id-tuc"]]),
    );

    expect(resolved).toEqual([{
      sourceId: "synthetic-coef-1",
      jurisdiction: "TUC",
      jurisdictionId: "jurisdiction-id-tuc",
      coefficient: "0.6",
    }]);
  });

  it("bloquea un coeficiente sin jurisdicción estructurada", () => {
    expect(() => cm03CoefficientSourceRowsFromFacts([{
      rowId: "synthetic-missing-jurisdiction",
      sourceType: "CM03_COEFFICIENT",
      normalized: { activityCode: "COEF_TUC", coefficient: "0.6" },
    }])).toThrowError(WorkpaperError);
  });

  it("bloquea una jurisdicción ausente del catálogo", () => {
    const rows = cm03CoefficientSourceRowsFromFacts([{
      rowId: "synthetic-unknown-jurisdiction",
      sourceType: "CM03_COEFFICIENT",
      normalized: { jurisdiction: "TUC", coefficient: "0.6" },
    }]);

    expect(() => resolveCm03CoefficientJurisdictionIds(rows, new Map()))
      .toThrowError(/no existe en el catálogo/);
  });
});
