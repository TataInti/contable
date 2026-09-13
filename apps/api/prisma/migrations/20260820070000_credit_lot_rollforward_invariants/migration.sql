-- Fase 5: el arrastre de cierre es idempotente por liquidación y naturaleza
-- del saldo. La referencia preserva la explicación de aperturas y cierres.

ALTER TABLE "tax_credit_lots"
  ADD COLUMN "reference" TEXT;

CREATE UNIQUE INDEX "tax_credit_lots_sourceSettlementId_kind_key"
  ON "tax_credit_lots"("sourceSettlementId", "kind");
