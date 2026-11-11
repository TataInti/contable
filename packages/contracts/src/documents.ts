import { z } from "zod";
import { cuit, isoDate, money, uuid } from "./primitives.js";
import {
  extractionFieldStatus,
  extractionMethod,
  voucherDirection,
  voucherLetter,
  voucherStatus,
} from "./domain-enums.js";

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

/** Esquema canónico del comprobante argentino voucher-ar-v2. */
export const voucherARV2Schema = z
  .object({
    tipo_documento: z.enum([
      "factura",
      "ticket_no_fiscal",
      "recibo",
      "nota_credito",
      "nota_debito",
      "otro",
      "ilegible",
    ]),
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
    total: amountText.nullable(),
    moneda: z.string().regex(/^[A-Z]{3}$/).nullable(),
    cae: z.string().nullable(),
    cae_vencimiento: isoDate.nullable(),
    confianza: z
      .record(z.string(), z.number().min(0).max(1))
      .refine(
        (confidence) =>
          !Object.keys(confidence).some((path) => path === "items" || path.startsWith("items.")),
        "voucher-ar-v2 no contempla confianza de ítems",
      ),
  })
  .strict();
export type VoucherARV2 = z.infer<typeof voucherARV2Schema>;

/** Resultado multimodal de extracción y telemetría asociada. */
export const extractionResultSchema = z.object({
  schemaVersion: z.literal("voucher-ar-v2"),
  voucher: voucherARV2Schema.nullable(),
  classificationConfidence: z.number().min(0).max(1).nullable(),
  fields: z.array(extractedFieldSchema),
  issues: z.array(z.string()),
  reviewReason: z.string().nullable(),
  ocrEngine: z.string(),
  model: z.string().nullable(),
  provider: z.string().nullable(),
  promptVersion: z.string(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  latencyMs: z.number().int().nonnegative(),
  estimatedCostUsd: z.number().nonnegative().nullable(),
}).strict();
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