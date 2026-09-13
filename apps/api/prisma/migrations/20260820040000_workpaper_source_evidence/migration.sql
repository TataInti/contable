-- Fase 1: trazabilidad de evidencia importada dentro del expediente mensual.
-- Un lote puede respaldar más de una revisión del expediente sin duplicar
-- hechos fiscales; la revisión del vínculo conserva su propio snapshot.

ALTER TABLE "import_rows"
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT;

CREATE INDEX "import_rows_sourceType_sourceId_idx"
  ON "import_rows"("sourceType", "sourceId");

CREATE UNIQUE INDEX "f931_runs_importBatchId_key"
  ON "f931_runs"("importBatchId");

CREATE TABLE "workpaper_import_batches" (
  "id" TEXT NOT NULL,
  "firmId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "workpaperId" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "sourceCode" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "snapshotHash" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workpaper_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workpaper_import_batches_workpaperId_importBatchId_key"
  ON "workpaper_import_batches"("workpaperId", "importBatchId");

CREATE INDEX "workpaper_import_batches_firmId_clientId_workpaperId_sour_idx"
  ON "workpaper_import_batches"("firmId", "clientId", "workpaperId", "sourceCode");

ALTER TABLE "workpaper_import_batches"
  ADD CONSTRAINT "workpaper_import_batches_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_import_batches"
  ADD CONSTRAINT "workpaper_import_batches_workpaperId_fkey"
  FOREIGN KEY ("workpaperId") REFERENCES "monthly_tax_workpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_import_batches"
  ADD CONSTRAINT "workpaper_import_batches_importBatchId_fkey"
  FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workpaper_import_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON "workpaper_import_batches"
  FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "workpaper_import_batches"
  FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "workpaper_import_batches"
  FOR UPDATE USING (app_can_access_tenant("firmId", "clientId"))
  WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "workpaper_import_batches"
  FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON workpaper_import_batches TO contable_runtime;
