-- Los NULL de un índice UNIQUE común no se consideran iguales. Este índice
-- parcial completa la identidad de los cierres IVA/locales sin jurisdicción,
-- sin afectar lotes de apertura manual (sourceSettlementId IS NULL).

CREATE UNIQUE INDEX "tax_credit_lots_unscoped_closing_identity_key"
  ON "tax_credit_lots"("sourceSettlementId", "kind")
  WHERE "sourceSettlementId" IS NOT NULL
    AND "jurisdictionId" IS NULL;
