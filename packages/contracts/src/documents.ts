import { z } from "zod";
import { cuit, isoDate, money, uuid } from "./primitives.js";
import {
  extractionFieldStatus,
  extractionMethod,
  voucherDirection,
  voucherLetter,
  voucherStatus,
} from "./domain-enums.js";
import { VOUCHER_DOCUMENT_TYPES } from "./manual-extraction.js";

/** Campo extraído */
export const extractedFieldSchema = z.object({
  key: z.string(),
  rawValue: z.string().nullable(),
  normalizedValue: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  page: z.number().int().positive().nullable().optional(),
  boundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable()
    .optional(),
  method: extractionMethod,
  status: extractionFieldStatus.default("ACCEPTED"),
  correction: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
});
export type ExtractedField = z.infer<typeof extractedFieldSchema>;

const amountText = z.string().regex(/^-?\d+(?:\.\d{1,6})?$/);
export const perceptionCategorySchema = z.enum([
  "IIBB",
  "IVA",
  "Ganancias",
  "SUSS",
  "Impuestos internos",
  "Municipal",
  "Otras",
]);
export type PerceptionCategory = z.infer<typeof perceptionCategorySchema>;

const voucherCommonShape = {
  tipo_documento: z.enum(VOUCHER_DOCUMENT_TYPES),
  letra: z.string().nullable(),
  punto_venta: z.string().nullable(),
  numero: z.string().nullable(),
  fecha: isoDate.nullable(),
  hora: z.string().nullable(),
  cuit_emisor: z.string().regex(/^\d{11}$/).nullable(),
  cuit_receptor: z.string().regex(/^\d{11}$/).nullable(),
  razon_social_emisor: z.string().nullable(),
  razon_social_receptor: z.string().nullable(),
  condicion_iva: z.string().nullable(),
  neto_gravado: amountText.nullable(),
  iva: z
    .array(
      z
        .object({
          alicuota: amountText.nullable(),
          importe: amountText.nullable(),
        })
        .strict(),
    )
    .nullable(),
  no_gravado: amountText.nullable(),
  exento: amountText.nullable(),
  total: amountText.nullable(),
  moneda: z.string().regex(/^[A-Z]{3}$/).nullable(),
  cae: z.string().nullable(),
  cae_vencimiento: isoDate.nullable(),
  confianza: z
    .record(z.string(), z.number().min(0).max(1))
    .refine(
      (confidence) =>
        !Object.keys(confidence).some((path) => path === "items" || path.startsWith("items.")),
      "El esquema de extracción fiscal no contempla confianza de ítems",
    ),
};

/** Contrato histórico; las extracciones guardadas conservan percepciones[].tipo. */
export const voucherARV2Schema = z
  .object({
    ...voucherCommonShape,
    percepciones: z
      .array(
        z
          .object({
            tipo: z.string().nullable(),
            importe: amountText.nullable(),
          })
          .strict(),
      )
      .nullable(),
  })
  .strict();
export type VoucherARV2 = z.infer<typeof voucherARV2Schema>;

/** Esquema vigente: separa la categoría fiscal del literal impreso. */
export const voucherARV21Schema = z
  .object({
    ...voucherCommonShape,
    percepciones: z
      .array(
        z
          .object({
            categoria: perceptionCategorySchema,
            tipo_texto: z.string().nullable(),
            importe: amountText.nullable(),
          })
          .strict(),
      )
      .nullable(),
  })
  .strict();
export type VoucherARV21 = z.infer<typeof voucherARV21Schema>;

export const reviewIssueSchema = z
  .object({
    reason: z.string(),
    sourcePath: z.string().nullable(),
  })
  .strict();
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

/** Resultado multimodal de extracción y telemetría asociada. */
export const extractionResultSchema = z
  .object({
    schemaVersion: z.enum(["voucher-ar-v2", "voucher-ar-v2.1"]),
    voucher: z.union([voucherARV2Schema, voucherARV21Schema]).nullable(),
    classificationConfidence: z.number().min(0).max(1).nullable(),
    fields: z.array(extractedFieldSchema),
    issues: z.array(z.string()),
    reviewReason: z.string().nullable(),
    reviewIssues: z.array(reviewIssueSchema).nullish().transform((issues) => issues ?? []),
    ocrEngine: z.string(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    promptVersion: z.string(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    latencyMs: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative().nullable(),
  })
  .strict();
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

/** Voucher aprobado */
export const voucherSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  documentId: uuid,
  extractionId: uuid,
  direction: voucherDirection,
  type: z.string(),
  letter: voucherLetter.optional(),
  pointOfSale: z.string().optional(),
  number: z.string().optional(),
  emitterCuit: cuit.optional(),
  receiverCuit: cuit.optional(),
  issueDate: isoDate,
  currency: z.string().length(3),
  exchangeRate: z.string().optional(),
  netAmount: money.optional(),
  vatAmount: money.optional(),
  totalAmount: money,
  status: voucherStatus.default("DRAFT"),
  version: z.number().int().positive(),
  approvedByUserId: uuid.nullable(),
});
export type Voucher = z.infer<typeof voucherSchema>;

export const approvedSnapshotSourceSchema = z.enum(["AI", "CORRECTED", "HUMAN"]);
export type ApprovedSnapshotSource = z.infer<typeof approvedSnapshotSourceSchema>;

export const approvedSnapshotFieldSchema = z
  .object({
    key: z.string(),
    value: z.string().nullable(),
    source: approvedSnapshotSourceSchema,
    originalValue: z.string().nullable(),
    sourcePath: z.string().nullable(),
    index: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ApprovedSnapshotField = z.infer<typeof approvedSnapshotFieldSchema>;

export const approvedSnapshotDataSchema = z
  .object({
    fields: z.array(approvedSnapshotFieldSchema),
    reviewIssues: z.array(reviewIssueSchema),
  })
  .strict();
export type ApprovedSnapshotData = z.infer<typeof approvedSnapshotDataSchema>;

export const extractionApprovedSnapshotSchema = z
  .object({
    id: uuid,
    firmId: uuid,
    clientId: uuid,
    documentId: uuid,
    extractionId: uuid,
    approvedBy: uuid,
    approvedAt: z.string().datetime(),
    schemaVersion: z.string().min(1),
    ocrEngine: z.string().nullable(),
    model: z.string().nullable(),
    provider: z.string().nullable(),
    promptVersion: z.string().nullable(),
    data: approvedSnapshotDataSchema,
  })
  .strict();
export type ExtractionApprovedSnapshot = z.infer<typeof extractionApprovedSnapshotSchema>;
