-- B1 (plan piloto fiscal §3.1): verificación obligatoria de saldos anteriores.
-- Los lotes existentes migran como PENDING_VERIFICATION y requieren revisión
-- antes de poder alimentar un cálculo (migración segura).

CREATE TYPE "TaxCreditLotStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'SUPERSEDED');

ALTER TABLE "tax_credit_lots" ADD COLUMN "verificationStatus" "TaxCreditLotStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION';
ALTER TABLE "tax_credit_lots" ADD COLUMN "verifiedByUserId" TEXT;
ALTER TABLE "tax_credit_lots" ADD COLUMN "verifiedAt" TIMESTAMP(3);

ALTER TABLE "tax_credit_lots" ADD CONSTRAINT "tax_credit_lots_verifiedByUserId_fkey"
    FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
