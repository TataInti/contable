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
  page: z.number().int().positive().optional(),
  boundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  method: extractionMethod,
  status: extractionFieldStatus.default("ACCEPTED"),
  correction: z.string().optional(),
  reason: z.string().optional(),
});
export type ExtractedField = z.infer<typeof extractedFieldSchema>;

/** Ítem de línea extraído */
export const extractedLineItemSchema = z.object({
  description: z.string(),
  quantity: z.string().optional(),
  unitPrice: z.string().optional(),
  netAmount: z.string().optional(),
  vatRate: z.string().optional(),
  vatAmount: z.string().optional(),
  totalAmount: z.string().optional(),
  confidence: z.number().min(0).max(1),
  page: z.number().int().positive().optional(),
  boundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  method: extractionMethod,
  status: extractionFieldStatus.default("ACCEPTED"),
});
export type ExtractedLineItem = z.infer<typeof extractedLineItemSchema>;

/** Resultado de extracción (contrato del schema de extracción) */
export const extractionResultSchema = z.object({
  documentType: z.string(),
  letter: voucherLetter.optional(),
  direction: voucherDirection,
  pointOfSale: z.string().optional(),
  number: z.string().optional(),
  emitterCuit: cuit.optional(),
  receiverCuit: cuit.optional(),
  issueDate: isoDate.optional(),
  totalAmount: money.optional(),
  netAmount: money.optional(),
  vatAmount: money.optional(),
  currency: z.string().length(3).optional(),
  fields: z.array(extractedFieldSchema),
  items: z.array(extractedLineItemSchema).optional(),
});
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