import { z } from "zod";
import {
  credentialStatus,
  fiscalVoucherDirection,
  fiscalVoucherStatus,
  importBatchStatus,
  importRowStatus,
  jurisdictionKind,
  managementExpenseStatus,
  nationalTaxCondition,
  personType,
  profitabilityBasis,
  profitabilitySnapshotStatus,
  taxFilingStatus,
  taxObligationStatus,
  taxPaymentStatus,
  taxRegistrationStatus,
  taxRulePackStatus,
  taxSettlementStatus,
  taxTreatment,
  taxpayerProfileStatus,
} from "./tax-enums.js";
import { cuit, decimalRate, isoDate, money, uuid } from "./primitives.js";

// ============================================================
// Contratos de la fundación fiscal (Puerta 1)
// Fuente: PLAN_DESARROLLO_CONTABLE.md §7.2, §7.3, §10.3
// ============================================================

// --- Maestros ---

export const jurisdictionSchema = z.object({
  id: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  kind: jurisdictionKind,
  parentId: uuid.nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Jurisdiction = z.infer<typeof jurisdictionSchema>;

export const createJurisdictionSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  kind: jurisdictionKind,
  parentId: uuid.optional(),
});
export type CreateJurisdiction = z.infer<typeof createJurisdictionSchema>;

export const taxAuthoritySchema = z.object({
  id: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  jurisdictionId: uuid,
  isActive: z.boolean(),
});
export type TaxAuthority = z.infer<typeof taxAuthoritySchema>;

export const taxTypeSchema = z.object({
  id: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  isActive: z.boolean(),
});
export type TaxType = z.infer<typeof taxTypeSchema>;

export const taxRegimeSchema = z.object({
  id: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  taxTypeId: uuid,
  jurisdictionId: uuid,
  authorityId: uuid,
  isActive: z.boolean(),
});
export type TaxRegime = z.infer<typeof taxRegimeSchema>;

export const createTaxRegimeSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  taxTypeId: uuid,
  jurisdictionId: uuid,
  authorityId: uuid,
});
export type CreateTaxRegime = z.infer<typeof createTaxRegimeSchema>;

export const economicActivitySchema = z.object({
  id: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  jurisdictionId: uuid,
  source: z.string().nullable(),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
  isActive: z.boolean(),
});
export type EconomicActivity = z.infer<typeof economicActivitySchema>;

// --- Perfil fiscal ---

export const taxpayerProfileVersionSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  version: z.number().int().positive(),
  legalName: z.string().min(1).max(200),
  cuit,
  personType,
  nationalCondition: nationalTaxCondition,
  fiscalAddress: z.string().max(300).nullable(),
  fiscalYearEndMonth: z.number().int().min(1).max(12),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
  status: taxpayerProfileStatus,
  source: z.string().nullable(),
  createdByUserId: uuid.nullable(),
  reviewedByUserId: uuid.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  supersedesId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxpayerProfileVersion = z.infer<typeof taxpayerProfileVersionSchema>;

export const createTaxpayerProfileSchema = z.object({
  legalName: z.string().min(1).max(200),
  cuit,
  personType,
  nationalCondition: nationalTaxCondition,
  fiscalAddress: z.string().max(300).optional(),
  fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
  validFrom: isoDate,
  source: z.string().max(200).optional(),
});
export type CreateTaxpayerProfile = z.infer<typeof createTaxpayerProfileSchema>;

export const taxRegistrationSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  profileVersionId: uuid,
  regimeId: uuid,
  status: taxRegistrationStatus,
  validFrom: isoDate,
  validTo: isoDate.nullable(),
  registrationNumber: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxRegistration = z.infer<typeof taxRegistrationSchema>;

export const createTaxRegistrationSchema = z.object({
  profileVersionId: uuid,
  regimeId: uuid,
  validFrom: isoDate,
  validTo: isoDate.optional(),
  registrationNumber: z.string().max(80).optional(),
});
export type CreateTaxRegistration = z.infer<typeof createTaxRegistrationSchema>;

export const clientActivitySchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  profileVersionId: uuid,
  activityId: uuid,
  isPrimary: z.boolean(),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
});
export type ClientActivity = z.infer<typeof clientActivitySchema>;

export const professionalCredentialSchema = z.object({
  id: uuid,
  firmId: uuid,
  userId: uuid,
  jurisdictionId: uuid,
  authorityId: uuid,
  registrationNumber: z.string().min(1).max(80),
  status: credentialStatus,
  validFrom: isoDate,
  validTo: isoDate.nullable(),
});
export type ProfessionalCredential = z.infer<typeof professionalCredentialSchema>;

export const createProfessionalCredentialSchema = z.object({
  userId: uuid,
  jurisdictionId: uuid,
  authorityId: uuid,
  registrationNumber: z.string().min(1).max(80),
  validFrom: isoDate,
  validTo: isoDate.optional(),
});
export type CreateProfessionalCredential = z.infer<typeof createProfessionalCredentialSchema>;

// --- Períodos y obligaciones ---

export const taxPeriodSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  taxTypeId: uuid,
  startDate: isoDate,
  endDate: isoDate,
  label: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxPeriod = z.infer<typeof taxPeriodSchema>;

export const createTaxPeriodSchema = z.object({
  taxTypeId: uuid,
  startDate: isoDate,
  endDate: isoDate,
  label: z.string().max(120).optional(),
});
export type CreateTaxPeriod = z.infer<typeof createTaxPeriodSchema>;

export const taxObligationSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  profileVersionId: uuid,
  regimeId: uuid,
  periodId: uuid,
  status: taxObligationStatus,
  dueDate: isoDate.nullable(),
  materializedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxObligation = z.infer<typeof taxObligationSchema>;

export const createTaxObligationSchema = z.object({
  profileVersionId: uuid,
  regimeId: uuid,
  periodId: uuid,
  dueDate: isoDate.optional(),
});
export type CreateTaxObligation = z.infer<typeof createTaxObligationSchema>;

// --- Reglas fiscales ---

export const taxRulePackSchema = z.object({
  id: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  regimeId: uuid,
  status: taxRulePackStatus,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxRulePack = z.infer<typeof taxRulePackSchema>;

export const createTaxRulePackSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  regimeId: uuid,
});
export type CreateTaxRulePack = z.infer<typeof createTaxRulePackSchema>;

export const taxRuleVersionSchema = z.object({
  id: uuid,
  packId: uuid,
  version: z.number().int().positive(),
  status: taxRulePackStatus,
  validFrom: isoDate,
  validTo: isoDate.nullable(),
  rulesHash: z.string().min(1).max(128),
  engineVersion: z.string().min(1).max(80),
  approvedByUserId: uuid.nullable(),
  approvedAt: z.string().datetime().nullable(),
  activatedAt: z.string().datetime().nullable(),
  supersedesId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxRuleVersion = z.infer<typeof taxRuleVersionSchema>;

export const createTaxRuleVersionSchema = z.object({
  validFrom: isoDate,
  validTo: isoDate.optional(),
  engineVersion: z.string().min(1).max(80),
  rulesHash: z.string().min(1).max(128),
});
export type CreateTaxRuleVersion = z.infer<typeof createTaxRuleVersionSchema>;

export const taxRateRuleSchema = z.object({
  id: uuid,
  ruleVersionId: uuid,
  concept: z.string().min(1).max(80),
  activityCode: z.string().max(40).nullable(),
  jurisdictionId: uuid.nullable(),
  rate: decimalRate,
  minAmount: money.nullable(),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
});
export type TaxRateRule = z.infer<typeof taxRateRuleSchema>;

export const createTaxRateRuleSchema = z.object({
  concept: z.string().min(1).max(80),
  rate: decimalRate,
  activityCode: z.string().max(40).optional(),
  jurisdictionId: uuid.optional(),
  minAmount: money.optional(),
  validFrom: isoDate,
  validTo: isoDate.optional(),
});
export type CreateTaxRateRule = z.infer<typeof createTaxRateRuleSchema>;

export const dueDateRuleSchema = z.object({
  id: uuid,
  ruleVersionId: uuid,
  jurisdictionId: uuid,
  frequency: z.string().default("MONTHLY"),
  dueDay: z.number().int().min(1).max(31),
  monthOffset: z.number().int().min(0).max(24).default(1),
  cuitEnding: z.string().max(4).nullable(),
  validFrom: isoDate,
  validTo: isoDate.nullable(),
});
export type DueDateRule = z.infer<typeof dueDateRuleSchema>;

export const createDueDateRuleSchema = z.object({
  jurisdictionId: uuid,
  frequency: z.string().max(40).optional(),
  dueDay: z.number().int().min(1).max(31),
  monthOffset: z.number().int().min(0).max(24).optional(),
  cuitEnding: z.string().max(4).optional(),
  validFrom: isoDate,
  validTo: isoDate.optional(),
});
export type CreateDueDateRule = z.infer<typeof createDueDateRuleSchema>;

export const normativeSourceSchema = z.object({
  id: uuid,
  ruleVersionId: uuid,
  authorityId: uuid,
  title: z.string().min(1).max(300),
  url: z.string().url().nullable(),
  reference: z.string().max(120).nullable(),
  fileChecksum: z.string().max(128).nullable(),
  consultedAt: isoDate,
});
export type NormativeSource = z.infer<typeof normativeSourceSchema>;

export const createNormativeSourceSchema = z.object({
  authorityId: uuid,
  title: z.string().min(1).max(300),
  url: z.string().url().optional(),
  reference: z.string().max(120).optional(),
  fileChecksum: z.string().max(128).optional(),
  consultedAt: isoDate,
});
export type CreateNormativeSource = z.infer<typeof createNormativeSourceSchema>;

export const ruleApprovalSchema = z.object({
  id: uuid,
  ruleVersionId: uuid,
  credentialId: uuid,
  approvedByUserId: uuid,
  comment: z.string().nullable(),
  goldenResultsHash: z.string().nullable(),
  approvedAt: z.string().datetime(),
});
export type RuleApproval = z.infer<typeof ruleApprovalSchema>;

export const approveRuleVersionSchema = z.object({
  credentialId: uuid,
  comment: z.string().max(500).optional(),
  goldenResultsHash: z.string().max(128).optional(),
});
export type ApproveRuleVersion = z.infer<typeof approveRuleVersionSchema>;

// --- Liquidaciones (contratos base para Puerta 3) ---

export const taxSettlementSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  taxTypeId: uuid,
  regimeId: uuid,
  jurisdictionId: uuid,
  periodId: uuid,
  cutoff: isoDate,
  version: z.number().int().positive(),
  engineVersion: z.string(),
  ruleVersionId: uuid.nullable(),
  rulesHash: z.string(),
  inputHash: z.string(),
  outputHash: z.string(),
  status: taxSettlementStatus,
  totals: z.record(z.string(), money).nullable(),
  preparedByUserId: uuid,
  reviewedByUserId: uuid.nullable(),
  reviewedAt: z.string().datetime().nullable(),
  finalizedAt: z.string().datetime().nullable(),
  supersedesId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaxSettlement = z.infer<typeof taxSettlementSchema>;

// --- Cumplimiento (base para Puerta 3) ---

export const taxFilingSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  obligationId: uuid,
  filedAt: isoDate,
  externalId: z.string().max(120).nullable(),
  amountFiled: money,
  status: taxFilingStatus,
  evidenceDocumentId: uuid.nullable(),
  createdAt: z.string().datetime(),
});
export type TaxFiling = z.infer<typeof taxFilingSchema>;

export const taxPaymentSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  obligationId: uuid,
  paidAt: isoDate,
  amount: money,
  method: z.string().max(40),
  status: taxPaymentStatus,
  reference: z.string().max(120).nullable(),
  createdAt: z.string().datetime(),
});
export type TaxPayment = z.infer<typeof taxPaymentSchema>;

// --- Importación (base para Puerta 2) ---

export const importBatchSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  origin: z.string().max(80),
  taxTypeId: uuid,
  periodId: uuid,
  adapterVersion: z.string().max(80),
  status: importBatchStatus,
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  errorRows: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ImportBatch = z.infer<typeof importBatchSchema>;

export const createImportBatchSchema = z.object({
  origin: z.string().min(1).max(80),
  taxTypeId: uuid,
  periodId: uuid,
  adapterVersion: z.string().min(1).max(80),
  fileName: z.string().max(240).optional(),
  fileHash: z.string().max(128).optional(),
  workpaperId: uuid.optional(),
  sourceCode: z.string().min(1).max(80).optional(),
}).refine((value) => Boolean(value.workpaperId) === Boolean(value.sourceCode), {
  message: "El expediente y el código de fuente deben informarse juntos",
});
export type CreateImportBatch = z.infer<typeof createImportBatchSchema>;

export const importRowSchema = z.object({
  id: uuid,
  batchId: uuid,
  raw: z.record(z.string(), z.unknown()),
  normalized: z.record(z.string(), z.unknown()).nullable(),
  status: importRowStatus,
  errors: z.array(z.string()),
  createdAt: z.string().datetime(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

// --- Clasificación dentro del expediente mensual (Fase 2) ---

export const workpaperRateBucketSchema = z.object({
  rate: z.enum(["21", "10.5", "27", "EXENTO", "NO_GRAVADO"]),
  base: money,
  amount: money,
});

export const workpaperVoucherClassificationSchema = z.object({
  id: uuid,
  workpaperId: uuid,
  voucherId: uuid,
  supplierProfileId: uuid.nullable(),
  direction: fiscalVoucherDirection,
  counterpartyCuit: cuit,
  documentKind: z.enum(["INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"]),
  categoryCode: z.enum(["SUPER", "TRANSPORTE"]).nullable(),
  activityCode: z.string().max(40).nullable(),
  rateBuckets: z.array(workpaperRateBucketSchema),
  status: z.enum(["PENDING", "CLASSIFIED"]),
  origin: z.enum(["SUPPLIER_PROFILE", "VOUCHER_LINE", "SINGLE_CLIENT_ACTIVITY", "MANUAL"]).nullable(),
  snapshotHash: z.string().max(128).nullable(),
  classifiedByUserId: uuid.nullable(),
  classifiedAt: z.string().datetime().nullable(),
});
export type WorkpaperVoucherClassification = z.infer<
  typeof workpaperVoucherClassificationSchema
>;

export const classifyWorkpaperVoucherSchema = z
  .object({
    categoryCode: z.enum(["SUPER", "TRANSPORTE"]).optional(),
    activityCode: z.string().trim().min(1).max(40).optional(),
    saveSupplierProfile: z.boolean().optional(),
  })
  .strict();
export type ClassifyWorkpaperVoucher = z.infer<typeof classifyWorkpaperVoucherSchema>;

export const workpaperTaxInputAllocationSchema = z.object({
  id: uuid,
  workpaperId: uuid,
  obligationId: uuid,
  sourceCode: z.string().max(80),
  sourceType: z.enum(["WITHHOLDING", "PERCEPTION"]),
  sourceId: uuid,
  taxTypeId: uuid,
  regimeId: uuid,
  jurisdictionId: uuid,
  periodId: uuid,
  amount: money,
  status: z.literal("ALLOCATED"),
  snapshotHash: z.string().max(128),
  allocatedByUserId: uuid.nullable(),
  allocatedAt: z.string().datetime(),
});
export type WorkpaperTaxInputAllocation = z.infer<
  typeof workpaperTaxInputAllocationSchema
>;

export const workpaperCalculationLineSchema = z.object({
  id: uuid,
  position: z.number().int().positive(),
  concept: z.string().min(1).max(160),
  formula: z.string().nullable(),
  inputs: z.record(z.string(), z.unknown()).nullable(),
  amount: money,
});
export type WorkpaperCalculationLine = z.infer<typeof workpaperCalculationLineSchema>;

export const workpaperCalculationComponentSchema = z.object({
  role: z.string().min(1).max(120),
  required: z.boolean(),
  obligationId: uuid,
  obligation: z.object({
    regimeCode: z.string(),
    regimeName: z.string(),
    taxTypeCode: z.string(),
    taxTypeName: z.string(),
    jurisdictionName: z.string(),
  }),
  settlement: z
    .object({
      id: uuid,
      status: taxSettlementStatus,
      engineVersion: z.string(),
      ruleVersionId: uuid.nullable(),
      rulesHash: z.string(),
      totals: z.record(z.string(), money).nullable(),
      lines: z.array(workpaperCalculationLineSchema),
      differences: z.array(
        z.object({
          id: uuid,
          severity: z.enum(["INFO", "WARNING", "BLOCKING"]),
          status: z.enum(["OPEN", "RESOLVED", "WAIVED"]),
          code: z.string(),
          message: z.string(),
        }),
      ),
      f931Inputs: z.array(
        z.object({ id: uuid, sourceId: z.string(), snapshot: z.record(z.string(), z.unknown()) }),
      ),
    })
    .nullable(),
});
export type WorkpaperCalculationComponent = z.infer<
  typeof workpaperCalculationComponentSchema
>;

export const reallocateWorkpaperTaxInputSchema = z
  .object({ jurisdiction: z.string().trim().min(1).max(40) })
  .strict();
export type ReallocateWorkpaperTaxInput = z.infer<
  typeof reallocateWorkpaperTaxInputSchema
>;

// --- Vouchers fiscales (base para Puerta 2) ---

export const fiscalVoucherSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  direction: fiscalVoucherDirection,
  type: z.string().max(10),
  letter: z.string().max(1),
  pointOfSale: z.number().int().nonnegative(),
  number: z.number().int().nonnegative(),
  issuerCuit: cuit,
  receiverCuit: cuit,
  issuedOn: isoDate,
  currency: z.string().default("ARS"),
  exchangeRate: decimalRate.nullable(),
  total: money,
  status: fiscalVoucherStatus,
  version: z.number().int().positive(),
  hash: z.string(),
  duplicateOfId: uuid.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FiscalVoucher = z.infer<typeof fiscalVoucherSchema>;

export const fiscalComponentSchema = z.object({
  id: uuid,
  voucherId: uuid,
  concept: z.string().max(80),
  base: money,
  rate: decimalRate.nullable(),
  amount: money,
});
export type FiscalComponent = z.infer<typeof fiscalComponentSchema>;

export const createVoucherComponentSchema = z.object({
  concept: z.string().min(1).max(80),
  base: money,
  rate: decimalRate.optional(),
  amount: money,
});
export type CreateVoucherComponent = z.infer<typeof createVoucherComponentSchema>;

export const createFiscalVoucherSchema = z.object({
  direction: fiscalVoucherDirection,
  type: z.string().min(1).max(10),
  letter: z.string().max(1).optional(),
  pointOfSale: z.number().int().nonnegative(),
  number: z.number().int().nonnegative(),
  issuerCuit: cuit,
  receiverCuit: cuit,
  issuedOn: isoDate,
  currency: z.string().length(3).optional(),
  exchangeRate: decimalRate.optional(),
  total: money,
  documentId: uuid.optional(),
  periodId: uuid.optional(),
  components: z.array(createVoucherComponentSchema).min(1).max(50),
});
export type CreateFiscalVoucher = z.infer<typeof createFiscalVoucherSchema>;

// --- Certificados de retención y percepción (G2-03) ---

export const withholdingCertificateSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  direction: z.string().max(20),
  cuitAgent: cuit,
  cuitResponsible: cuit,
  concept: z.string().max(80),
  base: money,
  amount: money,
  rate: decimalRate.nullable(),
  issuedOn: isoDate,
  certificateNumber: z.string().max(80).nullable(),
  status: z.string().max(20),
  createdAt: z.string().datetime(),
});
export type WithholdingCertificate = z.infer<typeof withholdingCertificateSchema>;

export const perceptionCertificateSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  direction: z.string().max(20),
  cuitAgent: cuit,
  cuitResponsible: cuit,
  concept: z.string().max(80),
  base: money,
  amount: money,
  rate: decimalRate.nullable(),
  issuedOn: isoDate,
  certificateNumber: z.string().max(80).nullable(),
  status: z.string().max(20),
  createdAt: z.string().datetime(),
});
export type PerceptionCertificate = z.infer<typeof perceptionCertificateSchema>;

// --- Gastos gerenciales (G2-08) ---

export const managementExpenseSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  description: z.string().min(1).max(300),
  amount: money,
  currency: z.string().default("ARS"),
  incurredOn: isoDate,
  paidOn: isoDate.nullable(),
  taxTreatment: taxTreatment,
  status: managementExpenseStatus,
  hasFiscalSupport: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ManagementExpense = z.infer<typeof managementExpenseSchema>;

export const createManagementExpenseSchema = z.object({
  description: z.string().min(1).max(300),
  amount: money,
  currency: z.string().length(3).optional(),
  incurredOn: isoDate,
  paidOn: isoDate.optional(),
  category: z.string().max(120).optional(),
  hasFiscalSupport: z.boolean(),
});
export type CreateManagementExpense = z.infer<typeof createManagementExpenseSchema>;

export const approveTreatmentSchema = z.object({
  treatment: taxTreatment,
  reason: z.string().min(10).max(1000),
  ruleVersionId: uuid.optional(),
  evidenceDocumentId: uuid.optional(),
  reviewedByUserId: uuid,
});
export type ApproveTreatment = z.infer<typeof approveTreatmentSchema>;

// --- Rentabilidad gerencial (Puerta 5, PLAN §5.7, §7.7) ---

export const profitabilitySnapshotSchema = z.object({
  id: uuid,
  firmId: uuid,
  clientId: uuid,
  periodId: uuid,
  basis: profitabilityBasis,
  version: z.number().int().positive(),
  engineVersion: z.string().min(1).max(80),
  cutoff: isoDate,
  status: profitabilitySnapshotStatus,
  totals: z.record(z.string(), money).nullable(),
  lines: z.array(z.object({
    concept: z.string(),
    formula: z.string(),
    inputs: z.record(z.string(), z.string()),
    result: z.string(),
  })).nullable(),
  inputHash: z.string().min(1).max(128),
  outputHash: z.string().min(1).max(128),
  inputIds: z.array(z.string()).nullable(),
  publishedById: uuid.nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ProfitabilitySnapshot = z.infer<typeof profitabilitySnapshotSchema>;

export const calculateProfitabilitySchema = z.object({
  periodId: uuid,
  basis: profitabilityBasis,
  cutoff: isoDate,
});
export type CalculateProfitability = z.infer<typeof calculateProfitabilitySchema>;

export const publishProfitabilitySchema = z.object({
  periodId: uuid,
  basis: profitabilityBasis,
});
export type PublishProfitability = z.infer<typeof publishProfitabilitySchema>;
