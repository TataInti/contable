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

