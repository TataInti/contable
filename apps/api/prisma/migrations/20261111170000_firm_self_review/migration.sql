-- Opción explícita de autorrevisión por estudio. Para las firmas existentes
-- queda desactivada; la columna es aditiva y no modifica otros datos.
ALTER TABLE "firms"
    ADD COLUMN "allowSelfReview" BOOLEAN NOT NULL DEFAULT false;

-- El runtime sólo modifica esta preferencia y updatedAt; la política restringe
-- la escritura a un OWNER activo de la firma y al contexto tenant de la sesión.
GRANT UPDATE ("allowSelfReview", "updatedAt") ON "firms" TO contable_runtime;

CREATE POLICY firms_owner_self_review_update ON "firms" FOR UPDATE
    USING (
        id = current_setting('app.firm_id', true)
        AND current_setting('app.actor_kind', true) = 'USER'
        AND app_is_firm_member(id, current_setting('app.user_id', true))
        AND EXISTS (
            SELECT 1
            FROM firm_memberships fm
            WHERE fm."firmId" = firms.id
              AND fm."userId" = current_setting('app.user_id', true)
              AND fm.role = 'OWNER'
              AND fm.status = 'ACTIVE'
        )
    )
    WITH CHECK (
        id = current_setting('app.firm_id', true)
        AND current_setting('app.actor_kind', true) = 'USER'
        AND app_is_firm_member(id, current_setting('app.user_id', true))
        AND EXISTS (
            SELECT 1
            FROM firm_memberships fm
            WHERE fm."firmId" = firms.id
              AND fm."userId" = current_setting('app.user_id', true)
              AND fm.role = 'OWNER'
              AND fm.status = 'ACTIVE'
        )
    );