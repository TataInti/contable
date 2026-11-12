import { describe, expect, it } from "vitest";
import {
  approvedSnapshotDataSchema,
  extractionApprovedSnapshotSchema,
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

describe("contrato de foto fija de aprobación", () => {
  it("valida valores finales, trazabilidad de listas y reviewIssues", () => {
    const data = approvedSnapshotDataSchema.parse({
      fields: [
        {
          key: "vatRate",
          value: "21.00",
          source: "AI",
          originalValue: null,
          sourcePath: "iva[0].alicuota",
          index: 0,
        },
        {
          key: "totalAmount",
          value: "121000.00",
          source: "CORRECTED",
          originalValue: "120000.00",
          sourcePath: null,
          index: null,
        },
      ],
      reviewIssues: [{ reason: "percepción no reconocida", sourcePath: "percepciones[0].categoria" }],
    });
    const snapshot = extractionApprovedSnapshotSchema.parse({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      documentId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      extractionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      approvedBy: "11111111-1111-4111-8111-111111111111",
      approvedAt: "2026-11-12T00:00:00.000Z",
      schemaVersion: "voucher-ar-v2.1",
      ocrEngine: "multimodal-model",
      model: "synthetic-model",
      provider: "synthetic-provider",
      promptVersion: "vision-ar-v6",
      data,
    });

    expect(snapshot.data.fields[0]?.sourcePath).toBe("iva[0].alicuota");
    expect(snapshot.data.reviewIssues).toHaveLength(1);
  });
});
