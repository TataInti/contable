-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'VALIDATED', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'ERROR', 'DUPLICATE', 'COMMITTED');

-- CreateEnum
CREATE TYPE "FiscalVoucherDirection" AS ENUM ('PURCHASE', 'SALE');

-- CreateEnum
CREATE TYPE "FiscalVoucherStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('MANAGEMENT_ONLY', 'FISCAL_COMPUTABLE', 'FISCAL_NON_COMPUTABLE', 'PENDING_PROFESSIONAL_DECISION');

-- CreateEnum
CREATE TYPE "ManagementExpenseStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TaxSettlementStatus" AS ENUM ('DRAFT', 'CALCULATED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'REVIEWED', 'FINALIZED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TaxDifferenceSeverity" AS ENUM ('INFO', 'WARNING', 'BLOCKING');

-- CreateEnum
CREATE TYPE "TaxDifferenceStatus" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

-- DropForeignKey
ALTER TABLE "accounting_periods" DROP CONSTRAINT "accounting_periods_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "assistant_conversations" DROP CONSTRAINT "assistant_conversations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "assistant_evidence" DROP CONSTRAINT "assistant_evidence_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "assistant_feedback" DROP CONSTRAINT "assistant_feedback_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "assistant_turns" DROP CONSTRAINT "assistant_turns_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "assistant_usage" DROP CONSTRAINT "assistant_usage_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bank_matches" DROP CONSTRAINT "bank_matches_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bank_movements" DROP CONSTRAINT "bank_movements_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bank_reconciliations" DROP CONSTRAINT "bank_reconciliations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bank_statements" DROP CONSTRAINT "bank_statements_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bi_dashboards" DROP CONSTRAINT "bi_dashboards_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bi_dimensions" DROP CONSTRAINT "bi_dimensions_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bi_metrics" DROP CONSTRAINT "bi_metrics_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bi_snapshots" DROP CONSTRAINT "bi_snapshots_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "bi_widgets" DROP CONSTRAINT "bi_widgets_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "client_activities" DROP CONSTRAINT "client_activities_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "client_assignments" DROP CONSTRAINT "client_assignments_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "client_profiles" DROP CONSTRAINT "client_profiles_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "close_cycles" DROP CONSTRAINT "close_cycles_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "close_work_items" DROP CONSTRAINT "close_work_items_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "cost_centers" DROP CONSTRAINT "cost_centers_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "counterparties" DROP CONSTRAINT "counterparties_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "document_extractions" DROP CONSTRAINT "document_extractions_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "document_file_versions" DROP CONSTRAINT "document_file_versions_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "document_processing_jobs" DROP CONSTRAINT "document_processing_jobs_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "document_request_items" DROP CONSTRAINT "document_request_items_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "document_requests" DROP CONSTRAINT "document_requests_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "exchange_difference_runs" DROP CONSTRAINT "exchange_difference_runs_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "exchange_rate_sources" DROP CONSTRAINT "exchange_rate_sources_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "exchange_rates" DROP CONSTRAINT "exchange_rates_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "extracted_fields" DROP CONSTRAINT "extracted_fields_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "extracted_line_items" DROP CONSTRAINT "extracted_line_items_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "fiscal_years" DROP CONSTRAINT "fiscal_years_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "idempotency_records" DROP CONSTRAINT "idempotency_records_clientId_fkey";

-- DropForeignKey
ALTER TABLE "idempotency_records" DROP CONSTRAINT "idempotency_records_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "idempotency_records" DROP CONSTRAINT "idempotency_records_userId_fkey";

-- DropForeignKey
ALTER TABLE "inflation_indexes" DROP CONSTRAINT "inflation_indexes_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "inflation_observations" DROP CONSTRAINT "inflation_observations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "inflation_runs" DROP CONSTRAINT "inflation_runs_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "obligation_instances" DROP CONSTRAINT "obligation_instances_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "obligation_reminders" DROP CONSTRAINT "obligation_reminders_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "obligations" DROP CONSTRAINT "obligations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "onboarding_checklists" DROP CONSTRAINT "onboarding_checklists_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_clientId_fkey";

-- DropForeignKey
ALTER TABLE "outbox_events" DROP CONSTRAINT "outbox_events_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "portal_invitations" DROP CONSTRAINT "portal_invitations_clientId_fkey";

-- DropForeignKey
ALTER TABLE "portal_invitations" DROP CONSTRAINT "portal_invitations_firmId_fkey";

-- DropForeignKey
ALTER TABLE "portal_invitations" DROP CONSTRAINT "portal_invitations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "portal_memberships" DROP CONSTRAINT "portal_memberships_clientId_fkey";

-- DropForeignKey
ALTER TABLE "portal_memberships" DROP CONSTRAINT "portal_memberships_firmId_fkey";

-- DropForeignKey
ALTER TABLE "portal_memberships" DROP CONSTRAINT "portal_memberships_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "portal_memberships" DROP CONSTRAINT "portal_memberships_userId_fkey";

-- DropForeignKey
ALTER TABLE "reminder_dispatches" DROP CONSTRAINT "reminder_dispatches_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "report_publications" DROP CONSTRAINT "report_publications_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "report_runs" DROP CONSTRAINT "report_runs_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "report_template_lines" DROP CONSTRAINT "report_template_lines_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "report_templates" DROP CONSTRAINT "report_templates_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "request_messages" DROP CONSTRAINT "request_messages_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "request_threads" DROP CONSTRAINT "request_threads_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_obligations" DROP CONSTRAINT "tax_obligations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_periods" DROP CONSTRAINT "tax_periods_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "tax_registrations" DROP CONSTRAINT "tax_registrations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "taxpayer_profile_versions" DROP CONSTRAINT "taxpayer_profile_versions_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "upload_sessions" DROP CONSTRAINT "upload_sessions_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "vat_liquidations" DROP CONSTRAINT "vat_liquidations_tenant_client_fk";

-- DropForeignKey
ALTER TABLE "vat_rules" DROP CONSTRAINT "vat_rules_tenant_client_fk";

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "fileHash" TEXT,
    "fileName" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "voucherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_vouchers" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "direction" "FiscalVoucherDirection" NOT NULL,
    "type" TEXT NOT NULL,
    "letter" TEXT,
    "pointOfSale" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "issuerCuit" TEXT NOT NULL,
    "receiverCuit" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "accountingOn" TIMESTAMP(3),
    "serviceOn" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "exchangeRate" DECIMAL(20,8),
    "exchangeRateSource" TEXT,
    "total" DECIMAL(20,4) NOT NULL,
    "status" "FiscalVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "hash" TEXT,
    "duplicateOfId" TEXT,
    "documentId" TEXT,
    "periodId" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_voucher_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT,
    "activityCode" TEXT,
    "quantity" DECIMAL(20,8),
    "unitPrice" DECIMAL(20,8),
    "netAmount" DECIMAL(20,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_components" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "base" DECIMAL(20,4) NOT NULL,
    "rate" DECIMAL(10,6),
    "amount" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fiscal_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withholding_certificates" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'SUFFERED',
    "cuitAgent" TEXT NOT NULL,
    "cuitResponsible" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "base" DECIMAL(20,4) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "rate" DECIMAL(10,6),
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "certificateNumber" TEXT,
    "sourceDocumentId" TEXT,
    "taxPeriodId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withholding_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perception_certificates" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'SUFFERED',
    "cuitAgent" TEXT NOT NULL,
    "cuitResponsible" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "base" DECIMAL(20,4) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "rate" DECIMAL(10,6),
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "certificateNumber" TEXT,
    "sourceDocumentId" TEXT,
    "taxPeriodId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perception_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_expenses" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "incurredOn" TIMESTAMP(3) NOT NULL,
    "paidOn" TIMESTAMP(3),
    "taxTreatment" "TaxTreatment" NOT NULL DEFAULT 'MANAGEMENT_ONLY',
    "status" "ManagementExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "hasFiscalSupport" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_evidence" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "documentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_treatment_decisions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "ruleVersionId" TEXT,
    "treatment" "TaxTreatment" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceDocumentId" TEXT,
    "decidedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_treatment_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_adjustments" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodId" TEXT,
    "voucherId" TEXT,
    "ruleVersionId" TEXT,
    "concept" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "treatmentDecisionId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_links" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "fiscalVoucherId" TEXT,
    "adjustmentId" TEXT,
    "documentId" TEXT,
    "importRowId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_settlements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "engineVersion" TEXT NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "status" "TaxSettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "totals" JSONB,
    "preparedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "finalizedByUserId" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_inputs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 1,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_settlement_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "concept" TEXT NOT NULL,
    "formula" TEXT,
    "inputs" JSONB,
    "amount" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_differences" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT,
    "severity" "TaxDifferenceSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "TaxDifferenceStatus" NOT NULL DEFAULT 'OPEN',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_differences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_credit_ledger_entries" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "jurisdictionId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "balanceAfter" DECIMAL(20,4) NOT NULL,
    "sourceSettlementId" TEXT,
    "sourcePaymentId" TEXT,
    "evidenceDocumentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_credit_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_credit_allocations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "creditEntryId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_credit_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_export_artifacts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "objectKey" TEXT,
    "checksum" TEXT,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_export_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_filings" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "settlementId" TEXT,
    "filedAt" TIMESTAMP(3) NOT NULL,
    "externalId" TEXT,
    "amountFiled" DECIMAL(20,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FILED',
    "evidenceDocumentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_payments" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "settlementId" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "reference" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_firmId_clientId_periodId_idx" ON "import_batches"("firmId", "clientId", "periodId");

-- CreateIndex
CREATE INDEX "import_batches_firmId_clientId_status_idx" ON "import_batches"("firmId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_batches_firmId_clientId_origin_taxTypeId_periodId_fi_key" ON "import_batches"("firmId", "clientId", "origin", "taxTypeId", "periodId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_voucherId_key" ON "import_rows"("voucherId");

-- CreateIndex
CREATE INDEX "import_rows_firmId_clientId_batchId_idx" ON "import_rows"("firmId", "clientId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_position_key" ON "import_rows"("batchId", "position");

-- CreateIndex
CREATE INDEX "fiscal_vouchers_firmId_clientId_issuedOn_idx" ON "fiscal_vouchers"("firmId", "clientId", "issuedOn");

-- CreateIndex
CREATE INDEX "fiscal_vouchers_firmId_clientId_direction_type_pointOfSale__idx" ON "fiscal_vouchers"("firmId", "clientId", "direction", "type", "pointOfSale", "number");

-- CreateIndex
CREATE INDEX "fiscal_vouchers_clientId_direction_issuerCuit_type_pointOfS_idx" ON "fiscal_vouchers"("clientId", "direction", "issuerCuit", "type", "pointOfSale", "number");

-- CreateIndex
CREATE INDEX "fiscal_voucher_lines_firmId_clientId_voucherId_idx" ON "fiscal_voucher_lines"("firmId", "clientId", "voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_voucher_lines_voucherId_position_key" ON "fiscal_voucher_lines"("voucherId", "position");

-- CreateIndex
CREATE INDEX "fiscal_components_firmId_clientId_voucherId_idx" ON "fiscal_components"("firmId", "clientId", "voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_components_voucherId_concept_key" ON "fiscal_components"("voucherId", "concept");

-- CreateIndex
CREATE INDEX "withholding_certificates_firmId_clientId_issuedOn_idx" ON "withholding_certificates"("firmId", "clientId", "issuedOn");

-- CreateIndex
CREATE INDEX "withholding_certificates_firmId_clientId_cuitAgent_idx" ON "withholding_certificates"("firmId", "clientId", "cuitAgent");

-- CreateIndex
CREATE INDEX "perception_certificates_firmId_clientId_issuedOn_idx" ON "perception_certificates"("firmId", "clientId", "issuedOn");

-- CreateIndex
CREATE INDEX "perception_certificates_firmId_clientId_cuitAgent_idx" ON "perception_certificates"("firmId", "clientId", "cuitAgent");

-- CreateIndex
CREATE INDEX "management_expenses_firmId_clientId_incurredOn_idx" ON "management_expenses"("firmId", "clientId", "incurredOn");

-- CreateIndex
CREATE INDEX "expense_evidence_firmId_clientId_expenseId_idx" ON "expense_evidence"("firmId", "clientId", "expenseId");

-- CreateIndex
CREATE INDEX "tax_treatment_decisions_firmId_clientId_expenseId_idx" ON "tax_treatment_decisions"("firmId", "clientId", "expenseId");

-- CreateIndex
CREATE INDEX "tax_adjustments_firmId_clientId_periodId_idx" ON "tax_adjustments"("firmId", "clientId", "periodId");

-- CreateIndex
CREATE INDEX "evidence_links_firmId_clientId_targetType_targetId_idx" ON "evidence_links"("firmId", "clientId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "tax_settlements_firmId_clientId_status_idx" ON "tax_settlements"("firmId", "clientId", "status");

-- CreateIndex
CREATE INDEX "tax_settlements_firmId_clientId_periodId_idx" ON "tax_settlements"("firmId", "clientId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_settlements_clientId_regimeId_periodId_version_key" ON "tax_settlements"("clientId", "regimeId", "periodId", "version");

-- CreateIndex
CREATE INDEX "settlement_inputs_firmId_clientId_settlementId_idx" ON "settlement_inputs"("firmId", "clientId", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_inputs_settlementId_kind_sourceId_key" ON "settlement_inputs"("settlementId", "kind", "sourceId");

-- CreateIndex
CREATE INDEX "tax_settlement_lines_firmId_clientId_settlementId_idx" ON "tax_settlement_lines"("firmId", "clientId", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_settlement_lines_settlementId_position_key" ON "tax_settlement_lines"("settlementId", "position");

-- CreateIndex
CREATE INDEX "tax_differences_firmId_clientId_settlementId_idx" ON "tax_differences"("firmId", "clientId", "settlementId");

-- CreateIndex
CREATE INDEX "tax_credit_ledger_entries_firmId_clientId_taxTypeId_idx" ON "tax_credit_ledger_entries"("firmId", "clientId", "taxTypeId");

-- CreateIndex
CREATE INDEX "tax_credit_allocations_firmId_clientId_settlementId_idx" ON "tax_credit_allocations"("firmId", "clientId", "settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_credit_allocations_creditEntryId_settlementId_key" ON "tax_credit_allocations"("creditEntryId", "settlementId");

-- CreateIndex
CREATE INDEX "tax_export_artifacts_firmId_clientId_settlementId_idx" ON "tax_export_artifacts"("firmId", "clientId", "settlementId");

-- CreateIndex
CREATE INDEX "tax_filings_firmId_clientId_obligationId_idx" ON "tax_filings"("firmId", "clientId", "obligationId");

-- CreateIndex
CREATE INDEX "tax_payments_firmId_clientId_obligationId_idx" ON "tax_payments"("firmId", "clientId", "obligationId");

-- CreateIndex
CREATE INDEX "payment_allocations_firmId_clientId_obligationId_idx" ON "payment_allocations"("firmId", "clientId", "obligationId");

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_memberships" ADD CONSTRAINT "portal_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "tax_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "fiscal_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_vouchers" ADD CONSTRAINT "fiscal_vouchers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_vouchers" ADD CONSTRAINT "fiscal_vouchers_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_vouchers" ADD CONSTRAINT "fiscal_vouchers_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "tax_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_vouchers" ADD CONSTRAINT "fiscal_vouchers_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "fiscal_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_voucher_lines" ADD CONSTRAINT "fiscal_voucher_lines_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_voucher_lines" ADD CONSTRAINT "fiscal_voucher_lines_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "fiscal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_components" ADD CONSTRAINT "fiscal_components_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_components" ADD CONSTRAINT "fiscal_components_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "fiscal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withholding_certificates" ADD CONSTRAINT "withholding_certificates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perception_certificates" ADD CONSTRAINT "perception_certificates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_expenses" ADD CONSTRAINT "management_expenses_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_evidence" ADD CONSTRAINT "expense_evidence_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_evidence" ADD CONSTRAINT "expense_evidence_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "management_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_evidence" ADD CONSTRAINT "expense_evidence_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_treatment_decisions" ADD CONSTRAINT "tax_treatment_decisions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_treatment_decisions" ADD CONSTRAINT "tax_treatment_decisions_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "management_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_treatment_decisions" ADD CONSTRAINT "tax_treatment_decisions_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_treatment_decisions" ADD CONSTRAINT "tax_treatment_decisions_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "tax_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "fiscal_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_adjustments" ADD CONSTRAINT "tax_adjustments_treatmentDecisionId_fkey" FOREIGN KEY ("treatmentDecisionId") REFERENCES "tax_treatment_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_fiscalVoucherId_fkey" FOREIGN KEY ("fiscalVoucherId") REFERENCES "fiscal_vouchers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "tax_adjustments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_links" ADD CONSTRAINT "evidence_links_importRowId_fkey" FOREIGN KEY ("importRowId") REFERENCES "import_rows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "tax_regimes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "tax_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_finalizedByUserId_fkey" FOREIGN KEY ("finalizedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlements" ADD CONSTRAINT "tax_settlements_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "tax_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_inputs" ADD CONSTRAINT "settlement_inputs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_inputs" ADD CONSTRAINT "settlement_inputs_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlement_lines" ADD CONSTRAINT "tax_settlement_lines_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_settlement_lines" ADD CONSTRAINT "tax_settlement_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_differences" ADD CONSTRAINT "tax_differences_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_differences" ADD CONSTRAINT "tax_differences_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_ledger_entries" ADD CONSTRAINT "tax_credit_ledger_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_ledger_entries" ADD CONSTRAINT "tax_credit_ledger_entries_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_allocations" ADD CONSTRAINT "tax_credit_allocations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_allocations" ADD CONSTRAINT "tax_credit_allocations_creditEntryId_fkey" FOREIGN KEY ("creditEntryId") REFERENCES "tax_credit_ledger_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_allocations" ADD CONSTRAINT "tax_credit_allocations_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_export_artifacts" ADD CONSTRAINT "tax_export_artifacts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_export_artifacts" ADD CONSTRAINT "tax_export_artifacts_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "tax_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filings" ADD CONSTRAINT "tax_filings_evidenceDocumentId_fkey" FOREIGN KEY ("evidenceDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "tax_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_payments" ADD CONSTRAINT "tax_payments_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "tax_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "tax_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- G2: RLS para la ingestión y subledger fiscal (puerta 2)
-- Patrón: app_can_access_tenant("firmId","clientId") + actor != PORTAL
-- ============================================================

DO $$
DECLARE row record; pol record;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name IN (
        'import_batches', 'import_rows', 'fiscal_vouchers', 'fiscal_voucher_lines',
        'fiscal_components', 'withholding_certificates', 'perception_certificates',
        'management_expenses', 'expense_evidence', 'tax_treatment_decisions',
        'tax_adjustments', 'evidence_links', 'tax_settlements', 'settlement_inputs',
        'tax_settlement_lines', 'tax_differences', 'tax_credit_ledger_entries',
        'tax_credit_allocations', 'tax_export_artifacts', 'tax_filings',
        'tax_payments', 'payment_allocations'
      )
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', row.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', row.table_name);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=row.table_name LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, row.table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT USING (app_can_access_tenant("firmId", "clientId"))', row.table_name);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId"))', row.table_name);
    EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId")) WITH CHECK (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId"))', row.table_name);
    EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId"))', row.table_name);
  END LOOP;
END $$;

-- Segunda clave de tenancy sobre cada tabla tenant fiscal (firmId, clientId).
DO $$
DECLARE row record; constraint_name text;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name IN (
        'import_batches', 'import_rows', 'fiscal_vouchers', 'fiscal_voucher_lines',
        'fiscal_components', 'withholding_certificates', 'perception_certificates',
        'management_expenses', 'expense_evidence', 'tax_treatment_decisions',
        'tax_adjustments', 'evidence_links', 'tax_settlements', 'settlement_inputs',
        'tax_settlement_lines', 'tax_differences', 'tax_credit_ledger_entries',
        'tax_credit_allocations', 'tax_export_artifacts', 'tax_filings',
        'tax_payments', 'payment_allocations'
      )
  LOOP
    constraint_name := left(row.table_name || '_tenant_client_fk', 63);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("firmId", "clientId") REFERENCES clients("firmId", id) NOT VALID', row.table_name, constraint_name);
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', row.table_name, constraint_name);
    END IF;
  END LOOP;
END $$;

-- Grants para contable_runtime: CRUD de tablas tenant de ingestión y subledger.
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON
    import_batches, import_rows, fiscal_vouchers, fiscal_voucher_lines,
    fiscal_components, withholding_certificates, perception_certificates,
    management_expenses, expense_evidence, tax_treatment_decisions,
    tax_adjustments, evidence_links, tax_settlements, settlement_inputs,
    tax_settlement_lines, tax_differences, tax_credit_ledger_entries,
    tax_credit_allocations, tax_export_artifacts, tax_filings,
    tax_payments, payment_allocations
  TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
