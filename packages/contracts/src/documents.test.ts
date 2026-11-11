import { describe, expect, it } from "vitest";
import { extractionResultSchema, voucherARV2Schema } from "./documents.js";

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
  schemaVersion: "voucher-ar-v2",
  voucher,
  classificationConfidence: 0.95,
  fields: [],
  issues: [],
  reviewReason: null,
  ocrEngine: "multimodal-model",
  model: null,
  provider: null,
  promptVersion: "vision-ar-v2",
  inputTokens: null,
  outputTokens: null,
  latencyMs: 0,
  estimatedCostUsd: null,
} as const;

describe("contrato voucher-ar-v2 sin líneas", () => {
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
});
