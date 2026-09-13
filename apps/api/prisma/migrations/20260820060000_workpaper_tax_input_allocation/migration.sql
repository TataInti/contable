-- Fase 3: cada retención/percepción usada por el expediente queda imputada
-- a una obligación y jurisdicción concretas. Se conserva compatibilidad con
-- filas legacy dejando las nuevas referencias anulables.

DROP INDEX IF EXISTS "tax_input_allocations_sourceType_sourceId_taxTypeId_regimeId_jurisdictionId_periodId_key";

ALTER TABLE "tax_input_allocations"
  ADD COLUMN "workpaperId" TEXT,
  ADD COLUMN "obligationId" TEXT,
  ADD COLUMN "sourceCode" TEXT,
  ADD COLUMN "allocatedByUserId" TEXT,
  ADD COLUMN "allocatedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX "tax_input_allocations_workpaperId_sourceType_sourceId_obligationId_jurisdictionId_key"
  ON "tax_input_allocations"("workpaperId", "sourceType", "sourceId", "obligationId", "jurisdictionId");

CREATE INDEX "tax_input_allocations_firmId_clientId_workpaperId_obligationId_status_idx"
  ON "tax_input_allocations"("firmId", "clientId", "workpaperId", "obligationId", "status");

ALTER TABLE "tax_input_allocations"
  ADD CONSTRAINT "tax_input_allocations_workpaperId_fkey"
  FOREIGN KEY ("workpaperId") REFERENCES "monthly_tax_workpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tax_input_allocations"
  ADD CONSTRAINT "tax_input_allocations_obligationId_fkey"
  FOREIGN KEY ("obligationId") REFERENCES "tax_obligations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
