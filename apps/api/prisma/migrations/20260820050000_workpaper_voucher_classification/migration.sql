-- Fase 2: clasificación fiscal trazable de comprobantes por revisión del
-- expediente. El snapshot evita que un cambio posterior en el maestro de
-- proveedores altere una liquidación ya preparada.

ALTER TABLE "supplier_tax_profiles"
  ADD COLUMN "categoryCode" TEXT;

CREATE TABLE "workpaper_voucher_classifications" (
  "id" TEXT NOT NULL,
  "firmId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "workpaperId" TEXT NOT NULL,
  "voucherId" TEXT NOT NULL,
  "supplierProfileId" TEXT,
  "direction" "FiscalVoucherDirection" NOT NULL,
  "counterpartyCuit" TEXT NOT NULL,
  "documentKind" TEXT NOT NULL,
  "categoryCode" TEXT,
  "activityCode" TEXT,
  "rateBuckets" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "origin" TEXT,
  "snapshotHash" TEXT,
  "classifiedByUserId" TEXT,
  "classifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workpaper_voucher_classifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workpaper_voucher_classifications_workpaperId_voucherId_key"
  ON "workpaper_voucher_classifications"("workpaperId", "voucherId");

CREATE INDEX "workpaper_voucher_classifications_firmId_clientId_workpaperId_status_idx"
  ON "workpaper_voucher_classifications"("firmId", "clientId", "workpaperId", "status");

CREATE INDEX "workpaper_voucher_classifications_firmId_clientId_counterpartyCuit_idx"
  ON "workpaper_voucher_classifications"("firmId", "clientId", "counterpartyCuit");

ALTER TABLE "workpaper_voucher_classifications"
  ADD CONSTRAINT "workpaper_voucher_classifications_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_voucher_classifications"
  ADD CONSTRAINT "workpaper_voucher_classifications_workpaperId_fkey"
  FOREIGN KEY ("workpaperId") REFERENCES "monthly_tax_workpapers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_voucher_classifications"
  ADD CONSTRAINT "workpaper_voucher_classifications_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "fiscal_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workpaper_voucher_classifications"
  ADD CONSTRAINT "workpaper_voucher_classifications_supplierProfileId_fkey"
  FOREIGN KEY ("supplierProfileId") REFERENCES "supplier_tax_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "workpaper_voucher_classifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workpaper_voucher_classifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_select ON "workpaper_voucher_classifications"
  FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "workpaper_voucher_classifications"
  FOR INSERT WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "workpaper_voucher_classifications"
  FOR UPDATE USING (app_can_access_tenant("firmId", "clientId"))
  WITH CHECK (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "workpaper_voucher_classifications"
  FOR DELETE USING (app_can_access_tenant("firmId", "clientId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON workpaper_voucher_classifications TO contable_runtime;
