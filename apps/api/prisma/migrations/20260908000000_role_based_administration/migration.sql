-- Separación de administración por alcance:
-- los owners/admins del estudio pueden consultar la identidad mínima de sus
-- usuarios internos para asignarles un rol, que es la fuente de verdad del
-- acceso a módulos.

DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL
  USING (
    id = current_setting('app.user_id', true)
    OR app_is_visible_portal_user(id, current_setting('app.firm_id', true), current_setting('app.user_id', true))
    OR (
      NULLIF(current_setting('app.firm_id', true), '') IS NOT NULL
      AND app_is_firm_member(current_setting('app.firm_id', true), current_setting('app.user_id', true))
      AND EXISTS (
        SELECT 1
        FROM firm_memberships internal_member
        WHERE internal_member."firmId" = current_setting('app.firm_id', true)
          AND internal_member."userId" = users.id
          AND internal_member.status IN ('ACTIVE', 'INVITED', 'SUSPENDED')
      )
    )
  )
  WITH CHECK (id = current_setting('app.user_id', true));
