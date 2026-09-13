-- Convenio Multilateral conserva un saldo independiente por jurisdicción.

DROP INDEX IF EXISTS "tax_credit_lots_sourceSettlementId_kind_key";

CREATE UNIQUE INDEX "tax_credit_lots_sourceSettlementId_kind_jurisdictionId_key"
  ON "tax_credit_lots"("sourceSettlementId", "kind", "jurisdictionId");
