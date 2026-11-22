-- Tipos de comprobante permitidos por cliente (corte 4B): tildes del perfil por año y aceptación
-- de comprobantes que no corresponden al perfil. Migración aditiva: una tabla nueva y tres columnas
-- nulas en workpaper_voucher_classifications. No altera ni borra datos existentes.
-- Patrón de client_tem_categories: RLS forzado, el runtime no tiene DELETE.

-- Tildes del cliente por año: clases del catálogo y tilde de exentos, con quién y cuándo.
CREATE TABLE "client_voucher_permissions" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "allowedClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "exemptAllowed" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_voucher_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_voucher_permissions_firmId_clientId_year_key"
    ON "client_voucher_permissions"("firmId", "clientId", "year");

ALTER TABLE "client_voucher_permissions"
    ADD CONSTRAINT "client_voucher_permissions_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_voucher_permissions"
    ADD CONSTRAINT "client_voucher_permissions_firmId_clientId_fkey"
    FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_voucher_permissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_voucher_permissions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "client_voucher_permissions_select" ON "client_voucher_permissions" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));

CREATE POLICY "client_voucher_permissions_insert" ON "client_voucher_permissions" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

CREATE POLICY "client_voucher_permissions_update" ON "client_voucher_permissions" FOR UPDATE
    USING (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    )
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

GRANT SELECT, INSERT, UPDATE ON "client_voucher_permissions" TO contable_runtime;
REVOKE DELETE ON "client_voucher_permissions" FROM contable_runtime;

-- Aceptación de un comprobante fuera del perfil: las tres columnas van juntas y el motivo no puede quedar vacío.
ALTER TABLE "workpaper_voucher_classifications"
    ADD COLUMN "profileAcceptedAt" TIMESTAMP(3),
    ADD COLUMN "profileAcceptedByUserId" TEXT,
    ADD COLUMN "profileAcceptedReason" TEXT;

ALTER TABLE "workpaper_voucher_classifications"
    ADD CONSTRAINT "workpaper_voucher_classifications_profile_accepted_check"
    CHECK (
        ("profileAcceptedAt" IS NULL AND "profileAcceptedByUserId" IS NULL AND "profileAcceptedReason" IS NULL)
        OR ("profileAcceptedAt" IS NOT NULL AND "profileAcceptedByUserId" IS NOT NULL AND length(btrim("profileAcceptedReason")) > 0)
    );

ALTER TABLE "workpaper_voucher_classifications"
    ADD CONSTRAINT "workpaper_voucher_classifications_profileAcceptedByUserId_fkey"
    FOREIGN KEY ("profileAcceptedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
