ALTER TABLE "due_date_rules"
ADD COLUMN "monthOffset" INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX "tax_interest_snapshots_obligationId_inputHash_key"
ON "tax_interest_snapshots"("obligationId", "inputHash");
