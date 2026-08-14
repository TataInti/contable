-- Owners/admins may see the minimal identity attached to a portal membership.
CREATE OR REPLACE FUNCTION app_is_visible_portal_user(target_user_id text, target_firm_id text, target_actor_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId"=target_firm_id AND fm."userId"=target_actor_id
      AND fm.status='ACTIVE' AND fm.role IN ('OWNER','ADMIN')
  ) AND EXISTS (
    SELECT 1 FROM portal_memberships pm
    WHERE pm."firmId"=target_firm_id AND pm."userId"=target_user_id
  )
$$;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL
  USING (
    id=current_setting('app.user_id', true)
    OR app_is_visible_portal_user(id,current_setting('app.firm_id', true),current_setting('app.user_id', true))
  )
  WITH CHECK (id=current_setting('app.user_id', true));
