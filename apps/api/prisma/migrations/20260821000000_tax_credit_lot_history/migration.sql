-- F1.1: historial de cambios de lotes de crédito (auditoría de ediciones)
-- Cada edición de un TaxCreditLot (referencia / respaldo) registra quién,
-- cuándo y qué campos cambiaron.

CREATE TABLE "tax_credit_lot_history" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changes" JSONB NOT NULL,

    CONSTRAINT "tax_credit_lot_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tax_credit_lot_history_firm_client_lot_idx"
    ON "tax_credit_lot_history"("firmId", "clientId", "lotId");

ALTER TABLE "tax_credit_lot_history"
    ADD CONSTRAINT "tax_credit_lot_history_lotId_fkey"
    FOREIGN KEY ("lotId") REFERENCES "tax_credit_lots"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tax_credit_lot_history"
    ADD CONSTRAINT "tax_credit_lot_history_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
