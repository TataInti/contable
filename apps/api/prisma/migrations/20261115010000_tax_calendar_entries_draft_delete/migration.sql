-- ============================================================
-- Corte 2a-ii-a: baja de celdas en un calendario en borrador
--
-- Migracion aditiva escrita a mano. prisma migrate dev queda fuera de este
-- flujo (drift preexistente). Solo agrega una politica de borrado y el
-- permiso de borrado del rol de la aplicacion, y solo sobre
-- tax_calendar_entries. No crea ni quita tablas, columnas ni enums, no
-- modifica datos y no toca otras tablas.
--
-- La politica usa el mismo alcance por estudio que las politicas de escritura
-- (sin portal, misma firma, miembro activo) y exige que el calendario de la
-- celda este en borrador. Una celda publicada u oculta no se borra ni con SQL
-- directo bajo el rol de la aplicacion. ENABLE y FORCE ROW LEVEL SECURITY ya
-- estan activos desde 20261115000000_tax_calendars: no se repiten.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Politica de borrado: celda de un calendario en borrador de la misma firma
-- ------------------------------------------------------------
CREATE POLICY firm_scope_delete ON "tax_calendar_entries" FOR DELETE
  USING (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
    AND EXISTS (
      SELECT 1
      FROM "tax_calendars" AS calendar
      WHERE calendar."id" = "tax_calendar_entries"."calendarId"
        AND calendar."firmId" = "tax_calendar_entries"."firmId"
        AND calendar."status" = 'DRAFT'
    )
  );

-- ------------------------------------------------------------
-- 2. Permiso de borrado del rol de runtime: solo sobre celdas.
-- ------------------------------------------------------------
DO $$ BEGIN
  GRANT DELETE ON "tax_calendar_entries" TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
