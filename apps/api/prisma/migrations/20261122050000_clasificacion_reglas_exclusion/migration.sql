-- Clasificación en bloque (corte 3B): reglas «recordar» por contraparte, exclusión con motivo y compras B/C sin crédito.
-- Migración aditiva: una tabla nueva y cuatro columnas con default o nulas en workpaper_voucher_classifications.
-- No altera ni borra datos existentes. El runtime no tiene DELETE: borrar una regla completa revokedAt.

-- Exclusión del cálculo con motivo (las tres columnas van juntas) y crédito fiscal de IVA por comprobante.
ALTER TABLE "workpaper_voucher_classifications"
    ADD COLUMN "ivaCredit" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "excludedAt" TIMESTAMP(3),
    ADD COLUMN "excludedByUserId" TEXT,
    ADD COLUMN "excludedReason" TEXT;

ALTER TABLE "workpaper_voucher_classifications"
    ADD CONSTRAINT "workpaper_voucher_classifications_excluded_check"
    CHECK (
        ("excludedAt" IS NULL AND "excludedByUserId" IS NULL AND "excludedReason" IS NULL)
        OR ("excludedAt" IS NOT NULL AND "excludedByUserId" IS NOT NULL AND length(btrim("excludedReason")) > 0)
    );

ALTER TABLE "workpaper_voucher_classifications"
    ADD CONSTRAINT "workpaper_voucher_classifications_excludedByUserId_fkey"
    FOREIGN KEY ("excludedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas «recordar»: CUIT de la contraparte → rubro (compras) o actividad (ventas) por cliente.
CREATE TABLE "classification_rules" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "direction" "FiscalVoucherDirection" NOT NULL,
    "counterpartyCuit" TEXT NOT NULL,
    "categoryCode" TEXT,
    "activityCode" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "classification_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "classification_rules_target_check" CHECK ("categoryCode" IS NOT NULL OR "activityCode" IS NOT NULL),
    CONSTRAINT "classification_rules_revoked_pair_check" CHECK (("revokedAt" IS NULL) = ("revokedByUserId" IS NULL))
);

-- Una regla vigente por cliente, sentido y CUIT.
CREATE UNIQUE INDEX "classification_rules_active_key"
    ON "classification_rules"("clientId", "direction", "counterpartyCuit")
    WHERE "revokedAt" IS NULL;

CREATE INDEX "classification_rules_scope_idx"
    ON "classification_rules"("firmId", "clientId", "direction", "counterpartyCuit");

ALTER TABLE "classification_rules"
    ADD CONSTRAINT "classification_rules_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classification_rules"
    ADD CONSTRAINT "classification_rules_firmId_clientId_fkey"
    FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "classification_rules"
    ADD CONSTRAINT "classification_rules_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "classification_rules"
    ADD CONSTRAINT "classification_rules_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: quien accede al cliente lee, crea y revoca; el portal no escribe (mismo patrón que workpaper_source_statuses).
ALTER TABLE "classification_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "classification_rules" FORCE ROW LEVEL SECURITY;

CREATE POLICY "classification_rules_select" ON "classification_rules" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));

CREATE POLICY "classification_rules_insert" ON "classification_rules" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

CREATE POLICY "classification_rules_update" ON "classification_rules" FOR UPDATE
    USING (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    )
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

GRANT SELECT, INSERT, UPDATE ON "classification_rules" TO contable_runtime;
REVOKE DELETE ON "classification_rules" FROM contable_runtime;
