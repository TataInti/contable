-- Una regla efectiva se identifica por versión, concepto, alcance y vigencia.
-- Primero se rechazan conflictos reales; luego se consolidan únicamente las
-- filas repetidas que son semánticamente idénticas (producidas por seeds
-- históricos sin constraint).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tax_rate_rules"
    GROUP BY "ruleVersionId", "concept", "activityCode", "jurisdictionId", "validFrom"
    HAVING COUNT(DISTINCT ("rate", "minAmount", "validTo")) > 1
  ) THEN
    RAISE EXCEPTION 'Hay reglas de alícuota conflictivas para una misma identidad efectiva';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "tax_minimum_rules"
    GROUP BY "ruleVersionId", "concept", "jurisdictionId", "validFrom"
    HAVING COUNT(DISTINCT ("amount", "isConditional", "validTo")) > 1
  ) THEN
    RAISE EXCEPTION 'Hay reglas de mínimo conflictivas para una misma identidad efectiva';
  END IF;
END $$;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "ruleVersionId", "concept", "activityCode", "jurisdictionId", "validFrom"
           ORDER BY "createdAt", id
         ) AS duplicate_position
  FROM "tax_rate_rules"
)
DELETE FROM "tax_rate_rules" target
USING ranked
WHERE target.id = ranked.id
  AND ranked.duplicate_position > 1;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "ruleVersionId", "concept", "jurisdictionId", "validFrom"
           ORDER BY "createdAt", id
         ) AS duplicate_position
  FROM "tax_minimum_rules"
)
DELETE FROM "tax_minimum_rules" target
USING ranked
WHERE target.id = ranked.id
  AND ranked.duplicate_position > 1;

CREATE UNIQUE INDEX "tax_rate_rules_effective_identity_key"
  ON "tax_rate_rules"(
    "ruleVersionId",
    "concept",
    COALESCE("activityCode", ''),
    COALESCE("jurisdictionId", ''),
    "validFrom"
  );

CREATE UNIQUE INDEX "tax_minimum_rules_effective_identity_key"
  ON "tax_minimum_rules"(
    "ruleVersionId",
    "concept",
    COALESCE("jurisdictionId", ''),
    "validFrom"
  );
