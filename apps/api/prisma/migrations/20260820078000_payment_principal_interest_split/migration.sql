ALTER TABLE "tax_payments"
ADD COLUMN "principalAmount" DECIMAL(20,4) NOT NULL DEFAULT 0,
ADD COLUMN "interestAmount" DECIMAL(20,4) NOT NULL DEFAULT 0;

UPDATE "tax_payments"
SET "principalAmount" = "amount";

ALTER TABLE "tax_payments"
ADD CONSTRAINT "tax_payments_amount_split"
CHECK (
  "principalAmount" >= 0
  AND "interestAmount" >= 0
  AND "amount" = "principalAmount" + "interestAmount"
);
