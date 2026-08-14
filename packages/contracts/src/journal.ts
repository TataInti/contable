import { z } from "zod";
import { currency, decimalRate, isoDate, money, uuid } from "./primitives.js";
import {
  journalEntrySourceType,
  journalEntryStatus,
  normalBalance,
} from "./domain-enums.js";

/** Línea de asiento */
export const journalLineSchema = z
  .object({
    accountId: uuid,
    costCenterId: uuid.optional(),
    counterpartyId: uuid.optional(),
    description: z.string().max(500).optional(),
    currencyCode: currency,
    debitOriginal: money,
    creditOriginal: money,
    exchangeRate: decimalRate.optional(),
    debitFunctional: money,
    creditFunctional: money,
    quantity: z.number().positive().optional(),
    reference: z.string().max(200).optional(),
  })
  .superRefine((line, ctx) => {
    const debit = parseFloat(line.debitOriginal);
    const credit = parseFloat(line.creditOriginal);
    if (debit < 0 || credit < 0) {
      ctx.addIssue({ code: "custom", message: "Los importes no pueden ser negativos" });
    }
    if (debit === 0 && credit === 0) {
      ctx.addIssue({ code: "custom", message: "Una línea no puede estar en cero" });
    }
    if (debit > 0 && credit > 0) {
      ctx.addIssue({ code: "custom", message: "No puede haber débito y crédito simultáneos" });
    }
  });
export type JournalLine = z.infer<typeof journalLineSchema>;

/** Borrador de asiento (creación) */
export const journalEntryDraftSchema = z.object({
  clientId: uuid,
  fiscalYearId: uuid,
  periodId: uuid,
  entryDate: isoDate,
  postingDate: isoDate.optional(),
  description: z.string().min(1).max(500),
  reference: z.string().max(200).optional(),
  sourceType: journalEntrySourceType.default("MANUAL"),
  lines: z.array(journalLineSchema).min(2, "Un asiento requiere al menos dos líneas"),
});
export type JournalEntryDraft = z.infer<typeof journalEntryDraftSchema>;

/** Asiento persistido */
export const journalEntrySchema = journalEntryDraftSchema.extend({
  id: uuid,
  sequenceNumber: z.number().int().positive(),
  status: journalEntryStatus.default("DRAFT"),
  preparedByUserId: uuid,
  submittedAt: z.string().datetime().nullable(),
  reviewedByUserId: uuid.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  postedByUserId: uuid.nullable(),
  postedAt: z.string().datetime().nullable(),
  reversalOfId: uuid.nullable(),
  reversedByEntryId: uuid.nullable(),
  rowVersion: z.number().int().positive(),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

/** API de posting: recibe sólo versión esperada y nota */
export const postJournalEntrySchema = z.object({
  expectedRowVersion: z.number().int().positive(),
  reviewNote: z.string().max(500).optional(),
});
export type PostJournalEntry = z.infer<typeof postJournalEntrySchema>;

/** Respuesta de error uniforme */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
    requestId: z.string().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Balance de sumas y saldos */
export const trialBalanceLineSchema = z.object({
  accountId: uuid,
  accountCode: z.string(),
  accountName: z.string(),
  debitTotal: money,
  creditTotal: money,
  balance: money,
  normalBalance,
});
export type TrialBalanceLine = z.infer<typeof trialBalanceLineSchema>;

export const trialBalanceSchema = z.object({
  clientId: uuid,
  periodId: uuid,
  cutoff: z.string().datetime(),
  lines: z.array(trialBalanceLineSchema),
  totals: z.object({
    debitTotal: money,
    creditTotal: money,
  }),
});
export type TrialBalance = z.infer<typeof trialBalanceSchema>;

/** Idempotency key */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,128}$/, "Idempotency-Key inválida");