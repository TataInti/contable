-- Nombre visible de los miembros activos del estudio para comentarios y menciones.
-- users solo es visible para su propia fila y, para OWNER/ADMIN, para los miembros del estudio
-- (ver 20261108000000_restore_firm_user_visibility). Con ese RLS, un REVIEWER o PREPARER no veía
-- el autor de una mención: el JOIN con users descartaba la fila y el buzón "Pendientes para mí"
-- quedaba vacío. Esta función devuelve solo el nombre, y solo si quien consulta y la persona
-- consultada son miembros activos del mismo estudio. No expone correo ni credenciales.
CREATE OR REPLACE FUNCTION app_firm_member_name(target_firm_id text, target_user_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT u.name
  FROM users u
  WHERE u.id = target_user_id
    AND app_is_firm_member(target_firm_id, current_setting('app.user_id', true))
    AND EXISTS (
      SELECT 1 FROM firm_memberships fm
      WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id AND fm.status = 'ACTIVE'
    )
$$;
