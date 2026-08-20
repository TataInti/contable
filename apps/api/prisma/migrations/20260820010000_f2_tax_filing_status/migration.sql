-- ============================================================
-- F2.3: TaxFiling con estados tipados (PLAN §5.7, gap D-3)
--
-- TaxFiling pasa de status String a enum TaxFilingStatus con
-- PENDING/FILED/REJECTED/VOIDED. La transición a FILED exige
-- evidenceDocumentId de un acuse validado (se valida en el service).
-- Los registros existentes (status 'FILED') se conservan.
-- ============================================================

-- CreateEnum
CREATE TYPE "TaxFilingStatus" AS ENUM ('PENDING', 'FILED', 'REJECTED', 'VOIDED');

-- AlterTable: convertir la columna String a enum, conservando 'FILED'
ALTER TABLE "tax_filings" DROP COLUMN "status";
ALTER TABLE "tax_filings" ADD COLUMN "status" "TaxFilingStatus" NOT NULL DEFAULT 'PENDING';