-- ============================================================
-- G5: ProfitabilitySnapshot (rentabilidad gerencial, PLAN §5.7)
-- Tabla tenant con RLS forzado + FK compuesta (firmId, clientId).
-- ============================================================


-- CreateEnum
CREATE TYPE "ProfitabilityBasis" AS ENUM ('DEVENGADO', 'CAJA');

-- CreateEnum
CREATE TYPE "ProfitabilitySnapshotStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "profitability_snapshots" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "basis" "ProfitabilityBasis" NOT NULL DEFAULT 'DEVENGADO',
    "version" INTEGER NOT NULL DEFAULT 1,
    "engineVersion" TEXT NOT NULL,
    "cutoff" TIMESTAMP(3) NOT NULL,
    "status" "ProfitabilitySnapshotStatus" NOT NULL DEFAULT 'DRAFT',
    "totals" JSONB,
    "lines" JSONB,
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT NOT NULL,
    "inputIds" JSONB,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profitability_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profitability_snapshots_firmId_clientId_status_idx" ON "profitability_snapshots"("firmId", "clientId", "status");

-- CreateIndex
CREATE INDEX "profitability_snapshots_firmId_clientId_periodId_idx" ON "profitability_snapshots"("firmId", "clientId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "profitability_snapshots_clientId_periodId_basis_version_key" ON "profitability_snapshots"("clientId", "periodId", "basis", "version");

-- AddForeignKey
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "tax_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RLS: patrón app_can_access_tenant + actor != PORTAL (el portal lee
-- sólo PUBLISHED a través de la API, nunca inserta).
ALTER TABLE "profitability_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profitability_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "profitability_snapshots";
DROP POLICY IF EXISTS tenant_insert ON "profitability_snapshots";
DROP POLICY IF EXISTS tenant_update ON "profitability_snapshots";
DROP POLICY IF EXISTS tenant_delete ON "profitability_snapshots";
CREATE POLICY tenant_select ON "profitability_snapshots" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "profitability_snapshots" FOR INSERT WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "profitability_snapshots" FOR UPDATE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId")) WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "profitability_snapshots" FOR DELETE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));

-- FK compuesta de tenancy (firmId, clientId) → clients.
ALTER TABLE "profitability_snapshots" ADD CONSTRAINT "profitability_snapshots_tenant_client_fk" FOREIGN KEY ("firmId", "clientId") REFERENCES clients("firmId", id) NOT VALID;
ALTER TABLE "profitability_snapshots" VALIDATE CONSTRAINT "profitability_snapshots_tenant_client_fk";

-- Grants para contable_runtime: CRUD.
GRANT SELECT, INSERT, UPDATE, DELETE ON profitability_snapshots TO contable_runtime;

-- Los triggers de inmutabilidad de liquidaciones NO aplican aquí: la
-- versión publicada es inmutable por contrato de servicio (G5-05),
-- y publicar una nueva versión crea SUPERSEDED sin reescribir la anterior.
