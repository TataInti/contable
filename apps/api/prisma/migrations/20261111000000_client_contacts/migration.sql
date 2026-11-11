-- Colección de contactos operativos del cliente. Esta migración es aditiva:
-- conserva clientes y datos existentes y no concede borrado físico al runtime.
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "function" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_contacts_firmId_clientId_isActive_idx"
    ON "client_contacts"("firmId", "clientId", "isActive");

-- La opción principal es única por cliente y puede quedar sin asignar.
CREATE UNIQUE INDEX "client_contacts_one_primary_per_client_key"
    ON "client_contacts"("firmId", "clientId")
    WHERE "isPrimary" = true;

ALTER TABLE "client_contacts"
    ADD CONSTRAINT "client_contacts_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_contacts"
    ADD CONSTRAINT "client_contacts_firmId_clientId_fkey"
    FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_contacts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "client_contacts_select" ON "client_contacts" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));

CREATE POLICY "client_contacts_insert" ON "client_contacts" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

CREATE POLICY "client_contacts_update" ON "client_contacts" FOR UPDATE
    USING (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    )
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

GRANT SELECT, INSERT, UPDATE ON "client_contacts" TO contable_runtime;
REVOKE DELETE ON "client_contacts" FROM contable_runtime;
