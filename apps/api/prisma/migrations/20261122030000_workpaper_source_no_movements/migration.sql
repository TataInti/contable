-- Fuente «Sin movimientos» por mes (corte 2A, decisión D2).
-- Migración aditiva: una tabla nueva. No altera tablas, columnas ni datos existentes.
-- Cada marca es una fila: deshacer completa clearedAt y no borra nada (el runtime no tiene DELETE).
-- Una sola marca vigente por expediente y fuente: índice único parcial sobre las filas sin clearedAt.

CREATE TABLE "workpaper_source_statuses" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "workpaperId" TEXT NOT NULL,
    "sourceCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "markedByUserId" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL,
    "clearedByUserId" TEXT,
    "clearedAt" TIMESTAMP(3),
    "clearReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workpaper_source_statuses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workpaper_source_statuses_status_check" CHECK ("status" IN ('NO_MOVEMENTS')),
    CONSTRAINT "workpaper_source_statuses_clear_reason_check" CHECK ("clearReason" IS NULL OR "clearReason" IN ('MANUAL', 'BATCH_REVIEWED')),
    CONSTRAINT "workpaper_source_statuses_clear_pair_check" CHECK (("clearedAt" IS NULL) = ("clearReason" IS NULL))
);

CREATE UNIQUE INDEX "workpaper_source_statuses_active_key"
    ON "workpaper_source_statuses"("workpaperId", "sourceCode")
    WHERE "clearedAt" IS NULL;

CREATE INDEX "workpaper_source_statuses_scope_idx"
    ON "workpaper_source_statuses"("firmId", "clientId", "workpaperId", "sourceCode");

ALTER TABLE "workpaper_source_statuses"
    ADD CONSTRAINT "workpaper_source_statuses_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_source_statuses"
    ADD CONSTRAINT "workpaper_source_statuses_firmId_clientId_fkey"
    FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_source_statuses"
    ADD CONSTRAINT "workpaper_source_statuses_workpaperId_fkey"
    FOREIGN KEY ("workpaperId") REFERENCES "monthly_tax_workpapers"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workpaper_source_statuses"
    ADD CONSTRAINT "workpaper_source_statuses_markedByUserId_fkey"
    FOREIGN KEY ("markedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workpaper_source_statuses"
    ADD CONSTRAINT "workpaper_source_statuses_clearedByUserId_fkey"
    FOREIGN KEY ("clearedByUserId") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: quien accede al cliente lee y marca o deshace; el portal no escribe (mismo patrón que client_tem_categories).
ALTER TABLE "workpaper_source_statuses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workpaper_source_statuses" FORCE ROW LEVEL SECURITY;

CREATE POLICY "workpaper_source_statuses_select" ON "workpaper_source_statuses" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));

CREATE POLICY "workpaper_source_statuses_insert" ON "workpaper_source_statuses" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

CREATE POLICY "workpaper_source_statuses_update" ON "workpaper_source_statuses" FOR UPDATE
    USING (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    )
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

GRANT SELECT, INSERT, UPDATE ON "workpaper_source_statuses" TO contable_runtime;
REVOKE DELETE ON "workpaper_source_statuses" FROM contable_runtime;
