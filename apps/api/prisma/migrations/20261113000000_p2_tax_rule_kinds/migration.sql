BEGIN;

CREATE TABLE "tax_rule_kinds" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tax_rule_kinds_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tax_rule_kinds_key_key" ON "tax_rule_kinds"("key");
CREATE INDEX "tax_rule_kinds_isActive_sortOrder_idx"
  ON "tax_rule_kinds"("isActive", "sortOrder");

CREATE TABLE "calc_family_rule_kinds" (
  "familyId" TEXT NOT NULL,
  "kindId" TEXT NOT NULL,
  CONSTRAINT "calc_family_rule_kinds_pkey" PRIMARY KEY ("familyId", "kindId"),
  CONSTRAINT "calc_family_rule_kinds_familyId_fkey"
    FOREIGN KEY ("familyId") REFERENCES "calc_families"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "calc_family_rule_kinds_kindId_fkey"
    FOREIGN KEY ("kindId") REFERENCES "tax_rule_kinds"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "calc_family_rule_kinds_kindId_idx"
  ON "calc_family_rule_kinds"("kindId");

INSERT INTO "tax_rule_kinds"
  ("id", "key", "label", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('k1000000-0000-4000-8000-000000000001', 'RATE', 'Alícuota', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('k1000000-0000-4000-8000-000000000002', 'COEFFICIENT', 'Coeficiente', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('k1000000-0000-4000-8000-000000000003', 'FEE', 'Cuota', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('k1000000-0000-4000-8000-000000000004', 'SPECIAL_CREDIT', 'Crédito especial', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "calc_family_rule_kinds" ("familyId", "kindId")
SELECT f."id", k."id"
FROM (VALUES
  ('VAT_RI', 'RATE'), ('VAT_RI', 'SPECIAL_CREDIT'),
  ('IIBB_LOCAL', 'RATE'),
  ('IIBB_CM03', 'RATE'), ('IIBB_CM03', 'COEFFICIENT'),
  ('TEM', 'RATE'),
  ('MONOTRIBUTO', 'FEE')
) AS allowed("familyKey", "kindKey")
JOIN "calc_families" f ON f."key" = allowed."familyKey"
JOIN "tax_rule_kinds" k ON k."key" = allowed."kindKey";

ALTER TABLE "tax_rate_rules"
  ADD COLUMN "kindId" TEXT,
  ADD COLUMN "activityId" TEXT,
  ADD COLUMN "categoryCode" TEXT,
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tax_rate_rules"
  ADD CONSTRAINT "tax_rate_rules_kindId_fkey"
    FOREIGN KEY ("kindId") REFERENCES "tax_rule_kinds"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "tax_rate_rules_activityId_fkey"
    FOREIGN KEY ("activityId") REFERENCES "economic_activities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "tax_rate_rules_kindId_idx" ON "tax_rate_rules"("kindId");
CREATE INDEX "tax_rate_rules_activityId_idx" ON "tax_rate_rules"("activityId");
CREATE INDEX "tax_rate_rules_ruleVersionId_kindId_idx"
  ON "tax_rate_rules"("ruleVersionId", "kindId");

-- Clasificar únicamente versiones DRAFT; el hash v2 omite estas columnas.
-- Las versiones no DRAFT conservan íntegros los datos y el hash persistidos.
WITH candidates AS (
  SELECT r."id", regime."calcFamilyId", r."concept", r."activityCode",
         r."jurisdictionId",
         CASE
           WHEN left(r."concept", 5) = 'COEF_' THEN 'COEFFICIENT'
           WHEN left(r."concept", 6) = 'CUOTA_' THEN 'FEE'
           WHEN r."concept" = 'DTO_814' THEN 'SPECIAL_CREDIT'
           WHEN r."activityCode" IS NOT NULL THEN 'RATE'
           WHEN r."jurisdictionId" IS NOT NULL
             AND r."concept" IN ('ALICUOTA', 'RATE', 'JURISDICCION') THEN 'RATE'
           WHEN r."concept" = 'DEFAULT' THEN 'RATE'
           ELSE NULL
         END AS "kindKey",
         CASE WHEN left(r."concept", 6) = 'CUOTA_'
              THEN substring(r."concept" FROM 7) ELSE NULL END AS "categoryCode"
  FROM "tax_rate_rules" r
  JOIN "tax_rule_versions" v ON v."id" = r."ruleVersionId"
  JOIN "tax_rule_packs" p ON p."id" = v."packId"
  JOIN "tax_regimes" regime ON regime."id" = p."regimeId"
  WHERE v."status" = 'DRAFT' AND r."kindId" IS NULL
), resolved AS (
  SELECT c."id", k."id" AS "kindId", c."categoryCode",
         (c."concept" = 'DEFAULT') AS "isDefault"
  FROM candidates c
  JOIN "tax_rule_kinds" k ON k."key" = c."kindKey"
  JOIN "calc_family_rule_kinds" allowed
    ON allowed."familyId" = c."calcFamilyId" AND allowed."kindId" = k."id"
  WHERE c."kindKey" IS NOT NULL
)
UPDATE "tax_rate_rules" r
SET "kindId" = resolved."kindId",
    "categoryCode" = resolved."categoryCode",
    "isDefault" = resolved."isDefault"
FROM resolved
WHERE r."id" = resolved."id";

-- Resolve activityCode only for one catalog match; use jurisdiction when present.
WITH activity_matches AS (
  SELECT r."id" AS "ruleId", min(a."id") AS "activityId"
  FROM "tax_rate_rules" r
  JOIN "tax_rule_versions" v ON v."id" = r."ruleVersionId"
  JOIN "economic_activities" a
    ON a."code" = r."activityCode"
   AND (r."jurisdictionId" IS NULL OR r."jurisdictionId" = a."jurisdictionId")
  WHERE v."status" = 'DRAFT' AND r."activityCode" IS NOT NULL
  GROUP BY r."id"
  HAVING count(DISTINCT a."id") = 1
)
UPDATE "tax_rate_rules" r
SET "activityId" = m."activityId"
FROM activity_matches m
WHERE r."id" = m."ruleId" AND r."activityId" IS NULL;

DO $$ BEGIN
  GRANT SELECT ON "tax_rule_kinds", "calc_family_rule_kinds" TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
