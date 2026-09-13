ALTER TABLE "tax_payments"
ADD COLUMN "reversalReason" TEXT;

ALTER TABLE "tax_payments"
ADD CONSTRAINT "tax_payments_positive_amount" CHECK ("amount" > 0);

ALTER TABLE "tax_filings"
ADD CONSTRAINT "tax_filings_non_negative_amount" CHECK ("amountFiled" >= 0);

CREATE UNIQUE INDEX "tax_payments_obligationId_reference_key"
ON "tax_payments"("obligationId", "reference");

CREATE UNIQUE INDEX "tax_filings_one_filed_settlement_key"
ON "tax_filings"("obligationId", "settlementId")
WHERE "status" = 'FILED';
