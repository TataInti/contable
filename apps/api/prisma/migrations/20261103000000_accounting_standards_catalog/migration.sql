-- ============================================================
-- Catálogo de normas contables por estudio (decisión de producto TataInti).
--
-- Cada estudio define su catálogo desde Administración (parámetro
-- estandarizado por firma); la ficha del cliente selecciona de este catálogo
-- sin texto libre. NO se precargan valores: el catálogo arranca vacío y son
-- los estudios quienes dan de alta sus propias normas.
--
-- El valor guardado en client_profiles."accountingStandard" permanece como
-- texto existente: los datos legacy se conservan en lectura y sólo se
-- validan contra este catálogo cuando el estudio guarda la ficha (422 si el
-- valor no está en el catálogo). No hay backfill ni borrado automático.
-- ============================================================

-- CreateTable
CREATE TABLE "accounting_standards" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_standards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_standards_firmId_name_key" ON "accounting_standards"("firmId", "name");

-- CreateIndex
CREATE INDEX "accounting_standards_firmId_idx" ON "accounting_standards"("firmId");

-- AddForeignKey
ALTER TABLE "accounting_standards" ADD CONSTRAINT "accounting_standards_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ADR-006): tabla de tenant aislada por firma, igual que client_profiles.
ALTER TABLE "accounting_standards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_standards" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_standards_firm_scope ON "accounting_standards";
CREATE POLICY accounting_standards_firm_scope ON "accounting_standards"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- Grants: el runtime hace CRUD (se administra desde la API del estudio).
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_standards TO contable_runtime;
