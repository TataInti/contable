-- ============================================================
-- F1.4: Alcance fiscal de certificados (PLAN §5.6.3)
--
-- Agrega taxTypeId, regimeId, jurisdictionId y creditKind a los
-- certificados de retención/percepción para atribuir créditos al
-- impuesto/régimen/jurisdicción correctos. Migración incremental:
-- los campos son opcionales; la atribución completa se activa
-- cuando el dato existe.
-- ============================================================

-- AlterTable
ALTER TABLE "perception_certificates" ADD COLUMN     "creditKind" TEXT NOT NULL DEFAULT 'PERCEPTION',
ADD COLUMN     "jurisdictionId" TEXT,
ADD COLUMN     "regimeId" TEXT,
ADD COLUMN     "taxTypeId" TEXT;

-- AlterTable
ALTER TABLE "withholding_certificates" ADD COLUMN     "creditKind" TEXT NOT NULL DEFAULT 'WITHHOLDING',
ADD COLUMN     "jurisdictionId" TEXT,
ADD COLUMN     "regimeId" TEXT,
ADD COLUMN     "taxTypeId" TEXT;