-- ============================================================
-- F2.2: Pedidos documentales por obligación (PLAN §8 Fase 2)
--
-- Vincula un pedido documental a una obligación fiscal (opcional)
-- para que la evidencia quede asociada a la obligación correcta.
-- Migración incremental: el campo es opcional; los pedidos
-- existentes quedan sin obligación.
-- ============================================================

-- AlterTable
ALTER TABLE "document_requests" ADD COLUMN     "obligationId" TEXT;

-- CreateIndex
CREATE INDEX "document_requests_obligationId_idx" ON "document_requests"("obligationId");

-- AddForeignKey
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "tax_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;