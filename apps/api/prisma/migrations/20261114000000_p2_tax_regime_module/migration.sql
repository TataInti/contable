BEGIN;

CREATE TABLE "tax_regime_modules" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "flagCode" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tax_regime_modules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tax_regime_modules_key_key" ON "tax_regime_modules"("key");
CREATE UNIQUE INDEX "tax_regime_modules_flagCode_key" ON "tax_regime_modules"("flagCode");
CREATE INDEX "tax_regime_modules_isActive_sortOrder_idx"
  ON "tax_regime_modules"("isActive", "sortOrder");

INSERT INTO "tax_regime_modules"
  ("id", "key", "label", "flagCode", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('m7000000-0000-4000-8000-000000000001', 'TAX_RI', 'IVA Responsable Inscripto', 'TAX_RI', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('m7000000-0000-4000-8000-000000000002', 'TAX_IIBB_LOCAL_TUC', 'IIBB local Tucumán', 'TAX_IIBB_LOCAL_TUC', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('m7000000-0000-4000-8000-000000000003', 'TAX_TEM_SMT', 'TEM San Miguel de Tucumán', 'TAX_TEM_SMT', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('m7000000-0000-4000-8000-000000000004', 'TAX_CM_ART2', 'IIBB CM03 artículo 2', 'TAX_CM_ART2', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('m7000000-0000-4000-8000-000000000005', 'TAX_MONOTRIBUTO', 'Monotributo', 'TAX_MONOTRIBUTO', true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('m7000000-0000-4000-8000-000000000006', 'ALWAYS_ENABLED', 'Siempre habilitado', NULL, true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "tax_regimes" ADD COLUMN "moduleId" TEXT;
ALTER TABLE "tax_regimes"
  ADD CONSTRAINT "tax_regimes_moduleId_fkey"
  FOREIGN KEY ("moduleId") REFERENCES "tax_regime_modules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "tax_regimes_moduleId_idx" ON "tax_regimes"("moduleId");

-- Preserva la decisión del guard anterior: flags conocidos por coincidencia
-- exacta; los códigos sin flag propio quedan en Siempre habilitado.
UPDATE "tax_regimes" r
SET "moduleId" = m."id"
FROM "tax_regime_modules" m
WHERE r."moduleId" IS NULL
  AND m."key" = CASE r."code"
    WHEN 'RI' THEN 'TAX_RI'
    WHEN 'IIBB_LOCAL_TUC' THEN 'TAX_IIBB_LOCAL_TUC'
    WHEN 'TEM_SMT' THEN 'TAX_TEM_SMT'
    WHEN 'CM_ART2' THEN 'TAX_CM_ART2'
    WHEN 'MONOTRIBUTO' THEN 'TAX_MONOTRIBUTO'
    ELSE 'ALWAYS_ENABLED'
  END;

DO $$ BEGIN
  GRANT SELECT ON "tax_regime_modules" TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
