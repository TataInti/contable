-- Congela la identidad de la versión normativa, además de su hash, para que
-- toda liquidación pueda navegarse hasta reglas, vigencias y fuentes.

ALTER TABLE "tax_settlements"
  ADD COLUMN "ruleVersionId" TEXT;

ALTER TABLE "tax_settlements"
  ADD CONSTRAINT "tax_settlements_ruleVersionId_fkey"
  FOREIGN KEY ("ruleVersionId") REFERENCES "tax_rule_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tax_settlements_ruleVersionId_idx"
  ON "tax_settlements"("ruleVersionId");
