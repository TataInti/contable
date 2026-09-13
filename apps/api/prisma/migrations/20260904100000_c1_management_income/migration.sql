-- C (plan piloto fiscal §7.1): ingresos gerenciales.
-- Separados del dominio fiscal: nunca crean comprobante, componente ni
-- ajuste fiscal. RLS tenant + grants al runtime (patrón estándar).

CREATE TABLE "management_incomes" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ARS',
    "accruedOn" TIMESTAMP(3) NOT NULL,
    "collectedOn" TIMESTAMP(3),
    "category" TEXT,
    "status" "ManagementExpenseStatus" NOT NULL DEFAULT 'DRAFT',
    "evidenceDocumentId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_incomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "management_incomes_firm_client_accrued_idx"
    ON "management_incomes"("firmId", "clientId", "accruedOn");

ALTER TABLE "management_incomes" ADD CONSTRAINT "management_incomes_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "management_incomes" ADD CONSTRAINT "management_incomes_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "management_incomes" ADD CONSTRAINT "management_incomes_reviewedByUserId_fkey"
    FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: patrón app_can_access_tenant + actor != PORTAL.
ALTER TABLE "management_incomes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "management_incomes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON "management_incomes";
DROP POLICY IF EXISTS tenant_insert ON "management_incomes";
DROP POLICY IF EXISTS tenant_update ON "management_incomes";
DROP POLICY IF EXISTS tenant_delete ON "management_incomes";
CREATE POLICY tenant_select ON "management_incomes" FOR SELECT USING (app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_insert ON "management_incomes" FOR INSERT WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_update ON "management_incomes" FOR UPDATE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId")) WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));
CREATE POLICY tenant_delete ON "management_incomes" FOR DELETE USING (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_tenant("firmId", "clientId"));

GRANT SELECT, INSERT, UPDATE, DELETE ON management_incomes TO contable_runtime;
