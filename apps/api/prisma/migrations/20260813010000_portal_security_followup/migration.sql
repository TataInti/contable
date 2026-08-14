-- Follow-up kept separate because security_integration may already be deployed.
CREATE OR REPLACE FUNCTION app_portal_contexts(target_user_id text)
RETURNS TABLE("firmId" text, "firmName" text, "clientId" text, "clientName" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f."displayName", c.id, c."legalName", pm.role::text
  FROM portal_memberships pm
  JOIN firms f ON f.id=pm."firmId" JOIN clients c ON c.id=pm."clientId" AND c."firmId"=pm."firmId"
  WHERE pm."userId"=target_user_id AND pm.status='ACTIVE' AND pm."revokedAt" IS NULL
  ORDER BY f."displayName", c."legalName"
$$;
CREATE OR REPLACE FUNCTION app_resolve_portal_membership(target_user_id text, target_client_id text)
RETURNS TABLE("firmId" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pm."firmId", pm.role::text FROM portal_memberships pm
  WHERE pm."userId"=target_user_id AND pm."clientId"=target_client_id
    AND pm.status='ACTIVE' AND pm."revokedAt" IS NULL LIMIT 1
$$;
REVOKE ALL ON FUNCTION app_portal_contexts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_portal_membership(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_portal_contexts(text), app_resolve_portal_membership(text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['upload_sessions','documents','document_file_versions',
    'document_processing_jobs','outbox_events','request_messages']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS portal_collaboration_write ON %I', table_name);
    EXECUTE format('CREATE POLICY portal_collaboration_write ON %I FOR ALL USING (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true))) WITH CHECK (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true)))', table_name);
  END LOOP;
END $$;
DROP POLICY IF EXISTS audit_events_portal_insert ON audit_events;
CREATE POLICY audit_events_portal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true)='PORTAL'
  AND app_is_portal_client_member("firmId", "clientId", current_setting('app.user_id', true))
);
