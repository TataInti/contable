-- Backfill the identity RLS and nullable client scope for databases that had
-- the earlier security migration applied before these policies were embedded.

CREATE OR REPLACE FUNCTION app_is_firm_member(target_firm_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM firm_memberships fm WHERE fm."firmId"=target_firm_id AND fm."userId"=target_user_id AND fm.status='ACTIVE')
$$;

CREATE OR REPLACE FUNCTION app_can_access_tenant(target_firm_id text, target_client_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT target_firm_id=current_setting('app.firm_id', true) AND (
    (target_client_id IS NULL AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member(target_firm_id,current_setting('app.user_id', true)))
    OR (target_client_id IS NOT NULL AND app_can_access_client(target_firm_id,target_client_id))
  )
$$;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL USING (id=current_setting('app.user_id', true)) WITH CHECK (id=current_setting('app.user_id', true));
ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE firms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firms_member ON firms;
CREATE POLICY firms_member ON firms FOR SELECT USING (app_is_firm_member(id,current_setting('app.user_id', true)));
ALTER TABLE firm_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_memberships_visible ON firm_memberships;
CREATE POLICY firm_memberships_visible ON firm_memberships FOR ALL
  USING ("userId"=current_setting('app.user_id', true) OR app_is_firm_member("firmId",current_setting('app.user_id', true)))
  WITH CHECK (app_is_firm_member("firmId",current_setting('app.user_id', true)));
ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_sessions_self ON device_sessions;
CREATE POLICY device_sessions_self ON device_sessions FOR SELECT USING ("userId"=current_setting('app.user_id', true));
ALTER TABLE client_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_assignments_visible ON client_assignments;
CREATE POLICY client_assignments_visible ON client_assignments FOR ALL
  USING ("firmId"=current_setting('app.firm_id', true) AND ("userId"=current_setting('app.user_id', true) OR app_is_firm_member("firmId",current_setting('app.user_id', true))))
  WITH CHECK ("firmId"=current_setting('app.firm_id', true) AND app_is_firm_member("firmId",current_setting('app.user_id', true)));
ALTER TABLE chart_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chart_templates_firm_scope ON chart_templates;
CREATE POLICY chart_templates_firm_scope ON chart_templates FOR ALL
  USING ("firmId"=current_setting('app.firm_id', true) AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member("firmId",current_setting('app.user_id', true)))
  WITH CHECK ("firmId"=current_setting('app.firm_id', true) AND current_setting('app.actor_kind', true)<>'PORTAL' AND app_is_firm_member("firmId",current_setting('app.user_id', true)));

DO $$
DECLARE row record; pol record;
BEGIN
  FOR row IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name NOT IN ('clients','audit_events','portal_memberships','portal_invitations')
  LOOP
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=row.table_name AND policyname LIKE 'tenant_%' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I',pol.policyname,row.table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT USING (app_can_access_tenant("firmId","clientId"))',row.table_name);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId"))',row.table_name);
    EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId")) WITH CHECK (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId"))',row.table_name);
    EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING (current_setting(''app.actor_kind'',true)<>''PORTAL'' AND app_can_access_tenant("firmId","clientId"))',row.table_name);
  END LOOP;
END $$;
