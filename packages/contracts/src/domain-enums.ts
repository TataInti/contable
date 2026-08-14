import { z } from "zod";

// Enums de dominio

export const accountType = z.enum([
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
  "MEMO",
]);
export type AccountType = z.infer<typeof accountType>;

export const normalBalance = z.enum(["DEBIT", "CREDIT"]);
export type NormalBalance = z.infer<typeof normalBalance>;

export const journalEntryStatus = z.enum([
  "DRAFT",
  "IN_REVIEW",
  "REVIEWED",
  "POSTED",
  "REVERSED",
  "REJECTED",
]);
export type JournalEntryStatus = z.infer<typeof journalEntryStatus>;

export const journalEntrySourceType = z.enum([
  "MANUAL",
  "DOCUMENT",
  "BANK",
  "OPENING",
  "EXCHANGE",
  "INFLATION",
  "TAX",
  "CLOSING",
  "IMPORT",
]);
export type JournalEntrySourceType = z.infer<typeof journalEntrySourceType>;

export const accountingPeriodStatus = z.enum(["OPEN", "SOFT_CLOSED", "HARD_CLOSED"]);
export type AccountingPeriodStatus = z.infer<typeof accountingPeriodStatus>;

export const fiscalYearStatus = z.enum(["OPEN", "CLOSING", "CLOSED"]);
export type FiscalYearStatus = z.infer<typeof fiscalYearStatus>;

export const voucherDirection = z.enum(["PURCHASE", "SALE", "NEUTRAL"]);
export type VoucherDirection = z.infer<typeof voucherDirection>;

export const voucherLetter = z.enum(["A", "B", "C", "M"]);
export type VoucherLetter = z.infer<typeof voucherLetter>;

export const voucherStatus = z.enum(["DRAFT", "APPROVED", "ACCOUNTED", "VOIDED"]);
export type VoucherStatus = z.infer<typeof voucherStatus>;

export const documentStatus = z.enum([
  "UPLOADED",
  "VALIDATING",
  "READY",
  "APPLIED",
  "FAILED",
  "CANCELED",
]);

export const documentCategory = z.enum([
  "INVOICE",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "TICKET",
  "RECEIPT",
  "PAYMENT",
  "BANK_STATEMENT",
  "OTHER",
]);

export const extractionFieldStatus = z.enum([
  "ACCEPTED",
  "CORRECTED",
  "MISSING",
  "CONFLICT",
]);

export const extractionMethod = z.enum(["QR", "EMBEDDED_TEXT", "OCR", "VISION", "HUMAN"]);

export const firmRole = z.enum([
  "OWNER",
  "ADMIN",
  "PREPARER",
  "REVIEWER",
  "AUDITOR_READONLY",
]);
export type FirmRole = z.infer<typeof firmRole>;

export const portalRole = z.enum(["CLIENT_ADMIN", "CLIENT_CONTRIBUTOR", "CLIENT_READONLY"]);
export type PortalRole = z.infer<typeof portalRole>;

export const obligationStatus = z.enum([
  "PENDING",
  "WAITING_CLIENT",
  "READY",
  "FILED",
  "PAID",
  "OVERDUE",
  "NOT_APPLICABLE",
]);

export const vatSettlementStatus = z.enum([
  "DRAFT",
  "CALCULATED",
  "REVIEWED",
  "FINALIZED",
  "REJECTED",
]);

export const reportSnapshotStatus = z.enum(["DRAFT", "REVIEWED", "PUBLISHED", "SUPERSEDED"]);

export const uploadOrigin = z.enum(["FIRM", "PORTAL", "IMPORT"]);