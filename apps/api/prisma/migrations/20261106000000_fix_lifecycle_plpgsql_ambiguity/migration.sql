-- ============================================================
-- Bugfix del corte F2 (20261105000000_user_lifecycle_administration).
--
-- Los RETURNS TABLE("userId", "membershipId", "status"/"role") declaran
-- variables PL/pgSQL cuyo nombre colisiona con columnas del cuerpo. Cualquier
-- referencia NO calificada a esas columnas en los UPDATE internos falla con
-- `column reference "userId" is ambiguous`, verificado empíricamente contra
-- PostgreSQL 18 con la migración aplicada:
--   * app_suspend_internal_member: falla SIEMPRE (UPDATE firm_memberships y
--     UPDATE device_sessions con "userId" sin calificar): la suspensión
--     quedaba en 500 sin aplicar nada.
--   * app_change_internal_member_role: falla exactamente en la rama que
--     revoca device_sessions al degradar un OWNER/ADMIN (el camino crítico
--     de seguridad quedaba roto; el caso no-degradante pasaba los tests).
--   * app_reactivate_internal_member: mismo patrón en su UPDATE final.
-- Los tests estructurales (grep sobre el texto de la migración) no alcanzan
-- para atrapar esto; la corrección se verifica con pruebas de integración.
--
-- Fix mínimo: calificar las columnas con el nombre de la tabla en todos los
-- UPDATE de los tres cuerpos. CREATE OR REPLACE preserva los GRANT otorgados
-- en la migración original.
-- ============================================================

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

  UPDATE users SET status = 'SUSPENDED', "updatedAt" = now() WHERE users.id = target_user_id;
  UPDATE firm_memberships SET status = 'SUSPENDED'
    WHERE firm_memberships.id = membership_id
      AND firm_memberships."firmId" = target_firm_id
      AND firm_memberships."userId" = target_user_id;
  UPDATE device_sessions SET "revokedAt" = now()
    WHERE device_sessions."userId" = target_user_id AND device_sessions."revokedAt" IS NULL;

  PERFORM app_record_member_lifecycle_audit(
    target_firm_id, target_actor_id, membership_id,
    'internal_member.suspended',
    jsonb_build_object('role', target_role, 'userStatus', 'ACTIVE', 'membershipStatus', 'ACTIVE'),
    jsonb_build_object('role', target_role, 'userStatus', 'SUSPENDED', 'membershipStatus', 'SUSPENDED',
      'reason', left(COALESCE(target_reason, ''), 500))
  );

  RETURN QUERY SELECT target_user_id, membership_id, 'SUSPENDED'::text;
END $$;

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

  UPDATE users SET status = 'ACTIVE', "updatedAt" = now() WHERE users.id = target_user_id;
  UPDATE firm_memberships SET status = 'ACTIVE'
    WHERE firm_memberships.id = membership_id
      AND firm_memberships."firmId" = target_firm_id
      AND firm_memberships."userId" = target_user_id;

  PERFORM app_record_member_lifecycle_audit(
    target_firm_id, target_actor_id, membership_id,
    'internal_member.reactivated',
    jsonb_build_object('role', target_role, 'userStatus', 'SUSPENDED', 'membershipStatus', 'SUSPENDED'),
    jsonb_build_object('role', target_role, 'userStatus', 'ACTIVE', 'membershipStatus', 'ACTIVE',
      'reason', left(COALESCE(target_reason, ''), 500))
  );

  RETURN QUERY SELECT target_user_id, membership_id, 'ACTIVE'::text;
END $$;

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

  IF target_role IN ('OWNER', 'ADMIN') AND target_new_role NOT IN ('OWNER', 'ADMIN')
    AND app_active_admin_count(target_firm_id, target_user_id) < 1 THEN
    RAISE EXCEPTION 'LAST_ADMIN_REQUIRED';
  END IF;

  UPDATE firm_memberships SET role = target_new_role WHERE firm_memberships.id = membership_id;

  IF target_role IN ('OWNER', 'ADMIN') AND target_new_role NOT IN ('OWNER', 'ADMIN') THEN
    UPDATE device_sessions SET "revokedAt" = now()
      WHERE device_sessions."userId" = target_user_id AND device_sessions."revokedAt" IS NULL;
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
