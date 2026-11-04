-- ============================================================
-- Recuperación segura de acceso para miembros internos, iniciada por un
-- administrador desde la UI (corte de renovación de claves, pedido por Inti).
--
-- Modelo (corte mínimo, sin email transaccional):
--   * El admin genera, para un miembro interno, un token de un solo uso con
--     caducidad corta. El token se muestra UNA vez en la UI y se entrega por
--     un canal seguro (el gestor nunca ve ni define la contraseña: la define
--     el propio usuario con el enlace).
--   * En la base sólo se guarda el hash SHA-256 del token (patrón
--     portal_invitations). No existe columna de token en claro.
--   * Al crear el token se revocan todas las sesiones activas del usuario
--     (device_sessions.revokedAt) y se invalidan los tokens pendientes
--     anteriores (sólo vale el último emitido).
--   * El canje (app_redeem_member_access_recovery) reclama el token
--     atómicamente (UPDATE con usedAt IS NULL), fija la nueva contraseña
--     (hash Argon2id generado en la capa de aplicación), vuelve a revocar
--     sesiones por defensa en profundidad y audita. Falla genérica
--     RECOVERY_INVALID para inexistente/usado/expirado/revocado/usuario no
--     activo: sin oráculo de estados.
--   * Auditoría actor/acción sin datos sensibles (nunca el token ni su hash
--     ni contraseñas).
--
-- Nota RLS: la tabla no otorga privilegios a contable_runtime; todo el
-- acceso es vía funciones SECURITY DEFINER (igual que el resto del ciclo
-- de vida de miembros). FORCE RLS sin policies = denegación para cualquier
-- otro camino distinto de las funciones.
-- ============================================================

-- CreateTable
CREATE TABLE "member_access_recoveries" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_access_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_access_recoveries_tokenHash_key" ON "member_access_recoveries"("tokenHash");

-- CreateIndex
CREATE INDEX "member_access_recoveries_firmId_idx" ON "member_access_recoveries"("firmId");
CREATE INDEX "member_access_recoveries_userId_idx" ON "member_access_recoveries"("userId");

-- AddForeignKey
ALTER TABLE "member_access_recoveries" ADD CONSTRAINT "member_access_recoveries_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_access_recoveries" ADD CONSTRAINT "member_access_recoveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "member_access_recoveries" ADD CONSTRAINT "member_access_recoveries_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS (ADR-006): sin grants al runtime y sin policies: el único camino son
-- las funciones SECURITY DEFINER de abajo.
ALTER TABLE "member_access_recoveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_access_recoveries" FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------
-- Emisión del token de recuperación por parte de un administrador.
-- Reutiliza app_assert_member_target (actor OWNER/ADMIN activo, sin
-- auto-objetivo) y la regla OWNER-protegido de la reactivación: un ADMIN
-- no emite recuperación para un OWNER; sólo otro OWNER lo hace.
-- El usuario objetivo debe estar ACTIVE (para un suspendido el camino es
-- reactivar primero). Revoca tokens pendientes previos y sesiones activas.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_create_member_access_recovery(
  target_actor_id text,
  target_firm_id text,
  target_user_id text,
  target_token_hash text,
  target_ttl_minutes int DEFAULT 30
) RETURNS TABLE("recoveryId" text, "expiresAt" timestamptz, "sessionsRevoked" int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_role "FirmRole";
  membership_id text;
  new_recovery_id text;
  new_expires_at timestamptz;
  sessions_revoked int;
BEGIN
  IF target_ttl_minutes < 5 OR target_ttl_minutes > 1440 THEN
    RAISE EXCEPTION 'RECOVERY_TTL_INVALID';
  END IF;

  -- Serializa operaciones de administración concurrentes sobre la firma.
  PERFORM pg_advisory_xact_lock(hashtext('firm_admin:' || target_firm_id));

  target_role := app_assert_member_target(target_actor_id, target_firm_id, target_user_id);

  IF target_role = 'OWNER'
    AND app_actor_is_admin_only(target_actor_id, target_firm_id) THEN
    RAISE EXCEPTION 'OWNER_PROTECTED';
  END IF;

  SELECT fm.id INTO membership_id
  FROM firm_memberships fm
  JOIN users u ON u.id = fm."userId"
  WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id
    AND fm.status = 'ACTIVE' AND u.status = 'ACTIVE';
  IF membership_id IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_TARGET_NOT_ACTIVE';
  END IF;

  -- Sólo vale el último token emitido: los pendientes anteriores se invalidan.
  UPDATE member_access_recoveries SET "revokedAt" = CURRENT_TIMESTAMP
    WHERE member_access_recoveries."userId" = target_user_id
      AND member_access_recoveries."usedAt" IS NULL
      AND member_access_recoveries."revokedAt" IS NULL;

  -- El corte de acceso no depende de la expiración del access token.
  UPDATE device_sessions SET "revokedAt" = CURRENT_TIMESTAMP
    WHERE device_sessions."userId" = target_user_id
      AND device_sessions."revokedAt" IS NULL;
  GET DIAGNOSTICS sessions_revoked = ROW_COUNT;

  new_expires_at := CURRENT_TIMESTAMP + make_interval(mins => target_ttl_minutes);
  INSERT INTO member_access_recoveries
    (id, "firmId", "userId", "requestedByUserId", "tokenHash", "expiresAt")
  VALUES
    (gen_random_uuid()::text, target_firm_id, target_user_id, target_actor_id,
     target_token_hash, new_expires_at)
  RETURNING member_access_recoveries.id INTO new_recovery_id;

  -- Auditoría actor/acción sin datos sensibles (nunca el token ni su hash).
  INSERT INTO audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", after)
  VALUES
    (gen_random_uuid()::text, target_firm_id, target_actor_id, 'USER',
     'internal_member.access_recovery_requested', 'MemberAccessRecovery', new_recovery_id,
     jsonb_build_object('targetUserId', target_user_id, 'expiresAt', new_expires_at,
       'sessionsRevoked', sessions_revoked));

  RETURN QUERY SELECT new_recovery_id, new_expires_at, sessions_revoked;
END $$;

-- ------------------------------------------------------------------
-- Revocación explícita de un token pendiente por parte del administrador
-- (por ejemplo, si se generó por error o se filtró el enlace). Sólo tokens
-- pendientes (no usados, no revocados, no expirados).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_revoke_member_access_recovery(
  target_actor_id text,
  target_firm_id text,
  target_recovery_id text,
  target_reason text DEFAULT NULL
) RETURNS TABLE("recoveryId" text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pending_id text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('firm_admin:' || target_firm_id));

  IF NOT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId" = target_firm_id AND fm."userId" = target_actor_id
      AND fm.status = 'ACTIVE' AND fm.role IN ('OWNER', 'ADMIN')
  ) THEN
    RAISE EXCEPTION 'MEMBER_ACTOR_REQUIRED';
  END IF;

  SELECT member_access_recoveries.id INTO pending_id
  FROM member_access_recoveries
  WHERE member_access_recoveries.id = target_recovery_id
    AND member_access_recoveries."firmId" = target_firm_id;
  IF pending_id IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_NOT_FOUND';
  END IF;

  UPDATE member_access_recoveries SET "revokedAt" = CURRENT_TIMESTAMP
    WHERE member_access_recoveries.id = pending_id
      AND member_access_recoveries."usedAt" IS NULL
      AND member_access_recoveries."revokedAt" IS NULL
      AND member_access_recoveries."expiresAt" > CURRENT_TIMESTAMP;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECOVERY_NOT_ACTIVE';
  END IF;

  INSERT INTO audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", after)
  VALUES
    (gen_random_uuid()::text, target_firm_id, target_actor_id, 'USER',
     'internal_member.access_recovery_revoked', 'MemberAccessRecovery', pending_id,
     jsonb_build_object('reason', left(COALESCE(target_reason, ''), 500)));

  RETURN QUERY SELECT pending_id, 'REVOKED'::text;
END $$;

-- ------------------------------------------------------------------
-- Canje del token (lo usa el propio miembro desde la página pública).
-- No lleva actor: la credencial es el token. Reclamo atómico de un solo uso
-- (UPDATE con usedAt IS NULL dentro de la misma transacción), caducidad y
-- revocación verificadas en la misma sentencia. Falla genérica
-- RECOVERY_INVALID (sin distinguir causa: sin oráculo de estados).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_redeem_member_access_recovery(
  target_token_hash text,
  target_password_hash text
) RETURNS TABLE("userId" text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claimed record;
  user_status text;
BEGIN
  UPDATE member_access_recoveries SET "usedAt" = CURRENT_TIMESTAMP
    WHERE member_access_recoveries."tokenHash" = target_token_hash
      AND member_access_recoveries."usedAt" IS NULL
      AND member_access_recoveries."revokedAt" IS NULL
      AND member_access_recoveries."expiresAt" > CURRENT_TIMESTAMP
    RETURNING member_access_recoveries.id, member_access_recoveries."userId",
              member_access_recoveries."firmId"
    INTO claimed;

  IF claimed IS NULL THEN
    RAISE EXCEPTION 'RECOVERY_INVALID';
  END IF;

  -- Un miembro suspendido no recupera acceso canjeando el token: el camino
  -- es la reactivación explícita del administrador.
  SELECT users.status INTO user_status FROM users WHERE users.id = claimed."userId";
  IF user_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'RECOVERY_INVALID';
  END IF;

  UPDATE users
    SET "passwordHash" = target_password_hash,
        "mustChangePassword" = false,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE users.id = claimed."userId";

  -- Defensa en profundidad: cortar cualquier sesión creada entre la emisión
  -- y el canje (en la emisión ya se revocaron todas).
  UPDATE device_sessions SET "revokedAt" = CURRENT_TIMESTAMP
    WHERE device_sessions."userId" = claimed."userId"
      AND device_sessions."revokedAt" IS NULL;

  -- Auditoría sin datos sensibles: actor = el propio usuario que canjea.
  INSERT INTO audit_events
    (id, "firmId", "userId", "actorKind", action, "entityType", "entityId", after)
  VALUES
    (gen_random_uuid()::text, claimed."firmId", claimed."userId", 'USER',
     'internal_member.access_recovered', 'MemberAccessRecovery', claimed.id,
     jsonb_build_object('via', 'admin_recovery'));

  RETURN QUERY SELECT claimed."userId", 'OK'::text;
END $$;

REVOKE ALL ON FUNCTION app_create_member_access_recovery(text, text, text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_revoke_member_access_recovery(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_redeem_member_access_recovery(text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_create_member_access_recovery(text, text, text, text, int) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_revoke_member_access_recovery(text, text, text, text) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_redeem_member_access_recovery(text, text) TO contable_runtime;
