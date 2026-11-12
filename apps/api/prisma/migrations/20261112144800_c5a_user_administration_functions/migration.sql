-- C5a: mutaciones de usuarios, firma y accesos del portal.
-- Las funciones son acotadas al estudio del contexto autenticado. La migración
-- no cambia el esquema ni transforma filas existentes.

CREATE FUNCTION app_c5a_update_member_identity(
  p_actor_id text,
  p_firm_id text,
  p_user_id text,
  p_name text,
  p_email text
) RETURNS TABLE("userId" text, name text, "emailNormalized" text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  old_name text;
  old_email text;
  new_name text;
  normalized_email text;
BEGIN
  IF current_setting('app.user_id', true) IS DISTINCT FROM p_actor_id
     OR current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.actor_kind', true) IS DISTINCT FROM 'USER'
     OR NOT EXISTS (
       SELECT 1
       FROM public.firm_memberships actor_membership
       JOIN public.users actor ON actor.id = actor_membership."userId"
       WHERE actor_membership."firmId" = p_firm_id
         AND actor_membership."userId" = p_actor_id
         AND actor_membership.status = 'ACTIVE'
         AND actor_membership.role IN ('OWNER', 'ADMIN')
         AND actor.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT member.name, member."emailNormalized"
  INTO old_name, old_email
  FROM public.users member
  JOIN public.firm_memberships membership
    ON membership."userId" = member.id
  WHERE member.id = p_user_id
    AND membership."firmId" = p_firm_id
    AND membership.status IN ('INVITED', 'ACTIVE', 'SUSPENDED')
  FOR UPDATE OF member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  new_name := COALESCE(p_name, old_name);
  normalized_email := COALESCE(lower(p_email), old_email);

  IF p_email IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.users other_user
    WHERE other_user."emailNormalized" = normalized_email
      AND other_user.id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'USER_EMAIL_CONFLICT' USING ERRCODE = '23505';
  END IF;

  BEGIN
    UPDATE public.users AS member
    SET name = new_name,
        "emailNormalized" = normalized_email,
        "updatedAt" = now()
    WHERE member.id = p_user_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'USER_EMAIL_CONFLICT' USING ERRCODE = '23505';
  END;

  INSERT INTO public.audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", before, after)
  VALUES
    (gen_random_uuid()::text, p_firm_id, p_actor_id, 'USER',
     'internal_user.identity_updated', 'User', p_user_id,
     jsonb_build_object('name', old_name, 'emailNormalized', '[REDACTED]'),
     jsonb_build_object('name', new_name, 'emailNormalized', '[REDACTED]'));

  RETURN QUERY SELECT p_user_id, new_name, normalized_email;
END $$;

CREATE FUNCTION app_c5a_update_firm_profile(
  p_actor_id text,
  p_firm_id text,
  p_patch jsonb
) RETURNS TABLE("legalName" text, "displayName" text, "taxId" text, timezone text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  old_legal_name text;
  old_display_name text;
  old_tax_id text;
  old_timezone text;
  new_legal_name text;
  new_display_name text;
  new_tax_id text;
  new_timezone text;
BEGIN
  IF current_setting('app.user_id', true) IS DISTINCT FROM p_actor_id
     OR current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.actor_kind', true) IS DISTINCT FROM 'USER'
     OR NOT EXISTS (
       SELECT 1
       FROM public.firm_memberships actor_membership
       JOIN public.users actor ON actor.id = actor_membership."userId"
       WHERE actor_membership."firmId" = p_firm_id
         AND actor_membership."userId" = p_actor_id
         AND actor_membership.status = 'ACTIVE'
         AND actor_membership.role IN ('OWNER', 'ADMIN')
         AND actor.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object'
     OR p_patch = '{}'::jsonb
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(p_patch) AS patch_key
       WHERE patch_key NOT IN ('legalName', 'displayName', 'taxId', 'timezone')
     ) THEN
    RAISE EXCEPTION 'FIRM_PROFILE_PATCH_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT firm."legalName", firm."displayName", firm."taxId", firm.timezone
  INTO old_legal_name, old_display_name, old_tax_id, old_timezone
  FROM public.firms firm
  WHERE firm.id = p_firm_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FIRM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  new_legal_name := CASE WHEN p_patch ? 'legalName' THEN p_patch->>'legalName' ELSE old_legal_name END;
  new_display_name := CASE WHEN p_patch ? 'displayName' THEN p_patch->>'displayName' ELSE old_display_name END;
  new_tax_id := CASE WHEN p_patch ? 'taxId' THEN p_patch->>'taxId' ELSE old_tax_id END;
  new_timezone := CASE WHEN p_patch ? 'timezone' THEN p_patch->>'timezone' ELSE old_timezone END;

  UPDATE public.firms AS firm
  SET "legalName" = new_legal_name,
      "displayName" = new_display_name,
      "taxId" = new_tax_id,
      timezone = new_timezone,
      "updatedAt" = now()
  WHERE firm.id = p_firm_id;

  INSERT INTO public.audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", before, after)
  VALUES
    (gen_random_uuid()::text, p_firm_id, p_actor_id, 'USER',
     'firm.profile_updated', 'Firm', p_firm_id,
     jsonb_build_object('legalName', old_legal_name, 'displayName', old_display_name,
       'taxId', '[REDACTED]', 'timezone', old_timezone),
     jsonb_build_object('legalName', new_legal_name, 'displayName', new_display_name,
       'taxId', '[REDACTED]', 'timezone', new_timezone));

  RETURN QUERY SELECT new_legal_name, new_display_name, new_tax_id, new_timezone;
END $$;

CREATE FUNCTION app_c5a_change_internal_member_role(
  p_actor_id text,
  p_firm_id text,
  p_user_id text,
  p_new_role "FirmRole"
) RETURNS TABLE("userId" text, "membershipId" text, role text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  old_role "FirmRole";
  membership_id text;
  membership_status text;
  member_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('firm_admin:' || p_firm_id));

  IF current_setting('app.user_id', true) IS DISTINCT FROM p_actor_id
     OR current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.actor_kind', true) IS DISTINCT FROM 'USER'
     OR NOT EXISTS (
       SELECT 1
       FROM public.firm_memberships actor_membership
       JOIN public.users actor ON actor.id = actor_membership."userId"
       WHERE actor_membership."firmId" = p_firm_id
         AND actor_membership."userId" = p_actor_id
         AND actor_membership.status = 'ACTIVE'
         AND actor_membership.role IN ('OWNER', 'ADMIN')
         AND actor.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT membership.id, membership.role, membership.status::text, member.status::text
  INTO membership_id, old_role, membership_status, member_status
  FROM public.firm_memberships membership
  JOIN public.users member ON member.id = membership."userId"
  WHERE membership."firmId" = p_firm_id
    AND membership."userId" = p_user_id
  FOR UPDATE OF membership, member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF old_role = p_new_role THEN
    RETURN QUERY SELECT p_user_id, membership_id, p_new_role::text, 'UNCHANGED'::text;
    RETURN;
  END IF;

  IF membership_status = 'ACTIVE'
     AND member_status = 'ACTIVE'
     AND old_role IN ('OWNER', 'ADMIN')
     AND p_new_role NOT IN ('OWNER', 'ADMIN')
     AND public.app_active_admin_count(p_firm_id, p_user_id) < 1 THEN
    RAISE EXCEPTION 'LAST_ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.firm_memberships AS membership
  SET role = p_new_role
  WHERE membership.id = membership_id;

  IF membership_status = 'ACTIVE'
     AND member_status = 'ACTIVE'
     AND old_role IN ('OWNER', 'ADMIN')
     AND p_new_role NOT IN ('OWNER', 'ADMIN') THEN
    UPDATE public.device_sessions AS session
    SET "revokedAt" = now()
    WHERE session."userId" = p_user_id
      AND session."revokedAt" IS NULL;
  END IF;

  INSERT INTO public.audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", before, after)
  VALUES
    (gen_random_uuid()::text, p_firm_id, p_actor_id, 'USER',
     'internal_member.role_changed', 'FirmMembership', membership_id,
     jsonb_build_object('role', old_role::text),
     jsonb_build_object('role', p_new_role::text));

  RETURN QUERY SELECT p_user_id, membership_id, p_new_role::text, 'CHANGED'::text;
END $$;

CREATE FUNCTION app_c5a_set_internal_member_status(
  p_actor_id text,
  p_firm_id text,
  p_user_id text,
  p_new_status "MembershipStatus"
) RETURNS TABLE("userId" text, "membershipId" text, status text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target_role "FirmRole";
  old_membership_status text;
  old_user_status text;
  membership_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('firm_admin:' || p_firm_id));

  IF current_setting('app.user_id', true) IS DISTINCT FROM p_actor_id
     OR current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.actor_kind', true) IS DISTINCT FROM 'USER'
     OR NOT EXISTS (
       SELECT 1
       FROM public.firm_memberships actor_membership
       JOIN public.users actor ON actor.id = actor_membership."userId"
       WHERE actor_membership."firmId" = p_firm_id
         AND actor_membership."userId" = p_actor_id
         AND actor_membership.status = 'ACTIVE'
         AND actor_membership.role IN ('OWNER', 'ADMIN')
         AND actor.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_new_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'MEMBER_STATUS_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT membership.id, membership.role, membership.status::text, member.status::text
  INTO membership_id, target_role, old_membership_status, old_user_status
  FROM public.firm_memberships membership
  JOIN public.users member ON member.id = membership."userId"
  WHERE membership."firmId" = p_firm_id
    AND membership."userId" = p_user_id
  FOR UPDATE OF membership, member;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF old_membership_status = p_new_status::text AND old_user_status = p_new_status::text THEN
    RETURN QUERY SELECT p_user_id, membership_id, p_new_status::text, 'UNCHANGED'::text;
    RETURN;
  END IF;

  IF p_new_status = 'SUSPENDED'
     AND old_membership_status = 'ACTIVE'
     AND old_user_status = 'ACTIVE'
     AND target_role IN ('OWNER', 'ADMIN')
     AND public.app_active_admin_count(p_firm_id, p_user_id) < 1 THEN
    RAISE EXCEPTION 'LAST_ADMIN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.users AS member
  SET status = p_new_status::text::"UserStatus",
      "updatedAt" = now()
  WHERE member.id = p_user_id;

  UPDATE public.firm_memberships AS membership
  SET status = p_new_status
  WHERE membership.id = membership_id;

  IF p_new_status = 'SUSPENDED' THEN
    UPDATE public.device_sessions AS session
    SET "revokedAt" = now()
    WHERE session."userId" = p_user_id
      AND session."revokedAt" IS NULL;
  END IF;

  INSERT INTO public.audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", before, after)
  VALUES
    (gen_random_uuid()::text, p_firm_id, p_actor_id, 'USER',
     CASE WHEN p_new_status = 'SUSPENDED' THEN 'internal_member.suspended' ELSE 'internal_member.reactivated' END,
     'FirmMembership', membership_id,
     jsonb_build_object('role', target_role::text, 'membershipStatus', old_membership_status,
       'userStatus', old_user_status),
     jsonb_build_object('role', target_role::text, 'membershipStatus', p_new_status::text,
       'userStatus', p_new_status::text));

  RETURN QUERY SELECT p_user_id, membership_id, p_new_status::text, 'CHANGED'::text;
END $$;

CREATE FUNCTION app_c5a_update_portal_membership(
  p_actor_id text,
  p_firm_id text,
  p_client_id text,
  p_membership_id text,
  p_new_role "PortalRole",
  p_new_status "MembershipStatus"
) RETURNS TABLE(id text, role text, status text, "revokedAt" timestamptz, outcome text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target_user_id text;
  old_role "PortalRole";
  old_status "MembershipStatus";
  old_revoked_at timestamptz;
  next_role "PortalRole";
  next_status "MembershipStatus";
  next_revoked_at timestamptz;
BEGIN
  IF current_setting('app.user_id', true) IS DISTINCT FROM p_actor_id
     OR current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.client_id', true) IS DISTINCT FROM p_client_id
     OR current_setting('app.actor_kind', true) IS DISTINCT FROM 'USER'
     OR NOT EXISTS (
       SELECT 1
       FROM public.firm_memberships actor_membership
       JOIN public.users actor ON actor.id = actor_membership."userId"
       WHERE actor_membership."firmId" = p_firm_id
         AND actor_membership."userId" = p_actor_id
         AND actor_membership.status = 'ACTIVE'
         AND actor_membership.role IN ('OWNER', 'ADMIN')
         AND actor.status = 'ACTIVE'
     ) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_new_role IS NULL AND p_new_status IS NULL THEN
    RAISE EXCEPTION 'PORTAL_MEMBERSHIP_PATCH_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_new_status IS NOT NULL AND p_new_status NOT IN ('ACTIVE', 'SUSPENDED') THEN
    RAISE EXCEPTION 'PORTAL_MEMBERSHIP_STATUS_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT membership."userId", membership.role, membership.status, membership."revokedAt"
  INTO target_user_id, old_role, old_status, old_revoked_at
  FROM public.portal_memberships membership
  WHERE membership.id = p_membership_id
    AND membership."firmId" = p_firm_id
    AND membership."clientId" = p_client_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PORTAL_MEMBERSHIP_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  next_role := COALESCE(p_new_role, old_role);
  next_status := COALESCE(p_new_status, old_status);
  next_revoked_at := CASE
    WHEN p_new_status = 'ACTIVE' THEN NULL
    WHEN p_new_status = 'SUSPENDED' THEN now()
    ELSE old_revoked_at
  END;

  IF next_role = old_role AND next_status = old_status AND next_revoked_at IS NOT DISTINCT FROM old_revoked_at THEN
    RETURN QUERY SELECT p_membership_id, old_role::text, old_status::text, old_revoked_at, 'UNCHANGED'::text;
    RETURN;
  END IF;

  UPDATE public.portal_memberships AS membership
  SET role = next_role,
      status = next_status,
      "revokedAt" = next_revoked_at
  WHERE membership.id = p_membership_id;

  UPDATE public.device_sessions AS session
  SET "revokedAt" = now()
  WHERE session."userId" = target_user_id
    AND session."revokedAt" IS NULL;

  INSERT INTO public.audit_events
    (id, "firmId", "clientId", "userId", "actorKind", action, "entityType", "entityId", before, after)
  VALUES
    (gen_random_uuid()::text, p_firm_id, p_client_id, p_actor_id, 'USER',
     'portal.membership.updated', 'PortalMembership', p_membership_id,
     jsonb_build_object('role', old_role::text, 'status', old_status::text, 'revokedAt', old_revoked_at),
     jsonb_build_object('role', next_role::text, 'status', next_status::text, 'revokedAt', next_revoked_at));

  RETURN QUERY SELECT p_membership_id, next_role::text, next_status::text, next_revoked_at, 'CHANGED'::text;
END $$;

REVOKE ALL ON FUNCTION app_c5a_update_member_identity(text, text, text, text, text) FROM PUBLIC, contable_worker;
REVOKE ALL ON FUNCTION app_c5a_update_firm_profile(text, text, jsonb) FROM PUBLIC, contable_worker;
REVOKE ALL ON FUNCTION app_c5a_change_internal_member_role(text, text, text, "FirmRole") FROM PUBLIC, contable_worker;
REVOKE ALL ON FUNCTION app_c5a_set_internal_member_status(text, text, text, "MembershipStatus") FROM PUBLIC, contable_worker;
REVOKE ALL ON FUNCTION app_c5a_update_portal_membership(text, text, text, text, "PortalRole", "MembershipStatus") FROM PUBLIC, contable_worker;

GRANT EXECUTE ON FUNCTION app_c5a_update_member_identity(text, text, text, text, text) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_c5a_update_firm_profile(text, text, jsonb) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_c5a_change_internal_member_role(text, text, text, "FirmRole") TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_c5a_set_internal_member_status(text, text, text, "MembershipStatus") TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_c5a_update_portal_membership(text, text, text, text, "PortalRole", "MembershipStatus") TO contable_runtime;
