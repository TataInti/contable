-- ============================================================
-- Bugfix: activar el acceso de una persona invitada al portal fallaba SIEMPRE con
-- `column reference "firmId" is ambiguous` (HTTP 500 en POST /portal/invitations/accept).
--
-- El RETURNS TABLE("userId", "firmId", "clientId") declara variables PL/pgSQL con el mismo
-- nombre que las columnas de portal_memberships, y el `ON CONFLICT ("firmId", "clientId",
-- "userId")` del cuerpo no se puede calificar. Mismo patrón que 20261106000000.
--
-- Fix mínimo: la directiva `#variable_conflict use_column` hace que, ante la ambigüedad, gane la
-- columna. El cuerpo no cambia. CREATE OR REPLACE conserva los GRANT de la migración original.
-- ============================================================

CREATE OR REPLACE FUNCTION app_accept_portal_invitation(
  target_token_hash text,
  target_email text,
  target_name text,
  target_password_hash text
) RETURNS TABLE("userId" text, "firmId" text, "clientId" text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
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
