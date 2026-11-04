-- Restaura y endurece la visibilidad de identidades mínimas de miembros internos.
-- La migración 20260908000000 habilitó esta consulta por firma, pero una
-- ejecución posterior de prisma/rls.sql en su versión anterior la redujo a
-- users_self y dejó a los administradores sin nombre/email de sus miembros.
-- Esta política exige OWNER/ADMIN activo, limita las filas a la firma del
-- contexto, no cambia datos y conserva WITH CHECK para escrituras propias.
-- Las funciones SECURITY DEFINER usan esquemas confiables; pg_temp queda último.
ALTER FUNCTION app_is_firm_member(text, text)
  SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION app_is_visible_portal_user(text, text, text)
  SET search_path = pg_catalog, public, pg_temp;

-- Sólo un OWNER/ADMIN activo puede ver identidades de miembros de su firma.
-- SECURITY DEFINER evita la recursión de RLS sobre users/firm_memberships.
CREATE OR REPLACE FUNCTION app_can_manage_firm_users(
  target_firm_id text,
  target_actor_id text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.firm_memberships fm
    JOIN public.users actor ON actor.id = fm."userId"
    WHERE fm."firmId" = target_firm_id
      AND fm."userId" = target_actor_id
      AND fm.status = 'ACTIVE'
      AND fm.role IN ('OWNER', 'ADMIN')
      AND actor.status = 'ACTIVE'
  )
$$;
REVOKE ALL ON FUNCTION app_can_manage_firm_users(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can_manage_firm_users(text, text) TO contable_runtime, contable_worker;

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON "users";
CREATE POLICY users_self ON "users" FOR ALL
  USING (
    id = current_setting('app.user_id', true)
    OR app_is_visible_portal_user(
      id,
      current_setting('app.firm_id', true),
      current_setting('app.user_id', true)
    )
    OR (
      NULLIF(current_setting('app.firm_id', true), '') IS NOT NULL
      AND app_can_manage_firm_users(
        current_setting('app.firm_id', true),
        current_setting('app.user_id', true)
      )
      AND EXISTS (
        SELECT 1
        FROM public.firm_memberships internal_member
        WHERE internal_member."firmId" = current_setting('app.firm_id', true)
          AND internal_member."userId" = users.id
          AND internal_member.status IN ('ACTIVE', 'INVITED', 'SUSPENDED')
      )
    )
  )
  WITH CHECK (id = current_setting('app.user_id', true));
