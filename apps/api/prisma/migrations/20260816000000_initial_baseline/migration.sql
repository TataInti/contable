-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "FirmStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FirmRole" AS ENUM ('OWNER', 'ADMIN', 'PREPARER', 'REVIEWER', 'AUDITOR_READONLY');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('OPEN', 'CLOSING', 'CLOSED');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'HARD_CLOSED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'MEMO');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'REVIEWED', 'POSTED', 'REVERSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JournalEntrySourceType" AS ENUM ('MANUAL', 'DOCUMENT', 'BANK', 'OPENING', 'EXCHANGE', 'INFLATION', 'TAX', 'CLOSING', 'IMPORT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecretEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "rotationCounter" INTEGER NOT NULL DEFAULT 0,
    "userAgentHash" TEXT,
    "ipPrefix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firms" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "taxId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires',
    "status" "FirmStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_memberships" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FirmRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "firm_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "cuit" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'ONBOARDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_assignments" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,

    CONSTRAINT "client_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "chartVersionId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "normalBalance" "NormalBalance" NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "path" TEXT NOT NULL,
    "isPostable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "sequenceNumber" INTEGER,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "sourceType" "JournalEntrySourceType" NOT NULL DEFAULT 'MANUAL',
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "postedByUserId" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "reversedByEntryId" TEXT,
    "rowVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "description" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'ARS',
    "debitOriginal" DECIMAL(20,4) NOT NULL,
    "creditOriginal" DECIMAL(20,4) NOT NULL,
    "exchangeRate" DECIMAL(20,8),
    "debitFunctional" DECIMAL(20,4) NOT NULL,
    "creditFunctional" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "firmId" TEXT,
    "clientId" TEXT,
    "userId" TEXT,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "requestId" TEXT,
    "idempotencyKey" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_emailNormalized_key" ON "users"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "device_sessions_refreshTokenHash_key" ON "device_sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "device_sessions_userId_idx" ON "device_sessions"("userId");

-- CreateIndex
CREATE INDEX "device_sessions_familyId_idx" ON "device_sessions"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "firm_memberships_firmId_userId_key" ON "firm_memberships"("firmId", "userId");

-- CreateIndex
CREATE INDEX "clients_firmId_idx" ON "clients"("firmId");

-- CreateIndex
CREATE UNIQUE INDEX "clients_firmId_cuit_key" ON "clients"("firmId", "cuit");

-- CreateIndex
CREATE INDEX "client_assignments_firmId_clientId_idx" ON "client_assignments"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "client_assignments_firmId_userId_clientId_key" ON "client_assignments"("firmId", "userId", "clientId");

-- CreateIndex
CREATE INDEX "fiscal_years_firmId_clientId_idx" ON "fiscal_years"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_clientId_startDate_endDate_key" ON "fiscal_years"("clientId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "accounting_periods_firmId_clientId_idx" ON "accounting_periods"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_clientId_startDate_endDate_key" ON "accounting_periods"("clientId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "accounts_firmId_clientId_idx" ON "accounts"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_clientId_chartVersionId_code_key" ON "accounts"("clientId", "chartVersionId", "code");

-- CreateIndex
CREATE INDEX "journal_entries_firmId_clientId_entryDate_idx" ON "journal_entries"("firmId", "clientId", "entryDate");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_clientId_fiscalYearId_sequenceNumber_key" ON "journal_entries"("clientId", "fiscalYearId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "journal_lines_firmId_clientId_accountId_idx" ON "journal_lines"("firmId", "clientId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_entryId_position_key" ON "journal_lines"("entryId", "position");

-- CreateIndex
CREATE INDEX "audit_events_firmId_createdAt_idx" ON "audit_events"("firmId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_userId_createdAt_idx" ON "audit_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- AddForeignKey
ALTER TABLE "device_sessions" ADD CONSTRAINT "device_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_memberships" ADD CONSTRAINT "firm_memberships_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_memberships" ADD CONSTRAINT "firm_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_assignments" ADD CONSTRAINT "client_assignments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_periods" ADD CONSTRAINT "accounting_periods_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_postedByUserId_fkey" FOREIGN KEY ("postedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ChartTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "currencyBehavior" TEXT NOT NULL DEFAULT 'FUNCTIONAL_ONLY',
ADD COLUMN     "monetaryClassification" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "vatRole" TEXT NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "client_profiles" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "functionalCurrency" TEXT NOT NULL DEFAULT 'ARS',
    "accountingStandard" TEXT,
    "fiscalYearEndMonth" INTEGER NOT NULL DEFAULT 12,
    "vatCondition" TEXT,
    "iibbJurisdictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "province" TEXT,
    "activity" TEXT,
    "legalForm" TEXT,
    "serviceStartDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_templates" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ChartTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counterparties" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "taxCondition" TEXT,
    "address" TEXT,
    "country" TEXT NOT NULL DEFAULT 'AR',
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counterparties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_checklists" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "client_profiles_clientId_key" ON "client_profiles"("clientId");

-- CreateIndex
CREATE INDEX "client_profiles_firmId_idx" ON "client_profiles"("firmId");

-- CreateIndex
CREATE INDEX "chart_templates_firmId_idx" ON "chart_templates"("firmId");

-- CreateIndex
CREATE INDEX "counterparties_firmId_clientId_idx" ON "counterparties"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "counterparties_clientId_cuit_key" ON "counterparties"("clientId", "cuit");

-- CreateIndex
CREATE INDEX "cost_centers_firmId_clientId_idx" ON "cost_centers"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_clientId_code_key" ON "cost_centers"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_checklists_clientId_key" ON "onboarding_checklists"("clientId");

-- CreateIndex
CREATE INDEX "onboarding_checklists_firmId_idx" ON "onboarding_checklists"("firmId");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_chartVersionId_fkey" FOREIGN KEY ("chartVersionId") REFERENCES "chart_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counterparties" ADD CONSTRAINT "counterparties_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADED', 'VALIDATING', 'READY', 'APPLIED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELED');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('PENDING', 'COMPLETED', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "category" TEXT,
    "direction" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "currentFileVersionId" TEXT,
    "currentExtractionId" TEXT,
    "uploadedByUserId" TEXT,
    "uploadOrigin" TEXT NOT NULL DEFAULT 'FIRM',
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_file_versions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pages" INTEGER,
    "sha256" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "objectVersion" TEXT,
    "antivirusStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "isOriginal" BOOLEAN NOT NULL DEFAULT true,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_processing_jobs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileVersionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'VALIDATE',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "deduplicationKey" TEXT,
    "traceId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'PENDING',
    "expectedMime" TEXT,
    "maxSizeBytes" INTEGER NOT NULL,
    "maxFiles" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_firmId_clientId_status_idx" ON "documents"("firmId", "clientId", "status");

-- CreateIndex
CREATE INDEX "documents_firmId_clientId_createdAt_idx" ON "documents"("firmId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "document_file_versions_firmId_clientId_idx" ON "document_file_versions"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "document_file_versions_sha256_idx" ON "document_file_versions"("sha256");

-- CreateIndex
CREATE INDEX "document_processing_jobs_firmId_clientId_status_idx" ON "document_processing_jobs"("firmId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_processing_jobs_deduplicationKey_key" ON "document_processing_jobs"("deduplicationKey");

-- CreateIndex
CREATE INDEX "upload_sessions_firmId_clientId_idx" ON "upload_sessions"("firmId", "clientId");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_file_versions" ADD CONSTRAINT "document_file_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_processing_jobs" ADD CONSTRAINT "document_processing_jobs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('GENERATED', 'NEEDS_REVIEW', 'REVIEWED', 'SUPERSEDED', 'FAILED');

-- CreateTable
CREATE TABLE "document_extractions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fileVersionId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'GENERATED',
    "classification" TEXT,
    "confidence" DOUBLE PRECISION,
    "ocrEngine" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "promptVersion" TEXT,
    "normalizedText" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_fields" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "rawValue" TEXT,
    "normalizedValue" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "page" INTEGER,
    "boundingBox" JSONB,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "correction" TEXT,
    "reason" TEXT,

    CONSTRAINT "extracted_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_line_items" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "extractionId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" TEXT,
    "unitPrice" TEXT,
    "netAmount" TEXT,
    "vatRate" TEXT,
    "vatAmount" TEXT,
    "totalAmount" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "page" INTEGER,
    "boundingBox" JSONB,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',

    CONSTRAINT "extracted_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_extractions_firmId_clientId_documentId_idx" ON "document_extractions"("firmId", "clientId", "documentId");

-- CreateIndex
CREATE INDEX "extracted_fields_firmId_clientId_extractionId_idx" ON "extracted_fields"("firmId", "clientId", "extractionId");

-- CreateIndex
CREATE INDEX "extracted_line_items_firmId_clientId_extractionId_idx" ON "extracted_line_items"("firmId", "clientId", "extractionId");

-- AddForeignKey
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_fields" ADD CONSTRAINT "extracted_fields_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "document_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_line_items" ADD CONSTRAINT "extracted_line_items_extractionId_fkey" FOREIGN KEY ("extractionId") REFERENCES "document_extractions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentStatus" ADD VALUE 'EXTRACTED';
ALTER TYPE "DocumentStatus" ADD VALUE 'EXTRACTION_FAILED';

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "cbu" TEXT,
    "alias" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'ARS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(20,4) NOT NULL,
    "closingBalance" DECIMAL(20,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'ARS',
    "sourceType" TEXT NOT NULL DEFAULT 'CSV',
    "sourceFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IMPORTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_movements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "statementId" TEXT,
    "externalId" TEXT,
    "dedupeHash" TEXT NOT NULL,
    "valueDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'ARS',
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNMATCHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_matches" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "movementId" TEXT NOT NULL,
    "entryId" TEXT,
    "appliedAmount" DECIMAL(20,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CANDIDATE',
    "confidence" DOUBLE PRECISION,
    "matchedByUserId" TEXT,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(20,4) NOT NULL,
    "closingBalance" DECIMAL(20,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "snapshot" JSONB,
    "reopenedFromId" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rate_sources" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'ARS',
    "quoteCurrency" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rate_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_difference_runs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "rateSourceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "worksheet" JSONB,
    "draftEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_difference_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inflation_indexes" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseDate" TIMESTAMP(3) NOT NULL,
    "baseValue" DECIMAL(20,8) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inflation_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inflation_observations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "indexId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(20,8) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inflation_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inflation_runs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "indexId" TEXT NOT NULL,
    "indexVersion" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "ledgerCutoff" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "worksheet" JSONB,
    "draftEntryId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inflation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_accounts_firmId_clientId_idx" ON "bank_accounts"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_clientId_accountId_key" ON "bank_accounts"("clientId", "accountId");

-- CreateIndex
CREATE INDEX "bank_statements_firmId_clientId_bankAccountId_idx" ON "bank_statements"("firmId", "clientId", "bankAccountId");

-- CreateIndex
CREATE INDEX "bank_movements_firmId_clientId_bankAccountId_idx" ON "bank_movements"("firmId", "clientId", "bankAccountId");

-- CreateIndex
CREATE INDEX "bank_movements_dedupeHash_idx" ON "bank_movements"("dedupeHash");

-- CreateIndex
CREATE UNIQUE INDEX "bank_movements_bankAccountId_externalId_key" ON "bank_movements"("bankAccountId", "externalId");

-- CreateIndex
CREATE INDEX "bank_matches_firmId_clientId_movementId_idx" ON "bank_matches"("firmId", "clientId", "movementId");

-- CreateIndex
CREATE INDEX "bank_reconciliations_firmId_clientId_bankAccountId_idx" ON "bank_reconciliations"("firmId", "clientId", "bankAccountId");

-- CreateIndex
CREATE INDEX "exchange_rate_sources_firmId_clientId_idx" ON "exchange_rate_sources"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "exchange_rates_firmId_clientId_idx" ON "exchange_rates"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_sourceId_date_key" ON "exchange_rates"("sourceId", "date");

-- CreateIndex
CREATE INDEX "exchange_difference_runs_firmId_clientId_idx" ON "exchange_difference_runs"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "inflation_indexes_firmId_clientId_idx" ON "inflation_indexes"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "inflation_indexes_clientId_code_key" ON "inflation_indexes"("clientId", "code");

-- CreateIndex
CREATE INDEX "inflation_observations_firmId_clientId_idx" ON "inflation_observations"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "inflation_observations_indexId_date_key" ON "inflation_observations"("indexId", "date");

-- CreateIndex
CREATE INDEX "inflation_runs_firmId_clientId_idx" ON "inflation_runs"("firmId", "clientId");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "bank_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "bank_movements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_matches" ADD CONSTRAINT "bank_matches_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rate_sources" ADD CONSTRAINT "exchange_rate_sources_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "exchange_rate_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_difference_runs" ADD CONSTRAINT "exchange_difference_runs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_difference_runs" ADD CONSTRAINT "exchange_difference_runs_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_difference_runs" ADD CONSTRAINT "exchange_difference_runs_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_difference_runs" ADD CONSTRAINT "exchange_difference_runs_rateSourceId_fkey" FOREIGN KEY ("rateSourceId") REFERENCES "exchange_rate_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_difference_runs" ADD CONSTRAINT "exchange_difference_runs_draftEntryId_fkey" FOREIGN KEY ("draftEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inflation_indexes" ADD CONSTRAINT "inflation_indexes_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inflation_observations" ADD CONSTRAINT "inflation_observations_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "inflation_indexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inflation_runs" ADD CONSTRAINT "inflation_runs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inflation_runs" ADD CONSTRAINT "inflation_runs_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inflation_runs" ADD CONSTRAINT "inflation_runs_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inflation_runs" ADD CONSTRAINT "inflation_runs_indexId_fkey" FOREIGN KEY ("indexId") REFERENCES "inflation_indexes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inflation_runs" ADD CONSTRAINT "inflation_runs_draftEntryId_fkey" FOREIGN KEY ("draftEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON bank_accounts, bank_statements, bank_movements, bank_matches, bank_reconciliations, exchange_rate_sources, exchange_rates, exchange_difference_runs, inflation_indexes, inflation_observations, inflation_runs TO contable_runtime;

-- CreateTable
CREATE TABLE "vat_rules" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_liquidations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "rulesVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "totals" JSONB,
    "differences" JSONB,
    "preparedByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vat_liquidations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "dueDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_instances" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "materializedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligation_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "obligation_reminders" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "instanceId" TEXT,
    "rule" TEXT NOT NULL DEFAULT 'DUE_DATE',
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "obligation_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_dispatches" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "close_cycles" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "close_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "close_work_items" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assigneeUserId" TEXT,
    "completedByUserId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "close_work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requests" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dueDate" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_request_items" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_threads" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "request_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_messages" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_VatLiquidationToVatRule" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_VatLiquidationToVatRule_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "vat_rules_firmId_clientId_idx" ON "vat_rules"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "vat_rules_clientId_code_version_key" ON "vat_rules"("clientId", "code", "version");

-- CreateIndex
CREATE INDEX "vat_liquidations_firmId_clientId_periodId_idx" ON "vat_liquidations"("firmId", "clientId", "periodId");

-- CreateIndex
CREATE INDEX "obligations_firmId_clientId_idx" ON "obligations"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "obligations_clientId_code_version_key" ON "obligations"("clientId", "code", "version");

-- CreateIndex
CREATE INDEX "obligation_instances_firmId_clientId_dueDate_idx" ON "obligation_instances"("firmId", "clientId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "obligation_instances_obligationId_periodLabel_key" ON "obligation_instances"("obligationId", "periodLabel");

-- CreateIndex
CREATE INDEX "obligation_reminders_firmId_clientId_idx" ON "obligation_reminders"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "reminder_dispatches_firmId_clientId_idx" ON "reminder_dispatches"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_dispatches_reminderId_instanceId_key" ON "reminder_dispatches"("reminderId", "instanceId");

-- CreateIndex
CREATE INDEX "close_cycles_firmId_clientId_idx" ON "close_cycles"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "close_work_items_firmId_clientId_cycleId_idx" ON "close_work_items"("firmId", "clientId", "cycleId");

-- CreateIndex
CREATE INDEX "document_requests_firmId_clientId_idx" ON "document_requests"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "document_request_items_firmId_clientId_requestId_idx" ON "document_request_items"("firmId", "clientId", "requestId");

-- CreateIndex
CREATE INDEX "request_threads_firmId_clientId_requestId_idx" ON "request_threads"("firmId", "clientId", "requestId");

-- CreateIndex
CREATE INDEX "request_messages_firmId_clientId_threadId_idx" ON "request_messages"("firmId", "clientId", "threadId");

-- CreateIndex
CREATE INDEX "_VatLiquidationToVatRule_B_index" ON "_VatLiquidationToVatRule"("B");

-- AddForeignKey
ALTER TABLE "vat_rules" ADD CONSTRAINT "vat_rules_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vat_liquidations" ADD CONSTRAINT "vat_liquidations_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_instances" ADD CONSTRAINT "obligation_instances_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_instances" ADD CONSTRAINT "obligation_instances_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_reminders" ADD CONSTRAINT "obligation_reminders_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_reminders" ADD CONSTRAINT "obligation_reminders_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "obligation_reminders" ADD CONSTRAINT "obligation_reminders_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "obligation_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_dispatches" ADD CONSTRAINT "reminder_dispatches_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "obligation_reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_dispatches" ADD CONSTRAINT "reminder_dispatches_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "obligation_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_cycles" ADD CONSTRAINT "close_cycles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_cycles" ADD CONSTRAINT "close_cycles_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_cycles" ADD CONSTRAINT "close_cycles_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_work_items" ADD CONSTRAINT "close_work_items_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "close_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_work_items" ADD CONSTRAINT "close_work_items_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "close_work_items" ADD CONSTRAINT "close_work_items_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_request_items" ADD CONSTRAINT "document_request_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_threads" ADD CONSTRAINT "request_threads_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_threads" ADD CONSTRAINT "request_threads_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "request_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_messages" ADD CONSTRAINT "request_messages_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VatLiquidationToVatRule" ADD CONSTRAINT "_VatLiquidationToVatRule_A_fkey" FOREIGN KEY ("A") REFERENCES "vat_liquidations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_VatLiquidationToVatRule" ADD CONSTRAINT "_VatLiquidationToVatRule_B_fkey" FOREIGN KEY ("B") REFERENCES "vat_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON vat_rules, vat_liquidations, obligations, obligation_instances, obligation_reminders, reminder_dispatches, close_cycles, close_work_items, document_requests, document_request_items, request_threads, request_messages TO contable_runtime;
-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BALANCE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_template_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT,
    "templateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "formulaAst" JSONB,
    "formulaText" TEXT,
    "isTotal" BOOLEAN NOT NULL DEFAULT false,
    "indent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "resultHash" TEXT,
    "result" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,
    "supersedesId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_publications" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_templates_firmId_clientId_idx" ON "report_templates"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "report_templates_firmId_clientId_code_version_key" ON "report_templates"("firmId", "clientId", "code", "version");

-- CreateIndex
CREATE INDEX "report_template_lines_firmId_clientId_idx" ON "report_template_lines"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "report_template_lines_templateId_position_key" ON "report_template_lines"("templateId", "position");

-- CreateIndex
CREATE INDEX "report_runs_firmId_clientId_templateId_idx" ON "report_runs"("firmId", "clientId", "templateId");

-- CreateIndex
CREATE INDEX "report_publications_firmId_clientId_idx" ON "report_publications"("firmId", "clientId");

-- AddForeignKey
ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_template_lines" ADD CONSTRAINT "report_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "report_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "report_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_publications" ADD CONSTRAINT "report_publications_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_publications" ADD CONSTRAINT "report_publications_runId_fkey" FOREIGN KEY ("runId") REFERENCES "report_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_publications" ADD CONSTRAINT "report_publications_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_publications" ADD CONSTRAINT "report_publications_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON report_templates, report_template_lines, report_runs, report_publications TO contable_runtime;
-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodId" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_turns" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "abstained" BOOLEAN NOT NULL DEFAULT false,
    "abstentionReason" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_evidence" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ACCOUNT',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "label" TEXT,
    "value" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_feedback" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "rating" INTEGER,
    "comment" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_usage" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "conversationId" TEXT,
    "turnId" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_conversations_firmId_clientId_idx" ON "assistant_conversations"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "assistant_turns_firmId_clientId_conversationId_idx" ON "assistant_turns"("firmId", "clientId", "conversationId");

-- CreateIndex
CREATE INDEX "assistant_evidence_firmId_clientId_turnId_idx" ON "assistant_evidence"("firmId", "clientId", "turnId");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_feedback_turnId_key" ON "assistant_feedback"("turnId");

-- CreateIndex
CREATE INDEX "assistant_feedback_firmId_clientId_idx" ON "assistant_feedback"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "assistant_usage_firmId_clientId_idx" ON "assistant_usage"("firmId", "clientId");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_evidence" ADD CONSTRAINT "assistant_evidence_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "assistant_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "assistant_turns"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON assistant_conversations, assistant_turns, assistant_evidence, assistant_feedback, assistant_usage TO contable_runtime;
-- CreateTable
CREATE TABLE "bi_metrics" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dimensions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_dashboards" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_widgets" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "plan" JSONB,
    "cutoff" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "result" JSONB,
    "resultHash" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bi_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bi_snapshots" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "resultHash" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bi_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bi_metrics_firmId_clientId_idx" ON "bi_metrics"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "bi_metrics_clientId_code_version_key" ON "bi_metrics"("clientId", "code", "version");

-- CreateIndex
CREATE INDEX "bi_dimensions_firmId_clientId_idx" ON "bi_dimensions"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "bi_dimensions_clientId_code_key" ON "bi_dimensions"("clientId", "code");

-- CreateIndex
CREATE INDEX "bi_dashboards_firmId_clientId_idx" ON "bi_dashboards"("firmId", "clientId");

-- CreateIndex
CREATE INDEX "bi_widgets_firmId_clientId_dashboardId_idx" ON "bi_widgets"("firmId", "clientId", "dashboardId");

-- CreateIndex
CREATE INDEX "bi_snapshots_firmId_clientId_dashboardId_idx" ON "bi_snapshots"("firmId", "clientId", "dashboardId");

-- AddForeignKey
ALTER TABLE "bi_metrics" ADD CONSTRAINT "bi_metrics_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_dimensions" ADD CONSTRAINT "bi_dimensions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_dashboards" ADD CONSTRAINT "bi_dashboards_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_dashboards" ADD CONSTRAINT "bi_dashboards_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "bi_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_widgets" ADD CONSTRAINT "bi_widgets_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "bi_metrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_snapshots" ADD CONSTRAINT "bi_snapshots_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bi_snapshots" ADD CONSTRAINT "bi_snapshots_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "bi_dashboards"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON bi_metrics, bi_dimensions, bi_dashboards, bi_widgets, bi_snapshots TO contable_runtime;
-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feature_flags_firmId_clientId_idx" ON "feature_flags"("firmId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_firmId_clientId_code_key" ON "feature_flags"("firmId", "clientId", "code");

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Permisos para el rol runtime (ADR-006)
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO contable_runtime;
-- Security/integration recovery: explicit portal identity, durable outbox,
-- idempotency, comprehensive RLS, composite tenant keys and ledger guards.

ALTER TABLE "device_sessions" ADD COLUMN IF NOT EXISTS "previousRefreshTokenHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "device_sessions_previousRefreshTokenHash_key"
  ON "device_sessions"("previousRefreshTokenHash");

DO $$ BEGIN
  CREATE TYPE "PortalRole" AS ENUM ('OWNER', 'COLLABORATOR', 'READONLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portal_memberships" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "PortalRole" NOT NULL DEFAULT 'OWNER',
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "invitedBy" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_memberships_firmId_clientId_userId_key" UNIQUE ("firmId", "clientId", "userId")
);
CREATE INDEX IF NOT EXISTS "portal_memberships_userId_status_idx" ON "portal_memberships"("userId", "status");

CREATE TABLE IF NOT EXISTS "portal_invitations" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "emailNormalized" TEXT NOT NULL,
  "role" "PortalRole" NOT NULL DEFAULT 'OWNER',
  "tokenHash" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "invitedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "portal_invitations_firmId_clientId_emailNormalized_idx"
  ON "portal_invitations"("firmId", "clientId", "emailNormalized");

CREATE TABLE IF NOT EXISTS "idempotency_records" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id"),
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "idempotency_records_firmId_scope_key_key" UNIQUE ("firmId", "scope", "key")
);
CREATE INDEX IF NOT EXISTS "idempotency_records_firmId_clientId_createdAt_idx"
  ON "idempotency_records"("firmId", "clientId", "createdAt");

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "topic" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "outbox_events_firmId_clientId_createdAt_idx" ON "outbox_events"("firmId", "clientId", "createdAt");

-- Session lookup is deliberately narrow and SECURITY DEFINER so the runtime role
-- can authenticate before an app.user_id RLS context exists.
CREATE OR REPLACE FUNCTION app_resolve_session(target_hash text)
RETURNS TABLE("userId" text, "isPlatformAdmin" boolean, "userStatus" text, "expiresAt" timestamp, "revokedAt" timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ds."userId", u."isPlatformAdmin", u."status"::text, ds."expiresAt", ds."revokedAt"
  FROM device_sessions ds
  JOIN users u ON u.id = ds."userId"
  WHERE ds."refreshTokenHash" = target_hash
  LIMIT 1
$$;
CREATE OR REPLACE FUNCTION app_find_login_user(target_email text)
RETURNS TABLE(id text, "emailNormalized" text, "passwordHash" text, status text,
  "mfaEnabled" boolean, "mfaSecretEncrypted" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u."emailNormalized", u."passwordHash", u.status::text,
    u."mfaEnabled", u."mfaSecretEncrypted"
  FROM users u WHERE u."emailNormalized"=target_email LIMIT 1
$$;
CREATE OR REPLACE FUNCTION app_find_mfa_user(target_id text)
RETURNS TABLE(id text, status text, "mfaSecretEncrypted" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.status::text, u."mfaSecretEncrypted" FROM users u WHERE u.id=target_id LIMIT 1
$$;
CREATE OR REPLACE FUNCTION app_internal_contexts(target_user_id text)
RETURNS TABLE("firmId" text, "firmName" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f."displayName", fm.role::text
  FROM firm_memberships fm JOIN firms f ON f.id=fm."firmId"
  WHERE fm."userId"=target_user_id AND fm.status='ACTIVE' AND f.status='ACTIVE'
  ORDER BY fm."acceptedAt" NULLS LAST, f."displayName"
$$;
CREATE OR REPLACE FUNCTION app_portal_contexts(target_user_id text)
RETURNS TABLE("firmId" text, "firmName" text, "clientId" text, "clientName" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f."displayName", c.id, c."legalName", pm.role::text
  FROM portal_memberships pm
  JOIN firms f ON f.id=pm."firmId" JOIN clients c ON c.id=pm."clientId" AND c."firmId"=pm."firmId"
  WHERE pm."userId"=target_user_id AND pm.status='ACTIVE' AND pm."revokedAt" IS NULL
  ORDER BY f."displayName", c."legalName"
$$;
CREATE OR REPLACE FUNCTION app_resolve_portal_membership(target_user_id text, target_client_id text)
RETURNS TABLE("firmId" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pm."firmId", pm.role::text FROM portal_memberships pm
  WHERE pm."userId"=target_user_id AND pm."clientId"=target_client_id
    AND pm.status='ACTIVE' AND pm."revokedAt" IS NULL LIMIT 1
$$;
REVOKE ALL ON FUNCTION app_resolve_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_find_login_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_find_mfa_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_internal_contexts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_portal_contexts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_portal_membership(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_resolve_session(text), app_find_login_user(text),
    app_find_mfa_user(text), app_internal_contexts(text), app_portal_contexts(text),
    app_resolve_portal_membership(text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION app_create_session(
  target_id text, target_user_id text, target_hash text, target_family_id text, target_expires_at timestamp
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO device_sessions (id, "userId", "refreshTokenHash", "familyId", "rotationCounter", "expiresAt")
  VALUES (target_id, target_user_id, target_hash, target_family_id, 0, target_expires_at);
  RETURN target_id;
END $$;

CREATE OR REPLACE FUNCTION app_rotate_session(target_old_hash text, target_new_hash text, target_expires_at timestamp)
RETURNS TABLE("sessionId" text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_session device_sessions%ROWTYPE;
BEGIN
  SELECT * INTO target_session FROM device_sessions WHERE "previousRefreshTokenHash"=target_old_hash FOR UPDATE;
  IF FOUND THEN
    UPDATE device_sessions SET "revokedAt"=CURRENT_TIMESTAMP WHERE "familyId"=target_session."familyId";
    RETURN QUERY SELECT target_session.id, 'REPLAY'::text;
    RETURN;
  END IF;
  SELECT * INTO target_session FROM device_sessions
    WHERE "refreshTokenHash"=target_old_hash AND "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE device_sessions SET
    "previousRefreshTokenHash"=target_old_hash,
    "refreshTokenHash"=target_new_hash,
    "rotationCounter"="rotationCounter"+1,
    "lastUsedAt"=CURRENT_TIMESTAMP,
    "expiresAt"=target_expires_at
  WHERE id=target_session.id;
  RETURN QUERY SELECT target_session.id, 'ROTATED'::text;
END $$;

CREATE OR REPLACE FUNCTION app_revoke_session_by_token(target_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE device_sessions SET "revokedAt"=CURRENT_TIMESTAMP
  WHERE "refreshTokenHash"=target_hash OR "previousRefreshTokenHash"=target_hash
$$;

CREATE OR REPLACE FUNCTION app_revoke_session_by_id(target_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE device_sessions SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=target_id
$$;

CREATE OR REPLACE FUNCTION app_claim_outbox(target_limit integer DEFAULT 25)
RETURNS TABLE(id text, topic text, "eventType" text, "aggregateId" text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT o.id FROM outbox_events o
    WHERE o.status IN ('PENDING','FAILED') AND o."availableAt"<=CURRENT_TIMESTAMP AND o.attempts<10
    ORDER BY o."createdAt" FOR UPDATE SKIP LOCKED LIMIT target_limit
  ), updated AS (
    UPDATE outbox_events o SET status='PROCESSING', "lockedAt"=CURRENT_TIMESTAMP, attempts=o.attempts+1
    FROM claimed c WHERE o.id=c.id
    RETURNING o.id, o.topic, o."eventType", o."aggregateId", o.payload
  ) SELECT * FROM updated;
END $$;
CREATE OR REPLACE FUNCTION app_complete_outbox(target_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_events SET status='PUBLISHED', "publishedAt"=CURRENT_TIMESTAMP, "lockedAt"=NULL, "lastError"=NULL
  WHERE id=target_id
$$;
CREATE OR REPLACE FUNCTION app_fail_outbox(target_id text, target_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_events SET status='FAILED', "lockedAt"=NULL, "lastError"=left(target_error,1000),
    "availableAt"=CURRENT_TIMESTAMP + make_interval(secs => LEAST(300, power(2, attempts)::integer))
  WHERE id=target_id
$$;

REVOKE ALL ON FUNCTION app_create_session(text,text,text,text,timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rotate_session(text,text,timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_revoke_session_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_revoke_session_by_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_claim_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_complete_outbox(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_fail_outbox(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_create_session(text,text,text,text,timestamp),
    app_rotate_session(text,text,timestamp), app_revoke_session_by_token(text),
    app_revoke_session_by_id(text), app_claim_outbox(integer), app_complete_outbox(text),
    app_fail_outbox(text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION app_is_firm_member(target_firm_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId"=target_firm_id AND fm."userId"=target_user_id AND fm.status='ACTIVE'
  )
$$;

CREATE OR REPLACE FUNCTION app_is_internal_client_member(target_firm_id text, target_client_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id AND fm.status = 'ACTIVE'
      AND (
        fm.role IN ('OWNER', 'ADMIN') OR EXISTS (
          SELECT 1 FROM client_assignments ca
          WHERE ca."firmId" = target_firm_id AND ca."clientId" = target_client_id AND ca."userId" = target_user_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_is_portal_client_member(target_firm_id text, target_client_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM portal_memberships pm
    WHERE pm."firmId" = target_firm_id AND pm."clientId" = target_client_id
      AND pm."userId" = target_user_id AND pm.status = 'ACTIVE' AND pm."revokedAt" IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION app_can_access_client(target_firm_id text, target_client_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT target_firm_id = current_setting('app.firm_id', true)
    AND (NULLIF(current_setting('app.client_id', true), '') IS NULL
      OR target_client_id = current_setting('app.client_id', true))
    AND (
      (current_user = 'contable_worker' AND current_setting('app.actor_kind', true) = 'SYSTEM')
      OR
      app_is_internal_client_member(target_firm_id, target_client_id, current_setting('app.user_id', true))
      OR app_is_portal_client_member(target_firm_id, target_client_id, current_setting('app.user_id', true))
    )
$$;

CREATE OR REPLACE FUNCTION app_can_access_tenant(target_firm_id text, target_client_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT target_firm_id = current_setting('app.firm_id', true)
    AND (
      (target_client_id IS NULL
        AND current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_is_firm_member(target_firm_id, current_setting('app.user_id', true)))
      OR (target_client_id IS NOT NULL AND app_can_access_client(target_firm_id, target_client_id))
    )
$$;

-- Identity and firm-owned tables are also isolated; auth uses only the narrow
-- SECURITY DEFINER functions declared above.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL
  USING (id=current_setting('app.user_id', true))
  WITH CHECK (id=current_setting('app.user_id', true));

ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE firms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firms_member ON firms;
CREATE POLICY firms_member ON firms FOR SELECT
  USING (app_is_firm_member(id,current_setting('app.user_id', true)));

ALTER TABLE firm_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_memberships_visible ON firm_memberships;
CREATE POLICY firm_memberships_visible ON firm_memberships FOR ALL
  USING ("userId"=current_setting('app.user_id', true) OR app_is_firm_member("firmId",current_setting('app.user_id', true)))
  WITH CHECK (app_is_firm_member("firmId",current_setting('app.user_id', true)));

ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_sessions_self ON device_sessions;
CREATE POLICY device_sessions_self ON device_sessions FOR SELECT
  USING ("userId"=current_setting('app.user_id', true));

ALTER TABLE client_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_assignments_visible ON client_assignments;
CREATE POLICY client_assignments_visible ON client_assignments FOR ALL
  USING ("firmId"=current_setting('app.firm_id', true) AND ("userId"=current_setting('app.user_id', true) OR app_is_firm_member("firmId",current_setting('app.user_id', true))))
  WITH CHECK ("firmId"=current_setting('app.firm_id', true) AND app_is_firm_member("firmId",current_setting('app.user_id', true)));

ALTER TABLE chart_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chart_templates_firm_scope ON chart_templates;
CREATE POLICY chart_templates_firm_scope ON chart_templates FOR ALL
  USING ("firmId"=current_setting('app.firm_id', true) AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member("firmId",current_setting('app.user_id', true)))
  WITH CHECK ("firmId"=current_setting('app.firm_id', true) AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member("firmId",current_setting('app.user_id', true)));

-- A second tenant key on every client-owned table prevents a valid client id
-- being paired with the wrong firm id.
CREATE UNIQUE INDEX IF NOT EXISTS "clients_firmId_id_key" ON "clients"("firmId", "id");
DO $$
DECLARE row record; constraint_name text;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name <> 'clients'
  LOOP
    constraint_name := left(row.table_name || '_tenant_client_fk', 63);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("firmId", "clientId") REFERENCES clients("firmId", id) NOT VALID', row.table_name, constraint_name);
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', row.table_name, constraint_name);
    END IF;
  END LOOP;
END $$;

-- Replace permissive legacy policies on every client-owned table.
DO $$
DECLARE row record; pol record;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name NOT IN ('clients', 'audit_events', 'portal_memberships', 'portal_invitations')
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

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='clients' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON clients', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY clients_select ON clients FOR SELECT USING (app_can_access_client("firmId", id));
CREATE POLICY clients_insert ON clients FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);
CREATE POLICY clients_update ON clients FOR UPDATE USING (
  current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_client("firmId", id)
) WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_client("firmId", id));

-- Portal membership rows are visible only to that user or internal members.
ALTER TABLE portal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_memberships_select ON portal_memberships FOR SELECT USING (
  "userId" = current_setting('app.user_id', true)
  OR app_is_firm_member("firmId", current_setting('app.user_id', true))
);
CREATE POLICY portal_memberships_internal_write ON portal_memberships FOR ALL USING (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
) WITH CHECK (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);

ALTER TABLE portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_invitations_internal ON portal_invitations FOR ALL USING (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
) WITH CHECK (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);

-- El portal sólo puede escribir en los recursos colaborativos imprescindibles.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['upload_sessions','documents','document_file_versions',
    'document_processing_jobs','outbox_events','request_messages']
  LOOP
    EXECUTE format('CREATE POLICY portal_collaboration_write ON %I FOR ALL USING (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true))) WITH CHECK (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true)))', table_name);
  END LOOP;
END $$;

CREATE POLICY audit_events_portal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true)='PORTAL'
  AND app_is_portal_client_member("firmId", "clientId", current_setting('app.user_id', true))
);

-- Append-only audit at SQL privilege and trigger level.
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events are append-only' USING ERRCODE='55000'; END $$;
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
DO $$ BEGIN
  REVOKE UPDATE, DELETE ON audit_events FROM contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Posted entries cannot be edited. Reversal is the only allowed transition.
CREATE OR REPLACE FUNCTION protect_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NOT (OLD.status='POSTED' AND NEW.status='REVERSED'
      AND NEW."reversedByEntryId" IS NOT NULL
      AND NEW."clientId"=OLD."clientId" AND NEW."firmId"=OLD."firmId"
      AND NEW."fiscalYearId"=OLD."fiscalYearId" AND NEW."periodId"=OLD."periodId"
      AND NEW."entryDate"=OLD."entryDate" AND NEW.description=OLD.description
      AND NEW."sequenceNumber"=OLD."sequenceNumber") THEN
      RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_entry();

CREATE OR REPLACE FUNCTION mark_new_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='POSTED' THEN PERFORM set_config('app.new_posted_entry_id',NEW.id,true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_mark_new_posted ON journal_entries;
CREATE TRIGGER journal_entries_mark_new_posted BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION mark_new_posted_journal_entry();

CREATE OR REPLACE FUNCTION protect_posted_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entry text; target_status "JournalEntryStatus";
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  target_entry := COALESCE(NEW."entryId", OLD."entryId");
  SELECT status INTO target_status FROM journal_entries WHERE id=target_entry;
  IF target_status IN ('POSTED', 'REVERSED')
    AND NOT (TG_OP='INSERT' AND current_setting('app.new_posted_entry_id',true)=target_entry) THEN
    RAISE EXCEPTION 'lines of posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
CREATE TRIGGER journal_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_line();

CREATE OR REPLACE FUNCTION assert_posted_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE debit numeric; credit numeric;
BEGIN
  IF NEW.status='POSTED' THEN
    SELECT COALESCE(SUM("debitFunctional"),0), COALESCE(SUM("creditFunctional"),0)
      INTO debit, credit FROM journal_lines WHERE "entryId"=NEW.id;
    IF debit <> credit OR debit = 0 THEN
      RAISE EXCEPTION 'posted journal entry must be balanced and non-zero' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balanced
AFTER INSERT OR UPDATE OF status ON journal_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_posted_journal_balanced();

DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON portal_memberships, portal_invitations,
    idempotency_records, outbox_events TO contable_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO contable_worker;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
-- Follow-up kept separate because security_integration may already be deployed.
CREATE OR REPLACE FUNCTION app_portal_contexts(target_user_id text)
RETURNS TABLE("firmId" text, "firmName" text, "clientId" text, "clientName" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f."displayName", c.id, c."legalName", pm.role::text
  FROM portal_memberships pm
  JOIN firms f ON f.id=pm."firmId" JOIN clients c ON c.id=pm."clientId" AND c."firmId"=pm."firmId"
  WHERE pm."userId"=target_user_id AND pm.status='ACTIVE' AND pm."revokedAt" IS NULL
  ORDER BY f."displayName", c."legalName"
$$;
CREATE OR REPLACE FUNCTION app_resolve_portal_membership(target_user_id text, target_client_id text)
RETURNS TABLE("firmId" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pm."firmId", pm.role::text FROM portal_memberships pm
  WHERE pm."userId"=target_user_id AND pm."clientId"=target_client_id
    AND pm.status='ACTIVE' AND pm."revokedAt" IS NULL LIMIT 1
$$;
REVOKE ALL ON FUNCTION app_portal_contexts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_portal_membership(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_portal_contexts(text), app_resolve_portal_membership(text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['upload_sessions','documents','document_file_versions',
    'document_processing_jobs','outbox_events','request_messages']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS portal_collaboration_write ON %I', table_name);
    EXECUTE format('CREATE POLICY portal_collaboration_write ON %I FOR ALL USING (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true))) WITH CHECK (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true)))', table_name);
  END LOOP;
END $$;
DROP POLICY IF EXISTS audit_events_portal_insert ON audit_events;
CREATE POLICY audit_events_portal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true)='PORTAL'
  AND app_is_portal_client_member("firmId", "clientId", current_setting('app.user_id', true))
);
-- Complete the portal invitation lifecycle and make audit isolation reproducible.

CREATE OR REPLACE FUNCTION app_accept_portal_invitation(
  target_token_hash text,
  target_email text,
  target_name text,
  target_password_hash text
) RETURNS TABLE("userId" text, "firmId" text, "clientId" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  invitation portal_invitations%ROWTYPE;
  target_user users%ROWTYPE;
BEGIN
  SELECT * INTO invitation
  FROM portal_invitations
  WHERE "tokenHash" = target_token_hash
    AND "acceptedAt" IS NULL
    AND "revokedAt" IS NULL
    AND "expiresAt" > CURRENT_TIMESTAMP
  FOR UPDATE;

  IF NOT FOUND OR lower(invitation."emailNormalized") <> lower(target_email) THEN
    RETURN;
  END IF;

  SELECT * INTO target_user FROM users WHERE "emailNormalized" = lower(target_email) FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO users (id, "emailNormalized", name, "passwordHash", status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, lower(target_email), target_name, target_password_hash, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING * INTO target_user;
  ELSIF target_user.status <> 'ACTIVE' THEN
    RETURN;
  END IF;

  INSERT INTO portal_memberships (
    id, "firmId", "clientId", "userId", role, status, "invitedBy", "acceptedAt", "createdAt"
  ) VALUES (
    gen_random_uuid()::text, invitation."firmId", invitation."clientId", target_user.id,
    invitation.role, 'ACTIVE', invitation."invitedByUserId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("firmId", "clientId", "userId") DO UPDATE SET
    role = EXCLUDED.role,
    status = 'ACTIVE',
    "revokedAt" = NULL,
    "acceptedAt" = CURRENT_TIMESTAMP,
    "invitedBy" = EXCLUDED."invitedBy";

  UPDATE portal_invitations SET "acceptedAt" = CURRENT_TIMESTAMP WHERE id = invitation.id;
  RETURN QUERY SELECT target_user.id, invitation."firmId", invitation."clientId";
END $$;

REVOKE ALL ON FUNCTION app_accept_portal_invitation(text,text,text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_accept_portal_invitation(text,text,text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_select ON audit_events;
DROP POLICY IF EXISTS audit_events_internal_insert ON audit_events;
DROP POLICY IF EXISTS audit_events_portal_insert ON audit_events;
CREATE POLICY audit_events_select ON audit_events FOR SELECT USING (
  "firmId" = current_setting('app.firm_id', true)
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);
CREATE POLICY audit_events_internal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true) IN ('USER', 'PLATFORM_ADMIN', 'SYSTEM')
  AND "firmId" = current_setting('app.firm_id', true)
  AND (
    "clientId" IS NULL
    OR NULLIF(current_setting('app.client_id', true), '') IS NULL
    OR "clientId" = current_setting('app.client_id', true)
  )
);
CREATE POLICY audit_events_portal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true)='PORTAL'
  AND app_is_portal_client_member("firmId", "clientId", current_setting('app.user_id', true))
);

DO $$ BEGIN
  GRANT SELECT, INSERT ON audit_events TO contable_runtime;
  REVOKE UPDATE, DELETE ON audit_events FROM contable_runtime, contable_worker;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
-- Narrow SECURITY DEFINER entry points for platform provisioning and internal invitations.

CREATE OR REPLACE FUNCTION app_create_firm_for_owner(
  target_actor_id text,
  target_legal_name text,
  target_display_name text,
  target_tax_id text
) RETURNS TABLE(id text, "legalName" text, "displayName" text, "taxId" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE created firms%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE users.id=target_actor_id AND "isPlatformAdmin"=true AND status='ACTIVE') THEN
    RETURN;
  END IF;
  INSERT INTO firms (id, "legalName", "displayName", "taxId", status, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, target_legal_name, target_display_name, target_tax_id, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING * INTO created;
  INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "acceptedAt")
  VALUES (gen_random_uuid()::text, created.id, target_actor_id, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP);
  RETURN QUERY SELECT created.id, created."legalName", created."displayName", created."taxId";
END $$;

CREATE OR REPLACE FUNCTION app_invite_internal_member(
  target_actor_id text,
  target_firm_id text,
  target_email text,
  target_role "FirmRole"
) RETURNS TABLE(id text, "userId" text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_user_id text;
DECLARE created firm_memberships%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM firm_memberships
    WHERE "firmId"=target_firm_id AND "userId"=target_actor_id AND status='ACTIVE' AND role IN ('OWNER','ADMIN')
  ) THEN RETURN; END IF;
  SELECT users.id INTO target_user_id FROM users WHERE "emailNormalized"=lower(target_email) AND users.status='ACTIVE';
  IF target_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "invitedBy")
  VALUES (gen_random_uuid()::text, target_firm_id, target_user_id, target_role, 'INVITED', target_actor_id)
  ON CONFLICT ("firmId", "userId") DO UPDATE SET role=EXCLUDED.role, status='INVITED', "invitedBy"=target_actor_id, "acceptedAt"=NULL
  RETURNING * INTO created;
  RETURN QUERY SELECT created.id, created."userId", created.status::text;
END $$;

CREATE OR REPLACE FUNCTION app_pending_internal_invitations(target_user_id text)
RETURNS TABLE("firmId" text, "firmName" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f."displayName", fm.role::text
  FROM firm_memberships fm JOIN firms f ON f.id=fm."firmId"
  WHERE fm."userId"=target_user_id AND fm.status='INVITED'
$$;

CREATE OR REPLACE FUNCTION app_accept_internal_invitation(target_user_id text, target_firm_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE firm_memberships SET status='ACTIVE', "acceptedAt"=CURRENT_TIMESTAMP
  WHERE "userId"=target_user_id AND "firmId"=target_firm_id AND status='INVITED';
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION app_create_firm_for_owner(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_invite_internal_member(text,text,text,"FirmRole") FROM PUBLIC;
REVOKE ALL ON FUNCTION app_pending_internal_invitations(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_accept_internal_invitation(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_create_firm_for_owner(text,text,text,text),
    app_invite_internal_member(text,text,text,"FirmRole"),
    app_pending_internal_invitations(text), app_accept_internal_invitation(text,text)
  TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
-- Backfill the identity RLS and nullable client scope for databases that had
-- the earlier security migration applied before these policies were embedded.

CREATE OR REPLACE FUNCTION app_is_firm_member(target_firm_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM firm_memberships fm WHERE fm."firmId"=target_firm_id AND fm."userId"=target_user_id AND fm.status='ACTIVE')
$$;

CREATE OR REPLACE FUNCTION app_can_access_tenant(target_firm_id text, target_client_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT target_firm_id=current_setting('app.firm_id', true) AND (
    (target_client_id IS NULL AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member(target_firm_id,current_setting('app.user_id', true)))
    OR (target_client_id IS NOT NULL AND app_can_access_client(target_firm_id,target_client_id))
  )
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL USING (id=current_setting('app.user_id', true)) WITH CHECK (id=current_setting('app.user_id', true));
ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE firms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firms_member ON firms;
CREATE POLICY firms_member ON firms FOR SELECT USING (app_is_firm_member(id,current_setting('app.user_id', true)));
ALTER TABLE firm_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_memberships_visible ON firm_memberships;
CREATE POLICY firm_memberships_visible ON firm_memberships FOR ALL
  USING ("userId"=current_setting('app.user_id', true) OR app_is_firm_member("firmId",current_setting('app.user_id', true)))
  WITH CHECK (app_is_firm_member("firmId",current_setting('app.user_id', true)));
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_sessions_self ON device_sessions;
CREATE POLICY device_sessions_self ON device_sessions FOR SELECT USING ("userId"=current_setting('app.user_id', true));
ALTER TABLE client_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_assignments_visible ON client_assignments;
CREATE POLICY client_assignments_visible ON client_assignments FOR ALL
  USING ("firmId"=current_setting('app.firm_id', true) AND ("userId"=current_setting('app.user_id', true) OR app_is_firm_member("firmId",current_setting('app.user_id', true))))
  WITH CHECK ("firmId"=current_setting('app.firm_id', true) AND app_is_firm_member("firmId",current_setting('app.user_id', true)));
ALTER TABLE chart_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chart_templates_firm_scope ON chart_templates;
CREATE POLICY chart_templates_firm_scope ON chart_templates FOR ALL
  USING ("firmId"=current_setting('app.firm_id', true) AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member("firmId",current_setting('app.user_id', true)))
  WITH CHECK ("firmId"=current_setting('app.firm_id', true) AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member("firmId",current_setting('app.user_id', true)));

DO $$
DECLARE row record; pol record;
BEGIN
  FOR row IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name NOT IN ('clients','audit_events','portal_memberships','portal_invitations')
  LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=row.table_name AND policyname LIKE 'tenant_%' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I',pol.policyname,row.table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT USING (app_can_access_tenant("firmId","clientId"))',row.table_name);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId"))',row.table_name);
    EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId")) WITH CHECK (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId"))',row.table_name);
    EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId"))',row.table_name);
  END LOOP;
END $$;
-- Owners/admins may see the minimal identity attached to a portal membership.
CREATE OR REPLACE FUNCTION app_is_visible_portal_user(target_user_id text, target_firm_id text, target_actor_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId"=target_firm_id AND fm."userId"=target_actor_id
      AND fm.status='ACTIVE' AND fm.role IN ('OWNER','ADMIN')
  ) AND EXISTS (
    SELECT 1 FROM portal_memberships pm
    WHERE pm."firmId"=target_firm_id AND pm."userId"=target_user_id
  )
$$;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL
  USING (
    id=current_setting('app.user_id', true)
    OR app_is_visible_portal_user(id,current_setting('app.firm_id', true),current_setting('app.user_id', true))
  )
  WITH CHECK (id=current_setting('app.user_id', true));
-- The dedicated migration owner may clean fixtures/perform controlled
-- maintenance. Runtime and worker roles remain unable to mutate posted data.
CREATE OR REPLACE FUNCTION protect_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NOT (OLD.status='POSTED' AND NEW.status='REVERSED'
      AND NEW."reversedByEntryId" IS NOT NULL
      AND NEW."clientId"=OLD."clientId" AND NEW."firmId"=OLD."firmId"
      AND NEW."fiscalYearId"=OLD."fiscalYearId" AND NEW."periodId"=OLD."periodId"
      AND NEW."entryDate"=OLD."entryDate" AND NEW.description=OLD.description
      AND NEW."sequenceNumber"=OLD."sequenceNumber") THEN
      RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_posted_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entry text; target_status "JournalEntryStatus";
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  target_entry := COALESCE(NEW."entryId", OLD."entryId");
  SELECT status INTO target_status FROM journal_entries WHERE id=target_entry;
  IF target_status IN ('POSTED', 'REVERSED')
    AND NOT (TG_OP='INSERT' AND current_setting('app.new_posted_entry_id',true)=target_entry) THEN
    RAISE EXCEPTION 'lines of posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION mark_new_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='POSTED' THEN PERFORM set_config('app.new_posted_entry_id',NEW.id,true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_mark_new_posted ON journal_entries;
CREATE TRIGGER journal_entries_mark_new_posted BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION mark_new_posted_journal_entry();
-- Permit the initial balanced lines of a newly inserted posted entry while
-- keeping every later line mutation blocked.
CREATE OR REPLACE FUNCTION mark_new_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='POSTED' THEN PERFORM set_config('app.new_posted_entry_id',NEW.id,true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_mark_new_posted ON journal_entries;
CREATE TRIGGER journal_entries_mark_new_posted BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION mark_new_posted_journal_entry();

CREATE OR REPLACE FUNCTION protect_posted_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entry text; target_status "JournalEntryStatus";
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  target_entry := COALESCE(NEW."entryId", OLD."entryId");
  SELECT status INTO target_status FROM journal_entries WHERE id=target_entry;
  IF target_status IN ('POSTED', 'REVERSED')
    AND NOT (TG_OP='INSERT' AND current_setting('app.new_posted_entry_id',true)=target_entry) THEN
    RAISE EXCEPTION 'lines of posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
-- The first domain migrations predate the dedicated runtime role. RLS alone is
-- not enough: PostgreSQL evaluates table privileges before row policies. Grant
-- only the operations the HTTP application needs; authentication/session
-- mutations continue through narrow SECURITY DEFINER functions.

DO $$ BEGIN
  GRANT SELECT, UPDATE ON users TO contable_runtime;
  GRANT SELECT ON firms TO contable_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON
    firm_memberships,
    client_assignments,
    clients,
    fiscal_years,
    accounting_periods,
    accounts,
    journal_entries,
    journal_lines,
    chart_templates,
    client_profiles,
    counterparties,
    cost_centers,
    onboarding_checklists,
    documents,
    document_file_versions,
    document_processing_jobs,
    upload_sessions,
    document_extractions,
    extracted_fields,
    extracted_line_items
  TO contable_runtime;

  -- Audit is append-only even when the application role is compromised.
  GRANT SELECT, INSERT ON audit_events TO contable_runtime;
  REVOKE UPDATE, DELETE ON audit_events FROM contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
-- G0-04: unificar enums de pedidos y cierres entre DB, API, contratos y UI.
-- Fuente: PLAN_DESARROLLO_CONTABLE.md §6.8.
-- Convierte columnas status de String a enums tipados preservando datos.

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('DRAFT', 'SENT', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'COMPLETED', 'CANCELLED');
CREATE TYPE "DocumentRequestItemStatus" AS ENUM ('PENDING', 'ATTACHED', 'ACCEPTED', 'REJECTED', 'WAIVED');
CREATE TYPE "CloseCycleStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FINALIZED', 'CANCELLED');
CREATE TYPE "CloseWorkItemStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');

-- close_cycles: IN_PROGRESS se conserva; OPEN/COMPLETE/COMPLETED legacy → COMPLETED
ALTER TABLE "close_cycles"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "close_cycles"
  ALTER COLUMN "status" TYPE "CloseCycleStatus"
  USING (
    CASE "status"
      WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"CloseCycleStatus"
      WHEN 'FINALIZED' THEN 'FINALIZED'::"CloseCycleStatus"
      WHEN 'COMPLETED' THEN 'COMPLETED'::"CloseCycleStatus"
      WHEN 'COMPLETE' THEN 'COMPLETED'::"CloseCycleStatus"
      WHEN 'OPEN' THEN 'COMPLETED'::"CloseCycleStatus"
      WHEN 'CANCELLED' THEN 'CANCELLED'::"CloseCycleStatus"
      WHEN 'CANCELED' THEN 'CANCELLED'::"CloseCycleStatus"
      ELSE 'IN_PROGRESS'::"CloseCycleStatus"
    END
  );
ALTER TABLE "close_cycles"
  ALTER COLUMN "status" SET DEFAULT 'IN_PROGRESS';

-- close_work_items: PENDING/DONE se conservan
ALTER TABLE "close_work_items"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "close_work_items"
  ALTER COLUMN "status" TYPE "CloseWorkItemStatus"
  USING (
    CASE "status"
      WHEN 'PENDING' THEN 'PENDING'::"CloseWorkItemStatus"
      WHEN 'DONE' THEN 'DONE'::"CloseWorkItemStatus"
      WHEN 'COMPLETED' THEN 'DONE'::"CloseWorkItemStatus"
      WHEN 'COMPLETE' THEN 'DONE'::"CloseWorkItemStatus"
      ELSE 'PENDING'::"CloseWorkItemStatus"
    END
  );
ALTER TABLE "close_work_items"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- document_requests: OPEN/COMPLETE/COMPLETED legacy → COMPLETED; SENT se conserva
ALTER TABLE "document_requests"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "document_requests"
  ALTER COLUMN "status" TYPE "DocumentRequestStatus"
  USING (
    CASE "status"
      WHEN 'DRAFT' THEN 'DRAFT'::"DocumentRequestStatus"
      WHEN 'SENT' THEN 'SENT'::"DocumentRequestStatus"
      WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'::"DocumentRequestStatus"
      WHEN 'READY_FOR_REVIEW' THEN 'READY_FOR_REVIEW'::"DocumentRequestStatus"
      WHEN 'COMPLETED' THEN 'COMPLETED'::"DocumentRequestStatus"
      WHEN 'COMPLETE' THEN 'COMPLETED'::"DocumentRequestStatus"
      WHEN 'OPEN' THEN 'IN_PROGRESS'::"DocumentRequestStatus"
      WHEN 'CANCELLED' THEN 'CANCELLED'::"DocumentRequestStatus"
      WHEN 'CANCELED' THEN 'CANCELLED'::"DocumentRequestStatus"
      ELSE 'DRAFT'::"DocumentRequestStatus"
    END
  );
ALTER TABLE "document_requests"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- document_request_items: PENDING/SUBMITTED/ATTACHED/ACCEPTED/REJECTED/WAIVED
ALTER TABLE "document_request_items"
  ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "document_request_items"
  ALTER COLUMN "status" TYPE "DocumentRequestItemStatus"
  USING (
    CASE "status"
      WHEN 'PENDING' THEN 'PENDING'::"DocumentRequestItemStatus"
      WHEN 'ATTACHED' THEN 'ATTACHED'::"DocumentRequestItemStatus"
      WHEN 'ACCEPTED' THEN 'ACCEPTED'::"DocumentRequestItemStatus"
      WHEN 'REJECTED' THEN 'REJECTED'::"DocumentRequestItemStatus"
      WHEN 'WAIVED' THEN 'WAIVED'::"DocumentRequestItemStatus"
      WHEN 'SUBMITTED' THEN 'ATTACHED'::"DocumentRequestItemStatus"
      WHEN 'COMPLETED' THEN 'ACCEPTED'::"DocumentRequestItemStatus"
      WHEN 'COMPLETE' THEN 'ACCEPTED'::"DocumentRequestItemStatus"
      ELSE 'PENDING'::"DocumentRequestItemStatus"
    END
  );
ALTER TABLE "document_request_items"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';-- G0-06: corregir grants de outbox_events y relaciones Prisma implícitas.
-- outbox_events es una tabla del cliente (firmId/clientId). El acceso se hace
-- exclusivamente a través de funciones SECURITY DEFINER (app_claim_outbox,
-- app_complete_outbox, app_fail_outbox) que operan como owner.
--
-- El GRANT directo al runtime (20260813000000) permitía acceso sin restricción
-- de tenant. Se revoca: el runtime no debe operar outbox_events directamente.
-- No se habilita RLS FORCE porque rompería las funciones SECURITY DEFINER
-- (el owner no tiene contexto de tenant y FORCE aplica incluso a superusers).

REVOKE ALL ON outbox_events FROM contable_runtime;-- G0-07: lease, retry, reclaim y dead-letter en el outbox.
-- - Agrega deadLetterAt/deadLetterReason para eventos que agotaron intentos.
-- - app_claim_outbox ahora reclama eventos PROCESSING con lease vencido (reclaim).
-- - app_fail_outbox mueve a DEAD_LETTER tras el máximo de intentos.

ALTER TABLE "outbox_events"
  ADD COLUMN IF NOT EXISTS "deadLetterAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deadLetterReason" TEXT;

-- Reclaim: recupera PROCESSING cuyo lease (lockedAt) venció hace más de 5 minutos.
-- Nota: availableAt/lockedAt se insertan con now() (UTC, timestamp sin zona) vía
-- Prisma. now() devuelve timestamp con zona local (-03). Para comparar correctamente
-- se convierte now() a UTC sin zona con "AT TIME ZONE 'UTC'".
CREATE OR REPLACE FUNCTION app_claim_outbox(target_limit integer DEFAULT 25)
RETURNS TABLE(id text, topic text, "eventType" text, "aggregateId" text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT o.id FROM outbox_events o
    WHERE (
      -- Pendientes o reintentables
      (o.status IN ('PENDING','FAILED') AND o."availableAt"<=(now() AT TIME ZONE 'UTC') AND o.attempts<10)
      -- Reclaim: PROCESSING con lease vencido (worker caído)
      OR (o.status='PROCESSING' AND o."lockedAt" IS NOT NULL AND o."lockedAt" < (now() AT TIME ZONE 'UTC') - interval '5 minutes')
    )
    ORDER BY o."createdAt" FOR UPDATE SKIP LOCKED LIMIT target_limit
  ), updated AS (
    UPDATE outbox_events o SET status='PROCESSING', "lockedAt"=CURRENT_TIMESTAMP, attempts=o.attempts+1
    FROM claimed c WHERE o.id=c.id
    RETURNING o.id, o.topic, o."eventType", o."aggregateId", o.payload
  ) SELECT * FROM updated;
END $$;

-- Dead-letter: tras el máximo de intentos, marca DEAD_LETTER en vez de reintentar.
CREATE OR REPLACE FUNCTION app_fail_outbox(target_id text, target_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_events SET
    status = CASE WHEN attempts >= 10 THEN 'DEAD_LETTER' ELSE 'FAILED' END,
    "lockedAt" = NULL,
    "lastError" = left(target_error,1000),
    "deadLetterAt" = CASE WHEN attempts >= 10 THEN (now() AT TIME ZONE 'UTC') ELSE NULL END,
    "deadLetterReason" = CASE WHEN attempts >= 10 THEN left(target_error,1000) ELSE NULL END,
    "availableAt" = (now() AT TIME ZONE 'UTC') + make_interval(secs => LEAST(300, power(2, attempts)::integer))
  WHERE id=target_id
$$;

REVOKE ALL ON FUNCTION app_claim_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_fail_outbox(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_claim_outbox(integer), app_fail_outbox(text,text) TO contable_runtime;-- CreateEnum
CREATE TYPE "JurisdictionKind" AS ENUM ('NATIONAL', 'PROVINCIAL', 'MUNICIPAL');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('FISICA', 'JURIDICA');

-- CreateEnum
CREATE TYPE "NationalTaxCondition" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTISTA', 'EXENTO', 'NO_RESPONSABLE');

-- CreateEnum
CREATE TYPE "TaxpayerProfileStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "TaxRegistrationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaxObligationStatus" AS ENUM ('PENDING', 'WAITING_INPUTS', 'READY_TO_CALCULATE', 'IN_REVIEW', 'READY_TO_FILE', 'FILED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "TaxRulePackStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ACTIVE', 'RETIRED');
CREATE TABLE "jurisdictions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "JurisdictionKind" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_authorities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_authorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_regimes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorityId" TEXT NOT NULL,

    CONSTRAINT "tax_regimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxpayer_profile_versions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "legalName" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "personType" "PersonType" NOT NULL,
    "nationalCondition" "NationalTaxCondition" NOT NULL,
    "fiscalAddress" TEXT,
    "fiscalYearEndMonth" INTEGER NOT NULL DEFAULT 12,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "status" "TaxpayerProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "source" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxpayer_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_registrations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "status" "TaxRegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "registrationNumber" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "economic_activities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "source" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "economic_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_activities" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_credentials" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "authorityId" TEXT NOT NULL,

    CONSTRAINT "professional_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_periods" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_obligations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "profileVersionId" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "status" "TaxObligationStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3),
    "materializedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rule_packs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regimeId" TEXT NOT NULL,
    "status" "TaxRulePackStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rule_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rule_versions" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "TaxRulePackStatus" NOT NULL DEFAULT 'DRAFT',
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "rulesHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rate_rules" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "activityCode" TEXT,
    "jurisdictionId" TEXT,
    "rate" DECIMAL(10,6) NOT NULL,
    "minAmount" DECIMAL(20,4),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rate_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_minimum_rules" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "jurisdictionId" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "isConditional" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_minimum_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_bracket_rules" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "fromAmount" DECIMAL(20,4) NOT NULL,
    "toAmount" DECIMAL(20,4),
    "rate" DECIMAL(10,6) NOT NULL,
    "fixedAmount" DECIMAL(20,4),
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_bracket_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "due_date_rules" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "dueDay" INTEGER NOT NULL,
    "cuitEnding" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "due_date_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounding_rules" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 2,
    "mode" TEXT NOT NULL DEFAULT 'HALF_UP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rounding_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normative_sources" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "authorityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "reference" TEXT,
    "fileChecksum" TEXT,
    "consultedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "normative_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_approvals" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "comment" TEXT,
    "goldenResultsHash" TEXT,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rule_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jurisdictions_parentId_idx" ON "jurisdictions"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_code_key" ON "jurisdictions"("code");

-- CreateIndex
CREATE INDEX "tax_authorities_jurisdictionId_idx" ON "tax_authorities"("jurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_authorities_code_key" ON "tax_authorities"("code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_types_code_key" ON "tax_types"("code");

-- CreateIndex
CREATE INDEX "tax_regimes_taxTypeId_idx" ON "tax_regimes"("taxTypeId");

-- CreateIndex
CREATE INDEX "tax_regimes_jurisdictionId_idx" ON "tax_regimes"("jurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_regimes_code_key" ON "tax_regimes"("code");

-- CreateIndex
CREATE INDEX "taxpayer_profile_versions_firmId_clientId_status_idx" ON "taxpayer_profile_versions"("firmId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "taxpayer_profile_versions_clientId_version_key" ON "taxpayer_profile_versions"("clientId", "version");

-- CreateIndex
CREATE INDEX "tax_registrations_firmId_clientId_regimeId_idx" ON "tax_registrations"("firmId", "clientId", "regimeId");

-- CreateIndex
CREATE INDEX "tax_registrations_profileVersionId_idx" ON "tax_registrations"("profileVersionId");

-- CreateIndex
CREATE INDEX "economic_activities_jurisdictionId_idx" ON "economic_activities"("jurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX "economic_activities_code_jurisdictionId_key" ON "economic_activities"("code", "jurisdictionId");

-- CreateIndex
CREATE INDEX "client_activities_firmId_clientId_activityId_idx" ON "client_activities"("firmId", "clientId", "activityId");

-- CreateIndex
CREATE INDEX "client_activities_profileVersionId_idx" ON "client_activities"("profileVersionId");

-- CreateIndex
CREATE INDEX "professional_credentials_firmId_userId_idx" ON "professional_credentials"("firmId", "userId");

-- CreateIndex
CREATE INDEX "professional_credentials_jurisdictionId_idx" ON "professional_credentials"("jurisdictionId");

-- CreateIndex
CREATE INDEX "tax_periods_firmId_clientId_taxTypeId_idx" ON "tax_periods"("firmId", "clientId", "taxTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_periods_clientId_taxTypeId_startDate_endDate_key" ON "tax_periods"("clientId", "taxTypeId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "tax_obligations_firmId_clientId_status_idx" ON "tax_obligations"("firmId", "clientId", "status");

-- CreateIndex
CREATE INDEX "tax_obligations_periodId_idx" ON "tax_obligations"("periodId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_obligations_clientId_regimeId_periodId_key" ON "tax_obligations"("clientId", "regimeId", "periodId");

-- CreateIndex
CREATE INDEX "tax_rule_packs_regimeId_idx" ON "tax_rule_packs"("regimeId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rule_packs_code_key" ON "tax_rule_packs"("code");

-- CreateIndex
CREATE INDEX "tax_rule_versions_packId_status_idx" ON "tax_rule_versions"("packId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rule_versions_packId_version_key" ON "tax_rule_versions"("packId", "version");

-- CreateIndex
CREATE INDEX "tax_rate_rules_ruleVersionId_idx" ON "tax_rate_rules"("ruleVersionId");

-- CreateIndex
CREATE INDEX "tax_minimum_rules_ruleVersionId_idx" ON "tax_minimum_rules"("ruleVersionId");

-- CreateIndex
CREATE INDEX "tax_bracket_rules_ruleVersionId_idx" ON "tax_bracket_rules"("ruleVersionId");

-- CreateIndex
CREATE INDEX "due_date_rules_ruleVersionId_idx" ON "due_date_rules"("ruleVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_jurisdictionId_date_key" ON "holidays"("jurisdictionId", "date");

-- CreateIndex
CREATE INDEX "rounding_rules_ruleVersionId_idx" ON "rounding_rules"("ruleVersionId");

-- CreateIndex
CREATE INDEX "normative_sources_ruleVersionId_idx" ON "normative_sources"("ruleVersionId");

-- CreateIndex
CREATE INDEX "rule_approvals_ruleVersionId_idx" ON "rule_approvals"("ruleVersionId");









-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_authorities" ADD CONSTRAINT "tax_authorities_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_regimes" ADD CONSTRAINT "tax_regimes_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_regimes" ADD CONSTRAINT "tax_regimes_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_regimes" ADD CONSTRAINT "tax_regimes_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "tax_authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "taxpayer_profile_versions" ADD CONSTRAINT "taxpayer_profile_versions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "taxpayer_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_registrations" ADD CONSTRAINT "tax_registrations_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "tax_regimes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "economic_activities" ADD CONSTRAINT "economic_activities_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "taxpayer_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_activities" ADD CONSTRAINT "client_activities_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "economic_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_credentials" ADD CONSTRAINT "professional_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_credentials" ADD CONSTRAINT "professional_credentials_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_credentials" ADD CONSTRAINT "professional_credentials_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "tax_authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_periods" ADD CONSTRAINT "tax_periods_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_profileVersionId_fkey" FOREIGN KEY ("profileVersionId") REFERENCES "taxpayer_profile_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "tax_regimes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_obligations" ADD CONSTRAINT "tax_obligations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "tax_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rule_packs" ADD CONSTRAINT "tax_rule_packs_regimeId_fkey" FOREIGN KEY ("regimeId") REFERENCES "tax_regimes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_packId_fkey" FOREIGN KEY ("packId") REFERENCES "tax_rule_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rule_versions" ADD CONSTRAINT "tax_rule_versions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rate_rules" ADD CONSTRAINT "tax_rate_rules_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_minimum_rules" ADD CONSTRAINT "tax_minimum_rules_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_bracket_rules" ADD CONSTRAINT "tax_bracket_rules_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_date_rules" ADD CONSTRAINT "due_date_rules_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "due_date_rules" ADD CONSTRAINT "due_date_rules_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounding_rules" ADD CONSTRAINT "rounding_rules_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normative_sources" ADD CONSTRAINT "normative_sources_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normative_sources" ADD CONSTRAINT "normative_sources_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "tax_authorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_approvals" ADD CONSTRAINT "rule_approvals_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_approvals" ADD CONSTRAINT "rule_approvals_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "professional_credentials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_approvals" ADD CONSTRAINT "rule_approvals_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
