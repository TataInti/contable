-- P2 corte 2a — familias de cálculo y motores como catálogos de sistema.
-- Aditiva: dos tablas nuevas, tres columnas anulables, siembra de 5 familias y
-- 9 motores, y backfill por la regla vigente (impuesto, régimen y jurisdicción).
-- El texto engineVersion se conserva y sigue participando del hash canónico v2.

BEGIN;

CREATE TABLE "calc_families" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "allowsAdvancePayment" BOOLEAN NOT NULL DEFAULT false,
    "closesByJurisdiction" BOOLEAN NOT NULL DEFAULT false,
    "allowedBalanceKinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calc_families_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calc_families_key_key" ON "calc_families"("key");
CREATE INDEX "calc_families_isActive_sortOrder_idx" ON "calc_families"("isActive", "sortOrder");

CREATE TABLE "tax_engines" (
    "id" TEXT NOT NULL,
    "engineKey" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_engines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tax_engines_engineKey_key" ON "tax_engines"("engineKey");
CREATE INDEX "tax_engines_familyId_isActive_sortOrder_idx" ON "tax_engines"("familyId", "isActive", "sortOrder");
CREATE INDEX "tax_engines_engineVersion_idx" ON "tax_engines"("engineVersion");

ALTER TABLE "tax_engines"
  ADD CONSTRAINT "tax_engines_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "calc_families"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tax_types" ADD COLUMN "defaultFamilyId" TEXT;
ALTER TABLE "tax_regimes" ADD COLUMN "calcFamilyId" TEXT;
ALTER TABLE "tax_rule_versions" ADD COLUMN "engineId" TEXT;

ALTER TABLE "tax_types"
  ADD CONSTRAINT "tax_types_defaultFamilyId_fkey"
  FOREIGN KEY ("defaultFamilyId") REFERENCES "calc_families"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tax_regimes"
  ADD CONSTRAINT "tax_regimes_calcFamilyId_fkey"
  FOREIGN KEY ("calcFamilyId") REFERENCES "calc_families"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tax_rule_versions"
  ADD CONSTRAINT "tax_rule_versions_engineId_fkey"
  FOREIGN KEY ("engineId") REFERENCES "tax_engines"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tax_types_defaultFamilyId_idx" ON "tax_types"("defaultFamilyId");
CREATE INDEX "tax_regimes_calcFamilyId_idx" ON "tax_regimes"("calcFamilyId");
CREATE INDEX "tax_rule_versions_engineId_idx" ON "tax_rule_versions"("engineId");

INSERT INTO "calc_families"
  ("id", "key", "label", "isActive", "sortOrder",
   "allowsAdvancePayment", "closesByJurisdiction", "allowedBalanceKinds",
   "createdAt", "updatedAt")
VALUES
  ('f1000000-0000-4000-8000-000000000001', 'VAT_RI',
   'IVA Responsable Inscripto', true, 10, false, false,
   ARRAY['IVA_TECNICO','IVA_LIBRE']::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f1000000-0000-4000-8000-000000000002', 'IIBB_LOCAL',
   'IIBB local — Tucumán', true, 20, false, false,
   ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f1000000-0000-4000-8000-000000000003', 'IIBB_CM03',
   'IIBB Convenio Multilateral — CM03 art. 2', true, 30, false, true,
   ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f1000000-0000-4000-8000-000000000004', 'TEM',
   'Tasa de Espacios Municipales — San Miguel de Tucumán', true, 40, false, false,
   ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('f1000000-0000-4000-8000-000000000005', 'MONOTRIBUTO',
   'Monotributo', true, 50, true, false,
   ARRAY[]::TEXT[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "tax_engines"
  ("id", "engineKey", "engineVersion", "familyId", "label", "isActive",
   "sortOrder", "createdAt", "updatedAt")
VALUES
  ('e1000000-0000-4000-8000-000000000001', 'vat-ri',
   'ar-vat-ri-v2.1.0', 'f1000000-0000-4000-8000-000000000001',
   'IVA RI por alícuota', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000002', 'vat-ri-legacy',
   'ar-vat-ri-v1.0.0', 'f1000000-0000-4000-8000-000000000001',
   'IVA RI legacy', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000003', 'iibb-local-tuc',
   'ar-iibb-tuc-local-v1.1.0', 'f1000000-0000-4000-8000-000000000002',
   'IIBB local Tucumán', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000004', 'iibb-local-tuc-legacy',
   'ar-iibb-tuc-local-v1.0.0', 'f1000000-0000-4000-8000-000000000002',
   'IIBB local Tucumán legacy', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000005', 'iibb-cm-art2',
   'ar-iibb-cm-art2-v1.1.0', 'f1000000-0000-4000-8000-000000000003',
   'IIBB CM03 artículo 2', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000006', 'iibb-cm-art2-legacy',
   'ar-iibb-cm-art2-v1.0.0', 'f1000000-0000-4000-8000-000000000003',
   'IIBB CM03 artículo 2 legacy', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000007', 'tem-smt',
   'ar-tem-smt-v1.1.0', 'f1000000-0000-4000-8000-000000000004',
   'TEM San Miguel de Tucumán', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000008', 'tem-smt-legacy',
   'ar-tem-smt-v1.0.0', 'f1000000-0000-4000-8000-000000000004',
   'TEM San Miguel de Tucumán legacy', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('e1000000-0000-4000-8000-000000000009', 'monotributo',
   'ar-monotributo-v1.0.0', 'f1000000-0000-4000-8000-000000000005',
   'Monotributo', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "tax_engines"
    GROUP BY "engineVersion" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Backfill de engineId detenido: engineVersion duplicado en tax_engines';
  END IF;
END
$$;

UPDATE "tax_regimes" r
SET "calcFamilyId" = f."id"
FROM "tax_types" tt, "jurisdictions" j, "calc_families" f
WHERE tt."id" = r."taxTypeId"
  AND j."id" = r."jurisdictionId"
  AND r."calcFamilyId" IS NULL
  AND f."key" = CASE
    WHEN r."code" = 'MONOTRIBUTO' AND tt."code" = 'IIBB' THEN 'MONOTRIBUTO'
    WHEN tt."code" = 'IVA' THEN 'VAT_RI'
    WHEN tt."code" = 'IIBB' AND j."code" = 'AR-T' THEN 'IIBB_LOCAL'
    WHEN tt."code" = 'IIBB' AND j."code" = 'AR' THEN 'IIBB_CM03'
    WHEN tt."code" = 'TEM' AND j."code" IN ('AR-T', 'AR-SMT') THEN 'TEM'
    WHEN tt."code" = 'MONOTRIBUTO' THEN 'MONOTRIBUTO'
    ELSE NULL
  END;

UPDATE "tax_rule_versions" v
SET "engineId" = e."id"
FROM "tax_engines" e
WHERE v."engineId" IS NULL
  AND e."engineVersion" = v."engineVersion";

UPDATE "tax_types" tt
SET "defaultFamilyId" = f."id"
FROM "calc_families" f
WHERE tt."defaultFamilyId" IS NULL
  AND f."key" = CASE tt."code"
    WHEN 'IVA' THEN 'VAT_RI'
    WHEN 'TEM' THEN 'TEM'
    WHEN 'MONOTRIBUTO' THEN 'MONOTRIBUTO'
    ELSE NULL
  END;

CREATE OR REPLACE FUNCTION app_tax_engine_key_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW."engineKey" IS DISTINCT FROM OLD."engineKey" THEN
    RAISE EXCEPTION 'engineKey es inmutable: % -> %',
      OLD."engineKey", NEW."engineKey"
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tax_engines_engine_key_immutable"
BEFORE UPDATE ON "tax_engines"
FOR EACH ROW EXECUTE FUNCTION app_tax_engine_key_immutable();

DO $$ BEGIN
  GRANT SELECT ON "calc_families", "tax_engines" TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
