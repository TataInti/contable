import { describe, expect, it } from "vitest";
import { extractionForApi } from "./extraction-contract.js";

describe("contrato de lectura de extracciones", () => {
  it("normaliza el JSONB ausente de filas históricas a una lista vacía", () => {
    const legacy = {
      schemaVersion: "voucher-ar-v2",
      voucherData: { percepciones: [{ tipo: "IIBB - dato sintetico", importe: "12.00" }] },
      reviewIssues: null,
    };

    const response = extractionForApi(legacy);

    expect(response.schemaVersion).toBe("voucher-ar-v2");
    expect(response.voucherData).toEqual(legacy.voucherData);
    expect(response.reviewIssues).toEqual([]);
  });

  it("expone la ruta estructural y deja sin ruta los motivos de documento", () => {
    const response = extractionForApi({
      reviewIssues: [
        { reason: "percepción no reconocida", sourcePath: "percepciones[1].categoria" },
        { reason: "sin datos fiscales", sourcePath: null },
      ],
    });

    expect(response.reviewIssues).toEqual([
      { reason: "percepción no reconocida", sourcePath: "percepciones[1].categoria" },
      { reason: "sin datos fiscales", sourcePath: null },
    ]);
  });

  it("filtra JSONB malformado en lugar de exponerlo como contrato válido", () => {
    expect(extractionForApi({ reviewIssues: [{ reason: 42, sourcePath: "iva[0].importe" }] })).toEqual({
      reviewIssues: [],
    });
  });
});
