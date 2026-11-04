-- F2 (primer corte de administración de usuarios): ciclo de vida de miembros
-- internos con baja reversible (suspensión), reactivación explícita y cambio
-- de rol, siempre con autorización backend y auditoría de actor/acción.
--
-- Principios (informe-usuarios-contable-fase-inicial §4.1/§4.4):
--   * Sin hard-delete: el estado es la baja. No se borra ninguna fila de
--     users / firm_memberships ni su historial.
--   * El guard de último administrador se aplica en suspensión Y en cambio de
--     rol que degrada (OWNER/ADMIN -> otro rol), bajo advisory lock por firma
--     para serializar operaciones concurrentes de administración.
--   * OWNER protegido: nadie puede suspender a un OWNER; un ADMIN no puede
--     modificar (rol) ni reactivar a un OWNER; la transferencia de titularidad
--     es el único camino para cambiar el rol de un OWNER y la hace un OWNER.
--   * Al suspender o degradar se revocan todas las sesiones activas del
--     usuario (device_sessions.revokedAt), de modo que el corte de acceso no
--     depende de la expiración del access token.
--   * Toda operación exitosa deja evento en audit_events (actor = userId del
--     solicitante; entityId = membresía). Los intentos rechazados relevantes
--     los audita la capa de aplicación al mapear el error. La redacción de
--     datos sensibles sigue siendo responsabilidad de AuditRepository; acá
--     sólo se registran rol, estado y motivo.

-- ------------------------------------------------------------------
-- Helper interno: cuenta administradores activos (OWNER/ADMIN con usuario
-- ACTIVE) de la firma, excluyendo opcionalmente al usuario objetivo.
-- Único punto de verdad del guard de último administrador.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_active_admin_count(
  target_firm_id text,
  excluded_user_id text DEFAULT NULL
) RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT count(*)::integer
  FROM firm_memberships fm
  JOIN users u ON u.id = fm."userId"
  WHERE fm."firmId" = target_firm_id
    AND fm.status = 'ACTIVE'
    AND fm.role IN ('OWNER', 'ADMIN')
    AND u.status = 'ACTIVE'
    AND fm."userId" <> COALESCE(excluded_user_id, '')
$$;

-- ------------------------------------------------------------------
-- Helper interno: valida el par actor/objetivo para cualquier operación de
-- administración de miembros. Errores (los mapea la capa de aplicación):
--   MEMBER_ACTOR_REQUIRED  -> el actor no es OWNER/ADMIN activo de la firma
--   MEMBER_NOT_FOUND       -> no existe membresía del objetivo en la firma
--   MEMBER_SELF_TARGET     -> no se puede operar sobre la propia cuenta
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_assert_member_target(
  target_actor_id text,
  target_firm_id text,
  target_user_id text
) RETURNS "FirmRole"
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  actor_role "FirmRole";
  target_role "FirmRole";
BEGIN
  SELECT fm.role INTO actor_role
  FROM firm_memberships fm
  JOIN users u ON u.id = fm."userId"
  WHERE fm."firmId" = target_firm_id AND fm."userId" = target_actor_id
    AND fm.status = 'ACTIVE' AND u.status = 'ACTIVE'
    AND fm.role IN ('OWNER', 'ADMIN');
  IF actor_role IS NULL THEN
    RAISE EXCEPTION 'MEMBER_ACTOR_REQUIRED';
  END IF;
  IF target_actor_id = target_user_id THEN
    RAISE EXCEPTION 'MEMBER_SELF_TARGET';
  END IF;
  SELECT fm.role INTO target_role
  FROM firm_memberships fm
  WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id
    AND fm.status IN ('ACTIVE', 'SUSPENDED');
  IF target_role IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND';
  END IF;
  RETURN target_role;
END $$;

-- ------------------------------------------------------------------
-- Helper interno: el actor es ADMIN pero no OWNER de la firma (regla
-- OWNER-protegido en reactivación: sólo un OWNER reactiva a un OWNER).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_actor_is_admin_only(
  target_actor_id text,
  target_firm_id text
) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId" = target_firm_id AND fm."userId" = target_actor_id
      AND fm.status = 'ACTIVE' AND fm.role = 'OWNER'
  )
$$;

-- ------------------------------------------------------------------
-- Helper interno: escribe el evento de auditoría del ciclo de vida.
-- Sólo registra rol/estado/motivo (sin datos personales; la redacción de
-- datos sensibles la hace la capa de aplicación, patrón AuditRepository).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_record_member_lifecycle_audit(
  target_firm_id text,
  target_actor_id text,
  target_membership_id text,
  target_action text,
  target_before jsonb,
  target_after jsonb
) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  INSERT INTO audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", before, after)
  VALUES
    (gen_random_uuid()::text, target_firm_id, target_actor_id, 'USER',
     target_action, 'FirmMembership', target_membership_id, target_before, target_after)
$$;

-- ------------------------------------------------------------------
-- Suspensión (baja reversible) de un miembro interno.
-- Requiere: actor OWNER/ADMIN activo; objetivo no puede ser OWNER (protegido)
-- ni el propio actor. Si el objetivo es el último ADMIN activo, rechaza con
-- LAST_ADMIN_REQUIRED. Al suspender: users.status=SUSPENDED,
-- firm_memberships.status=SUSPENDED y revoca todas sus sesiones activas.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_suspend_internal_member(
  target_actor_id text,
  target_firm_id text,
  target_user_id text,
  target_reason text DEFAULT NULL
) RETURNS TABLE("userId" text, "membershipId" text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target_role "FirmRole";
  membership_id text;
BEGIN
  -- Serializa operaciones de administración concurrentes sobre la firma.
  PERFORM pg_advisory_xact_lock(hashtext('firm_admin:' || target_firm_id));

  target_role := app_assert_member_target(target_actor_id, target_firm_id, target_user_id);

  IF target_role = 'OWNER' THEN
    RAISE EXCEPTION 'OWNER_PROTECTED';
  END IF;

  SELECT fm.id INTO membership_id
  FROM firm_memberships fm
  WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id
    AND fm.status = 'ACTIVE'
    AND fm.role IN ('ADMIN', 'PREPARER', 'REVIEWER', 'AUDITOR_READONLY');
  IF membership_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_SUSPENDIBLE';
  END IF;

  IF target_role = 'ADMIN'
    AND app_active_admin_count(target_firm_id, target_user_id) < 1 THEN
    RAISE EXCEPTION 'LAST_ADMIN_REQUIRED';
  END IF;

  UPDATE users SET status = 'SUSPENDED', "updatedAt" = now() WHERE id = target_user_id;
  UPDATE firm_memberships SET status = 'SUSPENDED'
    WHERE id = membership_id AND "firmId" = target_firm_id AND "userId" = target_user_id;
  UPDATE device_sessions SET "revokedAt" = now()
    WHERE "userId" = target_user_id AND "revokedAt" IS NULL;

  PERFORM app_record_member_lifecycle_audit(
    target_firm_id, target_actor_id, membership_id,
    'internal_member.suspended',
    jsonb_build_object('role', target_role, 'userStatus', 'ACTIVE', 'membershipStatus', 'ACTIVE'),
    jsonb_build_object('role', target_role, 'userStatus', 'SUSPENDED', 'membershipStatus', 'SUSPENDED',
      'reason', left(COALESCE(target_reason, ''), 500))
  );

  RETURN QUERY SELECT target_user_id, membership_id, 'SUSPENDED'::text;
END $$;

-- ------------------------------------------------------------------
-- Reactivación explícita de un miembro suspendido.
-- Requiere: actor OWNER/ADMIN activo. Un ADMIN no puede reactivar a un OWNER
-- (OWNER protegido): sólo un OWNER reactiva a un OWNER. No re-crea sesiones:
-- el usuario reingresa con login nuevo.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_reactivate_internal_member(
  target_actor_id text,
  target_firm_id text,
  target_user_id text,
  target_reason text DEFAULT NULL
) RETURNS TABLE("userId" text, "membershipId" text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target_role "FirmRole";
  membership_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('firm_admin:' || target_firm_id));

  target_role := app_assert_member_target(target_actor_id, target_firm_id, target_user_id);

  SELECT fm.id INTO membership_id
  FROM firm_memberships fm
  JOIN users u ON u.id = fm."userId"
  WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id
    AND fm.status = 'SUSPENDED' AND u.status = 'SUSPENDED';
  IF membership_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_SUSPENDED';
  END IF;

  IF target_role = 'OWNER'
    AND app_actor_is_admin_only(target_actor_id, target_firm_id) THEN
    RAISE EXCEPTION 'OWNER_PROTECTED';
  END IF;

  UPDATE users SET status = 'ACTIVE', "updatedAt" = now() WHERE id = target_user_id;
  UPDATE firm_memberships SET status = 'ACTIVE'
    WHERE id = membership_id AND "firmId" = target_firm_id AND "userId" = target_user_id;

  PERFORM app_record_member_lifecycle_audit(
    target_firm_id, target_actor_id, membership_id,
    'internal_member.reactivated',
    jsonb_build_object('role', target_role, 'userStatus', 'SUSPENDED', 'membershipStatus', 'SUSPENDED'),
    jsonb_build_object('role', target_role, 'userStatus', 'ACTIVE', 'membershipStatus', 'ACTIVE',
      'reason', left(COALESCE(target_reason, ''), 500))
  );

  RETURN QUERY SELECT target_user_id, membership_id, 'ACTIVE'::text;
END $$;

-- ------------------------------------------------------------------
-- Cambio de rol con guard de último administrador y revocación de sesiones
-- al degradar. Reglas de OWNER:
--   * un ADMIN no puede modificar el rol de un OWNER (OWNER_PROTECTED);
--   * un OWNER sí puede (transferencia de titularidad), con guard de último
--     administrador si el cambio deja a la firma sin OWNER/ADMIN activo.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_change_internal_member_role(
  target_actor_id text,
  target_firm_id text,
  target_user_id text,
  target_new_role "FirmRole",
  target_reason text DEFAULT NULL
) RETURNS TABLE("userId" text, "membershipId" text, role text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  target_role "FirmRole";
  membership_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('firm_admin:' || target_firm_id));

  target_role := app_assert_member_target(target_actor_id, target_firm_id, target_user_id);

  SELECT fm.id INTO membership_id
  FROM firm_memberships fm
  WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id
    AND fm.status IN ('ACTIVE', 'SUSPENDED');
  IF membership_id IS NULL THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND';
  END IF;

  -- Sólo un OWNER puede modificar a un OWNER o asignar el rol OWNER.
  IF (target_role = 'OWNER' OR target_new_role = 'OWNER')
    AND app_actor_is_admin_only(target_actor_id, target_firm_id) THEN
    RAISE EXCEPTION 'OWNER_PROTECTED';
  END IF;

  IF target_role = target_new_role THEN
    RETURN QUERY SELECT target_user_id, membership_id, target_new_role::text, 'UNCHANGED'::text;
    RETURN;
  END IF;

  -- Degradación de OWNER/ADMIN: la firma debe conservar otro administrador
  -- activo (guard de último administrador, excluyendo al objetivo).
  IF target_role IN ('OWNER', 'ADMIN') AND target_new_role NOT IN ('OWNER', 'ADMIN')
    AND app_active_admin_count(target_firm_id, target_user_id) < 1 THEN
    RAISE EXCEPTION 'LAST_ADMIN_REQUIRED';
  END IF;

  UPDATE firm_memberships SET role = target_new_role WHERE id = membership_id;

  -- Degradación: el rol es la fuente de verdad del acceso; al bajarlo se
  -- revocan las sesiones activas para que el nuevo alcance rija de inmediato.
  IF target_role IN ('OWNER', 'ADMIN') AND target_new_role NOT IN ('OWNER', 'ADMIN') THEN
    UPDATE device_sessions SET "revokedAt" = now()
      WHERE "userId" = target_user_id AND "revokedAt" IS NULL;
  END IF;

  PERFORM app_record_member_lifecycle_audit(
    target_firm_id, target_actor_id, membership_id,
    'internal_member.role_changed',
    jsonb_build_object('role', target_role),
    jsonb_build_object('role', target_new_role,
      'reason', left(COALESCE(target_reason, ''), 500))
  );

  RETURN QUERY SELECT target_user_id, membership_id, target_new_role::text, 'CHANGED'::text;
END $$;

REVOKE ALL ON FUNCTION app_active_admin_count(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_assert_member_target(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_actor_is_admin_only(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_record_member_lifecycle_audit(text, text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_suspend_internal_member(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_reactivate_internal_member(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_change_internal_member_role(text, text, text, "FirmRole", text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_suspend_internal_member(text, text, text, text) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_reactivate_internal_member(text, text, text, text) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_change_internal_member_role(text, text, text, "FirmRole", text) TO contable_runtime;
