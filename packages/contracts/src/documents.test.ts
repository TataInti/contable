import { describe, expect, it } from "vitest";
import {
  extractionResultSchema,
  voucherARV2Schema,
  voucherARV21Schema,
} from "./documents.js";

const voucher = {
  tipo_documento: "factura",
  letra: "A",
  punto_venta: null,
  numero: null,
  fecha: null,
  hora: null,
  cuit_emisor: null,
  cuit_receptor: null,
  razon_social_emisor: null,
  razon_social_receptor: null,
  condicion_iva: null,
  neto_gravado: null,
  iva: null,
  no_gravado: null,
  exento: null,
  percepciones: null,
  total: null,
  moneda: null,
  cae: null,
  cae_vencimiento: null,
  confianza: { tipo_documento: 0.95, letra: 0.9 },
} as const;

const extractionResult = {
  schemaVersion: "voucher-ar-v2.1",
  voucher,
  classificationConfidence: 0.95,
  fields: [],
  issues: [],
  reviewReason: null,
  reviewIssues: [],
  ocrEngine: "multimodal-model",
  model: null,
  provider: null,
  promptVersion: "vision-ar-v2",
  inputTokens: null,
  outputTokens: null,
  latencyMs: 0,
  estimatedCostUsd: null,
} as const;

describe("contrato voucher-ar-v2.1 sin líneas", () => {
  it("rechaza ítems en el voucher y en la respuesta", () => {
    expect(voucherARV2Schema.safeParse({ ...voucher, items: [] }).success).toBe(false);
    expect(extractionResultSchema.safeParse({ ...extractionResult, items: [] }).success).toBe(false);
    expect(
      voucherARV2Schema.safeParse({
        ...voucher,
        confianza: { ...voucher.confianza, "items.0.descripcion": 0.9 },
      }).success,
    ).toBe(false);
  });

  it("valida una respuesta que no contiene ítems", () => {
    const parsed = extractionResultSchema.parse(extractionResult);
    expect(parsed).not.toHaveProperty("items");
    expect(parsed.voucher).not.toHaveProperty("items");
  });

  it("mantiene legibles las extracciones guardadas con el formato v2.tipo", () => {
    const legacyResult: Record<string, unknown> = {
      ...extractionResult,
      schemaVersion: "voucher-ar-v2",
    };
    Reflect.deleteProperty(legacyResult, "reviewIssues");
    legacyResult.voucher = {
      ...voucher,
      percepciones: [{ tipo: "IIBB - dato sintetico", importe: "12.00" }],
    };

    const parsed = extractionResultSchema.parse(legacyResult);

    expect(parsed.schemaVersion).toBe("voucher-ar-v2");
    expect(parsed.voucher?.percepciones).toEqual([
      { tipo: "IIBB - dato sintetico", importe: "12.00" },
    ]);
    expect(parsed.reviewIssues).toEqual([]);
    expect(voucherARV2Schema.safeParse(legacyResult.voucher).success).toBe(true);
  });

  it("valida la categoría fija, tipo_texto y sourcePath", () => {
    const currentVoucher = {
      ...voucher,
      percepciones: [
        { categoria: "IIBB", tipo_texto: "IIBB - dato sintetico", importe: "12.00" },
      ],
    };
    const parsedVoucher = voucherARV21Schema.parse(currentVoucher);
    const result = extractionResultSchema.parse({
      ...extractionResult,
      voucher: parsedVoucher,
      reviewIssues: [
        { reason: "percepción no reconocida", sourcePath: "percepciones[0].categoria" },
        { reason: "neto + IVA no cierra con el total", sourcePath: null },
      ],
    });

    expect(result.voucher?.percepciones).toEqual(currentVoucher.percepciones);
    expect(result.reviewIssues[0]?.sourcePath).toBe("percepciones[0].categoria");
    expect(result.reviewIssues[1]?.sourcePath).toBeNull();
    expect(
      voucherARV21Schema.safeParse({
        ...currentVoucher,
        percepciones: [{ categoria: "Ganancia no catalogada", tipo_texto: null, importe: null }],
      }).success,
    ).toBe(false);
  });
});
