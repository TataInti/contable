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

