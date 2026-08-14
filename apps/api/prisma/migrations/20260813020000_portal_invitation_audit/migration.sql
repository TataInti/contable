-- Complete the portal invitation lifecycle and make audit isolation reproducible.

CREATE OR REPLACE FUNCTION app_accept_portal_invitation(
  target_token_hash text,
  target_email text,
  target_name text,
  target_password_hash text
) RETURNS TABLE("userId" text, "firmId" text, "clientId" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  invitation portal_invitations%ROWTYPE;
  target_user users%ROWTYPE;
BEGIN
  SELECT * INTO invitation
  FROM portal_invitations
  WHERE "tokenHash" = target_token_hash
    AND "acceptedAt" IS NULL
    AND "revokedAt" IS NULL
    AND "expiresAt" > CURRENT_TIMESTAMP
  FOR UPDATE;

  IF NOT FOUND OR lower(invitation."emailNormalized") <> lower(target_email) THEN
    RETURN;
  END IF;

  SELECT * INTO target_user FROM users WHERE "emailNormalized" = lower(target_email) FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO users (id, "emailNormalized", name, "passwordHash", status, "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, lower(target_email), target_name, target_password_hash, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING * INTO target_user;
  ELSIF target_user.status <> 'ACTIVE' THEN
    RETURN;
  END IF;

  INSERT INTO portal_memberships (
    id, "firmId", "clientId", "userId", role, status, "invitedBy", "acceptedAt", "createdAt"
  ) VALUES (
    gen_random_uuid()::text, invitation."firmId", invitation."clientId", target_user.id,
    invitation.role, 'ACTIVE', invitation."invitedByUserId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  )
  ON CONFLICT ("firmId", "clientId", "userId") DO UPDATE SET
    role = EXCLUDED.role,
    status = 'ACTIVE',
    "revokedAt" = NULL,
    "acceptedAt" = CURRENT_TIMESTAMP,
    "invitedBy" = EXCLUDED."invitedBy";

  UPDATE portal_invitations SET "acceptedAt" = CURRENT_TIMESTAMP WHERE id = invitation.id;
  RETURN QUERY SELECT target_user.id, invitation."firmId", invitation."clientId";
END $$;

REVOKE ALL ON FUNCTION app_accept_portal_invitation(text,text,text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_accept_portal_invitation(text,text,text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_select ON audit_events;
DROP POLICY IF EXISTS audit_events_internal_insert ON audit_events;
DROP POLICY IF EXISTS audit_events_portal_insert ON audit_events;
CREATE POLICY audit_events_select ON audit_events FOR SELECT USING (
  "firmId" = current_setting('app.firm_id', true)
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);
CREATE POLICY audit_events_internal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true) IN ('USER', 'PLATFORM_ADMIN', 'SYSTEM')
  AND "firmId" = current_setting('app.firm_id', true)
  AND (
    "clientId" IS NULL
    OR NULLIF(current_setting('app.client_id', true), '') IS NULL
    OR "clientId" = current_setting('app.client_id', true)
  )
);
CREATE POLICY audit_events_portal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true)='PORTAL'
  AND app_is_portal_client_member("firmId", "clientId", current_setting('app.user_id', true))
);

DO $$ BEGIN
  GRANT SELECT, INSERT ON audit_events TO contable_runtime;
  REVOKE UPDATE, DELETE ON audit_events FROM contable_runtime, contable_worker;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
