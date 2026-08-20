-- ============================================================
-- F1.1: Expediente mensual de liquidación (PLAN §5.6)
--
-- Agrega el agregado MonthlyTaxWorkpaper y sus componentes, el
-- libro de créditos inmutable (TaxCreditLot/Movement) y los
-- subledgers F931/SupplierTaxProfile. Migración incremental:
-- no cambia el comportamiento existente.
-- ============================================================

-- CreateEnum
CREATE TYPE "MonthlyTaxWorkpaperStatus" AS ENUM ('DRAFT', 'COLLECTING_INPUTS', 'READY_TO_CALCULATE', 'CALCULATING', 'CALCULATED', 'IN_REVIEW', 'CHANGES_REQUESTED', 'REVIEWED', 'FINALIZED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "monthly_tax_workpapers" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "MonthlyTaxWorkpaperStatus" NOT NULL DEFAULT 'DRAFT',
    "cutoffAt" TIMESTAMP(3),
    "preparedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "finalizedByUserId" TEXT,
    "supersedesId" TEXT,
    "inputHash" TEXT,
    "outputHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_tax_workpapers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workpaper_settlements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workpaperId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "statusAtLink" TEXT NOT NULL DEFAULT 'LINKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workpaper_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_input_allocations" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "regimeId" TEXT,
    "jurisdictionId" TEXT,
    "periodId" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "snapshotHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_input_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_control_findings" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workpaperId" TEXT,
    "settlementId" TEXT,
    "code" TEXT NOT NULL,
    "severity" "TaxDifferenceSeverity" NOT NULL DEFAULT 'WARNING',
    "expected" DECIMAL(20,4),
    "actual" DECIMAL(20,4),
    "tolerance" DECIMAL(20,4),
    "status" "TaxDifferenceStatus" NOT NULL DEFAULT 'OPEN',
    "evidenceDocumentId" TEXT,
    "resolution" TEXT,
    "resolvedByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_control_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_interest_snapshots" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workpaperId" TEXT,
    "obligationId" TEXT NOT NULL,
    "settlementId" TEXT,
    "baseAmount" DECIMAL(20,4) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "daysLate" INTEGER NOT NULL,
    "monthlyRate" DECIMAL(10,6) NOT NULL,
    "ruleVersionId" TEXT,
    "amount" DECIMAL(20,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CALCULATED',
    "inputHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_interest_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "f931_runs" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "totalRemuneration" DECIMAL(20,4) NOT NULL,
    "deduction" DECIMAL(20,4) NOT NULL,
    "netRemuneration" DECIMAL(20,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "f931_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "f931_lines" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "remuneration" DECIMAL(20,4) NOT NULL,
    "deduction" DECIMAL(20,4) NOT NULL,
    "netRemuneration" DECIMAL(20,4) NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "f931_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_tax_profiles" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cuitNormalized" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "activityCode" TEXT,
    "jurisdictionId" TEXT,
    "evidenceDocumentId" TEXT,
    "createdByUserId" TEXT,
    "reviewedByUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_tax_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_credit_lots" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "jurisdictionId" TEXT,
    "regimeId" TEXT,
    "periodId" TEXT,
    "kind" TEXT NOT NULL,
    "originalAmount" DECIMAL(20,4) NOT NULL,
    "sourceSettlementId" TEXT,
    "sourcePaymentId" TEXT,
    "evidenceDocumentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_credit_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_credit_movements" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "workpaperId" TEXT,
    "settlementId" TEXT,
    "reference" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_credit_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_tax_workpapers_firmId_clientId_status_idx" ON "monthly_tax_workpapers"("firmId", "clientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_tax_workpapers_clientId_periodStart_periodEnd_revis_key" ON "monthly_tax_workpapers"("clientId", "periodStart", "periodEnd", "revision");

-- CreateIndex
CREATE INDEX "workpaper_settlements_firmId_clientId_workpaperId_idx" ON "workpaper_settlements"("firmId", "clientId", "workpaperId");

-- CreateIndex
CREATE UNIQUE INDEX "workpaper_settlements_workpaperId_obligationId_key" ON "workpaper_settlements"("workpaperId", "obligationId");

-- CreateIndex
CREATE INDEX "tax_input_allocations_firmId_clientId_taxTypeId_idx" ON "tax_input_allocations"("firmId", "clientId", "taxTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_input_allocations_sourceType_sourceId_taxTypeId_regimeI_key" ON "tax_input_allocations"("sourceType", "sourceId", "taxTypeId", "regimeId", "jurisdictionId", "periodId");

-- CreateIndex
CREATE INDEX "tax_control_findings_firmId_clientId_workpaperId_idx" ON "tax_control_findings"("firmId", "clientId", "workpaperId");

-- CreateIndex
CREATE INDEX "tax_interest_snapshots_firmId_clientId_obligationId_idx" ON "tax_interest_snapshots"("firmId", "clientId", "obligationId");

-- CreateIndex
CREATE INDEX "f931_runs_firmId_clientId_periodId_idx" ON "f931_runs"("firmId", "clientId", "periodId");

-- CreateIndex
CREATE INDEX "f931_lines_firmId_clientId_runId_idx" ON "f931_lines"("firmId", "clientId", "runId");

-- CreateIndex
CREATE INDEX "supplier_tax_profiles_firmId_clientId_cuitNormalized_idx" ON "supplier_tax_profiles"("firmId", "clientId", "cuitNormalized");

-- CreateIndex
CREATE INDEX "tax_credit_lots_firmId_clientId_taxTypeId_idx" ON "tax_credit_lots"("firmId", "clientId", "taxTypeId");

-- CreateIndex
CREATE INDEX "tax_credit_movements_firmId_clientId_lotId_idx" ON "tax_credit_movements"("firmId", "clientId", "lotId");

-- AddForeignKey
ALTER TABLE "monthly_tax_workpapers" ADD CONSTRAINT "monthly_tax_workpapers_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_tax_workpapers" ADD CONSTRAINT "monthly_tax_workpapers_preparedByUserId_fkey" FOREIGN KEY ("preparedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_tax_workpapers" ADD CONSTRAINT "monthly_tax_workpapers_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_tax_workpapers" ADD CONSTRAINT "monthly_tax_workpapers_finalizedByUserId_fkey" FOREIGN KEY ("finalizedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_tax_workpapers" ADD CONSTRAINT "monthly_tax_workpapers_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "monthly_tax_workpapers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workpaper_settlements" ADD CONSTRAINT "workpaper_settlements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workpaper_settlements" ADD CONSTRAINT "workpaper_settlements_workpaperId_fkey" FOREIGN KEY ("workpaperId") REFERENCES "monthly_tax_workpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workpaper_settlements" ADD CONSTRAINT "workpaper_settlements_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "tax_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workpaper_settlements" ADD CONSTRAINT "workpaper_settlements_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "tax_obligations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_input_allocations" ADD CONSTRAINT "tax_input_allocations_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_control_findings" ADD CONSTRAINT "tax_control_findings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_control_findings" ADD CONSTRAINT "tax_control_findings_workpaperId_fkey" FOREIGN KEY ("workpaperId") REFERENCES "monthly_tax_workpapers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_interest_snapshots" ADD CONSTRAINT "tax_interest_snapshots_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_interest_snapshots" ADD CONSTRAINT "tax_interest_snapshots_workpaperId_fkey" FOREIGN KEY ("workpaperId") REFERENCES "monthly_tax_workpapers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "f931_runs" ADD CONSTRAINT "f931_runs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "f931_lines" ADD CONSTRAINT "f931_lines_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "f931_lines" ADD CONSTRAINT "f931_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "f931_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_tax_profiles" ADD CONSTRAINT "supplier_tax_profiles_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_lots" ADD CONSTRAINT "tax_credit_lots_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_lots" ADD CONSTRAINT "tax_credit_lots_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_movements" ADD CONSTRAINT "tax_credit_movements_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_movements" ADD CONSTRAINT "tax_credit_movements_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "tax_credit_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_credit_movements" ADD CONSTRAINT "tax_credit_movements_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- RLS: patrón app_can_access_tenant + actor != PORTAL.
-- ============================================================
ALTER TABLE "monthly_tax_workpapers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monthly_tax_workpapers" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "monthly_tax_workpapers";
DROP POLICY IF EXISTS tenant_insert ON "monthly_tax_workpapers";
DROP POLICY IF EXISTS tenant_update ON "monthly_tax_workpapers";
DROP POLICY IF EXISTS tenant_delete ON "monthly_tax_workpapers";
CREATE POLICY tenant_select ON "monthly_tax_workpapers" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "monthly_tax_workpapers" FOR INSERT WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "monthly_tax_workpapers" FOR UPDATE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId")) WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "monthly_tax_workpapers" FOR DELETE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "workpaper_settlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workpaper_settlements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "workpaper_settlements";
DROP POLICY IF EXISTS tenant_insert ON "workpaper_settlements";
DROP POLICY IF EXISTS tenant_update ON "workpaper_settlements";
DROP POLICY IF EXISTS tenant_delete ON "workpaper_settlements";
CREATE POLICY tenant_select ON "workpaper_settlements" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "workpaper_settlements" FOR INSERT WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "workpaper_settlements" FOR UPDATE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId")) WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "workpaper_settlements" FOR DELETE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "tax_input_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_input_allocations" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "tax_input_allocations";
DROP POLICY IF EXISTS tenant_insert ON "tax_input_allocations";
DROP POLICY IF EXISTS tenant_update ON "tax_input_allocations";
DROP POLICY IF EXISTS tenant_delete ON "tax_input_allocations";
CREATE POLICY tenant_select ON "tax_input_allocations" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "tax_input_allocations" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "tax_input_allocations" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "tax_input_allocations" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "tax_control_findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_control_findings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "tax_control_findings";
DROP POLICY IF EXISTS tenant_insert ON "tax_control_findings";
DROP POLICY IF EXISTS tenant_update ON "tax_control_findings";
DROP POLICY IF EXISTS tenant_delete ON "tax_control_findings";
CREATE POLICY tenant_select ON "tax_control_findings" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "tax_control_findings" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "tax_control_findings" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "tax_control_findings" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "tax_interest_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_interest_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "tax_interest_snapshots";
DROP POLICY IF EXISTS tenant_insert ON "tax_interest_snapshots";
DROP POLICY IF EXISTS tenant_update ON "tax_interest_snapshots";
DROP POLICY IF EXISTS tenant_delete ON "tax_interest_snapshots";
CREATE POLICY tenant_select ON "tax_interest_snapshots" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "tax_interest_snapshots" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "tax_interest_snapshots" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "tax_interest_snapshots" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "f931_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "f931_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "f931_runs";
DROP POLICY IF EXISTS tenant_insert ON "f931_runs";
DROP POLICY IF EXISTS tenant_update ON "f931_runs";
DROP POLICY IF EXISTS tenant_delete ON "f931_runs";
CREATE POLICY tenant_select ON "f931_runs" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "f931_runs" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "f931_runs" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "f931_runs" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "f931_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "f931_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "f931_lines";
DROP POLICY IF EXISTS tenant_insert ON "f931_lines";
DROP POLICY IF EXISTS tenant_update ON "f931_lines";
DROP POLICY IF EXISTS tenant_delete ON "f931_lines";
CREATE POLICY tenant_select ON "f931_lines" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "f931_lines" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "f931_lines" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "f931_lines" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "supplier_tax_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_tax_profiles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "supplier_tax_profiles";
DROP POLICY IF EXISTS tenant_insert ON "supplier_tax_profiles";
DROP POLICY IF EXISTS tenant_update ON "supplier_tax_profiles";
DROP POLICY IF EXISTS tenant_delete ON "supplier_tax_profiles";
CREATE POLICY tenant_select ON "supplier_tax_profiles" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "supplier_tax_profiles" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "supplier_tax_profiles" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "supplier_tax_profiles" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "tax_credit_lots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_credit_lots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "tax_credit_lots";
DROP POLICY IF EXISTS tenant_insert ON "tax_credit_lots";
DROP POLICY IF EXISTS tenant_update ON "tax_credit_lots";
DROP POLICY IF EXISTS tenant_delete ON "tax_credit_lots";
CREATE POLICY tenant_select ON "tax_credit_lots" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "tax_credit_lots" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "tax_credit_lots" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "tax_credit_lots" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

ALTER TABLE "tax_credit_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_credit_movements" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "tax_credit_movements";
DROP POLICY IF EXISTS tenant_insert ON "tax_credit_movements";
DROP POLICY IF EXISTS tenant_update ON "tax_credit_movements";
DROP POLICY IF EXISTS tenant_delete ON "tax_credit_movements";
CREATE POLICY tenant_select ON "tax_credit_movements" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "tax_credit_movements" FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "tax_credit_movements" FOR UPDATE USING (app_can_access_tenant("firmId", "clientId")) WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "tax_credit_movements" FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

-- Grants para contable_runtime: CRUD.
GRANT SELECT, INSERT, UPDATE, DELETE ON monthly_tax_workpapers TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON workpaper_settlements TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_input_allocations TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_control_findings TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_interest_snapshots TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON f931_runs TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON f931_lines TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON supplier_tax_profiles TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_credit_lots TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_credit_movements TO contable_runtime;