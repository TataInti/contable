import { z } from "zod";
import { cuit, decimalRate, isoDate, money, uuid } from "./primitives.js";

/** Contrato canónico BI */
export const biQueryPlanSchema = z
  .object({
    version: z.literal(1),
    clientId: uuid,
    fiscalPeriodId: uuid,
    metric: z.string(),
    dimensions: z.array(z.string()),
    filters: z.array(
      z.object({
        field: z.string(),
        operator: z.enum(["eq", "neq", "in", "gte", "lte"]),
        value: z.union([z.string(), z.array(z.string())]),
      }),
    ),
    comparison: z.enum(["NONE", "PREVIOUS_PERIOD", "PREVIOUS_YEAR"]).default("NONE"),
    limit: z.number().int().positive().max(200),
  })
  .strict();
export type BiQueryPlan = z.infer<typeof biQueryPlanSchema>;

/** Contrato de extracción Node → FastAPI */
export const extractionRequestSchema = z
  .object({
    contractVersion: z.literal("1.0"),
    runId: uuid,
    firmId: uuid,
    clientId: uuid,
    documentId: uuid,
    source: z.object({
      downloadUrl: z.string().url(),
      mimeType: z.string(),
      sizeBytes: z.number().int().positive(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 inválido"),
    }),
    options: z.object({
      country: z.literal("AR"),
      language: z.string().default("es"),
      maxPages: z.number().int().positive().max(100).default(100),
      runQrParser: z.boolean().default(true),
      runOcr: z.boolean().default(true),
      runVisionFallback: z.boolean().default(true),
      schemaVersion: z.string(),
    }),
    callback: z.object({
      url: z.string().url(),
      expiresAt: z.string().datetime(),
    }),
  })
  .strict();
export type ExtractionRequest = z.infer<typeof extractionRequestSchema>;

/** Contrato de obligación */
export const obligationSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  ruleVersionId: uuid,
  periodKey: z.string(),
  dueDate: isoDate,
  responsibleUserId: uuid.nullable(),
  reviewerUserId: uuid.nullable(),
  estimatedAmount: money.optional(),
  finalAmount: money.optional(),
  status: z.enum([
    "PENDING",
    "WAITING_CLIENT",
    "READY",
    "FILED",
    "PAID",
    "OVERDUE",
    "NOT_APPLICABLE",
  ]),
  filedAt: z.string().datetime().nullable(),
  paidAt: z.string().datetime().nullable(),
});
export type Obligation = z.infer<typeof obligationSchema>;

/** Contrato de cuenta */
export const accountSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  chartVersionId: uuid,
  code: z.string(),
  name: z.string(),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "MEMO"]),
  normalBalance: z.enum(["DEBIT", "CREDIT"]),
  parentId: uuid.nullable(),
  level: z.number().int().nonnegative(),
  path: z.string(),
  isPostable: z.boolean(),
  isActive: z.boolean(),
  currencyBehavior: z.enum(["FUNCTIONAL_ONLY", "ORIGINAL_AND_FUNCTIONAL"]),
  monetaryClassification: z.enum(["MONETARY", "NON_MONETARY", "NOT_APPLICABLE"]),
  vatRole: z.enum(["NONE", "INPUT_VAT", "OUTPUT_VAT", "WITHHOLDING", "PERCEPTION"]),
});
export type Account = z.infer<typeof accountSchema>;

/** Contrato de importe con tipo de cambio */
export const foreignAmountSchema = z.object({
  currencyCode: z.string().length(3),
  originalAmount: money,
  exchangeRate: decimalRate,
  functionalAmount: money,
});
export type ForeignAmount = z.infer<typeof foreignAmountSchema>;

/** Contrato de CUIT para contraparte */
export const counterpartySchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  cuit: cuit,
  legalName: z.string(),
  tradeName: z.string().optional(),
  taxCondition: z.string().optional(),
  aliases: z.array(z.string()).default([]),
});
export type Counterparty = z.infer<typeof counterpartySchema>;