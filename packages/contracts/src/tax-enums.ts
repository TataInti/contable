import { z } from "zod";

// ============================================================
// Enums de dominio fiscal (Puerta 1)
// Fuente: PLAN_DESARROLLO_CONTABLE.md §7.2, §7.3
// ============================================================

export const jurisdictionKind = z.enum(["NATIONAL", "PROVINCIAL", "MUNICIPAL"]);
export type JurisdictionKind = z.infer<typeof jurisdictionKind>;

export const personType = z.enum(["FISICA", "JURIDICA"]);
export type PersonType = z.infer<typeof personType>;

export const nationalTaxCondition = z.enum([
  "RESPONSABLE_INSCRIPTO",
  "MONOTRIBUTISTA",
  "EXENTO",
  "NO_RESPONSABLE",
]);
export type NationalTaxCondition = z.infer<typeof nationalTaxCondition>;

export const taxpayerProfileStatus = z.enum(["DRAFT", "IN_REVIEW", "ACTIVE", "SUPERSEDED"]);
export type TaxpayerProfileStatus = z.infer<typeof taxpayerProfileStatus>;

export const taxRegistrationStatus = z.enum(["ACTIVE", "SUSPENDED", "CANCELLED"]);
export type TaxRegistrationStatus = z.infer<typeof taxRegistrationStatus>;

export const credentialStatus = z.enum(["ACTIVE", "SUSPENDED", "EXPIRED"]);
export type CredentialStatus = z.infer<typeof credentialStatus>;

export const taxObligationStatus = z.enum([
  "PENDING",
  "WAITING_INPUTS",
  "READY_TO_CALCULATE",
  "IN_REVIEW",
  "READY_TO_FILE",
  "FILED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "NOT_APPLICABLE",
]);
export type TaxObligationStatus = z.infer<typeof taxObligationStatus>;

export const taxRulePackStatus = z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "ACTIVE", "RETIRED"]);
export type TaxRulePackStatus = z.infer<typeof taxRulePackStatus>;

export const taxSettlementStatus = z.enum([
  "DRAFT",
  "CALCULATED",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "REVIEWED",
  "FINALIZED",
  "SUPERSEDED",
]);
export type TaxSettlementStatus = z.infer<typeof taxSettlementStatus>;

export const taxDifferenceSeverity = z.enum(["INFO", "WARNING", "BLOCKING"]);
export type TaxDifferenceSeverity = z.infer<typeof taxDifferenceSeverity>;

export const taxDifferenceStatus = z.enum(["OPEN", "RESOLVED", "WAIVED"]);
export type TaxDifferenceStatus = z.infer<typeof taxDifferenceStatus>;

export const managementExpenseStatus = z.enum([
  "DRAFT",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUPERSEDED",
]);
export type ManagementExpenseStatus = z.infer<typeof managementExpenseStatus>;

export const taxTreatment = z.enum([
  "MANAGEMENT_ONLY",
  "FISCAL_COMPUTABLE",
  "FISCAL_NON_COMPUTABLE",
  "PENDING_PROFESSIONAL_DECISION",
]);
export type TaxTreatment = z.infer<typeof taxTreatment>;

export const fiscalVoucherDirection = z.enum(["PURCHASE", "SALE"]);
export type FiscalVoucherDirection = z.infer<typeof fiscalVoucherDirection>;

export const fiscalVoucherStatus = z.enum([
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUPERSEDED",
]);
export type FiscalVoucherStatus = z.infer<typeof fiscalVoucherStatus>;

export const importBatchStatus = z.enum([
  "UPLOADED",
  "VALIDATING",
  "VALIDATED",
  "COMMITTED",
  "FAILED",
  "CANCELLED",
]);
export type ImportBatchStatus = z.infer<typeof importBatchStatus>;

export const importRowStatus = z.enum(["PENDING", "VALID", "ERROR", "DUPLICATE", "COMMITTED"]);
export type ImportRowStatus = z.infer<typeof importRowStatus>;

export const taxFilingStatus = z.enum(["DRAFT", "FILED", "REVERSED"]);
export type TaxFilingStatus = z.infer<typeof taxFilingStatus>;

export const taxPaymentStatus = z.enum(["PENDING", "PAID", "REVERSED"]);
export type TaxPaymentStatus = z.infer<typeof taxPaymentStatus>;

export const profitabilityBasis = z.enum(["DEVENGADO", "CAJA"]);
export type ProfitabilityBasis = z.infer<typeof profitabilityBasis>;