-- Retiro y reemplazo conservan el lote original como historial.
ALTER TABLE "workpaper_import_batches"
  ADD COLUMN "retiredByUserId" TEXT,
  ADD COLUMN "retiredAt" TIMESTAMP(3),
  ADD COLUMN "retireReason" VARCHAR(240),
  ADD COLUMN "replacedByBatchId" TEXT,
  ADD COLUMN "replacedAt" TIMESTAMP(3);

ALTER TABLE "workpaper_import_batches"
  ADD CONSTRAINT "workpaper_import_batches_replacedByBatchId_fkey"
  FOREIGN KEY ("replacedByBatchId") REFERENCES "workpaper_import_batches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "workpaper_import_batches_replacedByBatchId_idx"
  ON "workpaper_import_batches"("replacedByBatchId");

-- Los estados son texto y no tienen CHECK que requiera ampliación.
-- El runtime conserva lectura/escritura por tenant, pero no puede borrar evidencia.
DROP POLICY IF EXISTS tenant_delete ON "workpaper_import_batches";
REVOKE DELETE ON "workpaper_import_batches" FROM contable_runtime;
GRANT SELECT, INSERT, UPDATE ON "workpaper_import_batches" TO contable_runtime;
