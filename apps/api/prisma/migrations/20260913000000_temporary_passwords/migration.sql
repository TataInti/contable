ALTER TABLE users ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION app_create_internal_user(
  target_actor_id text, target_firm_id text, target_email text,
  target_name text, target_password_hash text, target_role "FirmRole"
) RETURNS TABLE("userId" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE created_id text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM firm_memberships fm JOIN users actor ON actor.id = fm."userId"
    WHERE fm."firmId" = target_firm_id AND fm."userId" = target_actor_id
      AND fm.status = 'ACTIVE' AND fm.role IN ('OWNER', 'ADMIN')
      AND actor.status = 'ACTIVE' AND actor."mustChangePassword" = false
  ) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE "emailNormalized" = lower(trim(target_email))) THEN
    RAISE EXCEPTION 'USER_EXISTS' USING ERRCODE = '23505';
  END IF;
  INSERT INTO users (id, "emailNormalized", name, "passwordHash", "mustChangePassword", status, "createdAt", "updatedAt")
  VALUES (gen_random_uuid()::text, lower(trim(target_email)), trim(target_name), target_password_hash, true, 'ACTIVE', now(), now())
  RETURNING id INTO created_id;
  INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "invitedBy", "acceptedAt")
  VALUES (gen_random_uuid()::text, target_firm_id, created_id, target_role, 'ACTIVE', target_actor_id, now());
  RETURN QUERY SELECT created_id;
END $$;

REVOKE ALL ON FUNCTION app_create_internal_user(text,text,text,text,text,"FirmRole") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_internal_user(text,text,text,text,text,"FirmRole") TO contable_runtime;
