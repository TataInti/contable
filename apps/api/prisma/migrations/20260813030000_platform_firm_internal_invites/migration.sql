-- Narrow SECURITY DEFINER entry points for platform provisioning and internal invitations.

CREATE OR REPLACE FUNCTION app_create_firm_for_owner(
  target_actor_id text,
  target_legal_name text,
  target_display_name text,
  target_tax_id text
) RETURNS TABLE(id text, "legalName" text, "displayName" text, "taxId" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE created firms%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE users.id=target_actor_id AND "isPlatformAdmin"=true AND status='ACTIVE') THEN
    RETURN;
  END IF;
  INSERT INTO firms (id, "legalName", "displayName", "taxId", status, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, target_legal_name, target_display_name, target_tax_id, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING * INTO created;
  INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "acceptedAt")
  VALUES (gen_random_uuid()::text, created.id, target_actor_id, 'OWNER', 'ACTIVE', CURRENT_TIMESTAMP);
  RETURN QUERY SELECT created.id, created."legalName", created."displayName", created."taxId";
END $$;

CREATE OR REPLACE FUNCTION app_invite_internal_member(
  target_actor_id text,
  target_firm_id text,
  target_email text,
  target_role "FirmRole"
) RETURNS TABLE(id text, "userId" text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_user_id text;
DECLARE created firm_memberships%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM firm_memberships
    WHERE "firmId"=target_firm_id AND "userId"=target_actor_id AND status='ACTIVE' AND role IN ('OWNER','ADMIN')
  ) THEN RETURN; END IF;
  SELECT users.id INTO target_user_id FROM users WHERE "emailNormalized"=lower(target_email) AND users.status='ACTIVE';
  IF target_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "invitedBy")
  VALUES (gen_random_uuid()::text, target_firm_id, target_user_id, target_role, 'INVITED', target_actor_id)
  ON CONFLICT ("firmId", "userId") DO UPDATE SET role=EXCLUDED.role, status='INVITED', "invitedBy"=target_actor_id, "acceptedAt"=NULL
  RETURNING * INTO created;
  RETURN QUERY SELECT created.id, created."userId", created.status::text;
END $$;

CREATE OR REPLACE FUNCTION app_pending_internal_invitations(target_user_id text)
RETURNS TABLE("firmId" text, "firmName" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f."displayName", fm.role::text
  FROM firm_memberships fm JOIN firms f ON f.id=fm."firmId"
  WHERE fm."userId"=target_user_id AND fm.status='INVITED'
$$;

CREATE OR REPLACE FUNCTION app_accept_internal_invitation(target_user_id text, target_firm_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE firm_memberships SET status='ACTIVE', "acceptedAt"=CURRENT_TIMESTAMP
  WHERE "userId"=target_user_id AND "firmId"=target_firm_id AND status='INVITED';
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION app_create_firm_for_owner(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_invite_internal_member(text,text,text,"FirmRole") FROM PUBLIC;
REVOKE ALL ON FUNCTION app_pending_internal_invitations(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_accept_internal_invitation(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_create_firm_for_owner(text,text,text,text),
    app_invite_internal_member(text,text,text,"FirmRole"),
    app_pending_internal_invitations(text), app_accept_internal_invitation(text,text)
  TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
