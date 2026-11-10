ALTER TABLE "tax_rule_versions"
  ADD COLUMN "activatedByUserId" TEXT;

CREATE INDEX "tax_rule_versions_activatedByUserId_idx"
  ON "tax_rule_versions"("activatedByUserId");

ALTER TABLE "tax_rule_versions"
  ADD CONSTRAINT "tax_rule_versions_activatedByUserId_fkey"
  FOREIGN KEY ("activatedByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
