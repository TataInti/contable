-- Security/integration recovery: explicit portal identity, durable outbox,
-- idempotency, comprehensive RLS, composite tenant keys and ledger guards.

ALTER TABLE "device_sessions" ADD COLUMN IF NOT EXISTS "previousRefreshTokenHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "device_sessions_previousRefreshTokenHash_key"
  ON "device_sessions"("previousRefreshTokenHash");

DO $$ BEGIN
  CREATE TYPE "PortalRole" AS ENUM ('OWNER', 'COLLABORATOR', 'READONLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "portal_memberships" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "PortalRole" NOT NULL DEFAULT 'OWNER',
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "invitedBy" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portal_memberships_firmId_clientId_userId_key" UNIQUE ("firmId", "clientId", "userId")
);
CREATE INDEX IF NOT EXISTS "portal_memberships_userId_status_idx" ON "portal_memberships"("userId", "status");

CREATE TABLE IF NOT EXISTS "portal_invitations" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL REFERENCES "firms"("id") ON DELETE CASCADE,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "emailNormalized" TEXT NOT NULL,
  "role" "PortalRole" NOT NULL DEFAULT 'OWNER',
  "tokenHash" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "invitedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "portal_invitations_firmId_clientId_emailNormalized_idx"
  ON "portal_invitations"("firmId", "clientId", "emailNormalized");

CREATE TABLE IF NOT EXISTS "idempotency_records" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "users"("id"),
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "response" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "idempotency_records_firmId_scope_key_key" UNIQUE ("firmId", "scope", "key")
);
CREATE INDEX IF NOT EXISTS "idempotency_records_firmId_clientId_createdAt_idx"
  ON "idempotency_records"("firmId", "clientId", "createdAt");

CREATE TABLE IF NOT EXISTS "outbox_events" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "topic" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "outbox_events_status_availableAt_idx" ON "outbox_events"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "outbox_events_firmId_clientId_createdAt_idx" ON "outbox_events"("firmId", "clientId", "createdAt");

-- Session lookup is deliberately narrow and SECURITY DEFINER so the runtime role
-- can authenticate before an app.user_id RLS context exists.
CREATE OR REPLACE FUNCTION app_resolve_session(target_hash text)
RETURNS TABLE("userId" text, "isPlatformAdmin" boolean, "userStatus" text, "expiresAt" timestamp, "revokedAt" timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ds."userId", u."isPlatformAdmin", u."status"::text, ds."expiresAt", ds."revokedAt"
  FROM device_sessions ds
  JOIN users u ON u.id = ds."userId"
  WHERE ds."refreshTokenHash" = target_hash
  LIMIT 1
$$;
CREATE OR REPLACE FUNCTION app_find_login_user(target_email text)
RETURNS TABLE(id text, "emailNormalized" text, "passwordHash" text, status text,
  "mfaEnabled" boolean, "mfaSecretEncrypted" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u."emailNormalized", u."passwordHash", u.status::text,
    u."mfaEnabled", u."mfaSecretEncrypted"
  FROM users u WHERE u."emailNormalized"=target_email LIMIT 1
$$;
CREATE OR REPLACE FUNCTION app_find_mfa_user(target_id text)
RETURNS TABLE(id text, status text, "mfaSecretEncrypted" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.status::text, u."mfaSecretEncrypted" FROM users u WHERE u.id=target_id LIMIT 1
$$;
CREATE OR REPLACE FUNCTION app_internal_contexts(target_user_id text)
RETURNS TABLE("firmId" text, "firmName" text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f."displayName", fm.role::text
  FROM firm_memberships fm JOIN firms f ON f.id=fm."firmId"
  WHERE fm."userId"=target_user_id AND fm.status='ACTIVE' AND f.status='ACTIVE'
  ORDER BY fm."acceptedAt" NULLS LAST, f."displayName"
$$;
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
REVOKE ALL ON FUNCTION app_resolve_session(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_find_login_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_find_mfa_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_internal_contexts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_portal_contexts(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_resolve_portal_membership(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_resolve_session(text), app_find_login_user(text),
    app_find_mfa_user(text), app_internal_contexts(text), app_portal_contexts(text),
    app_resolve_portal_membership(text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION app_create_session(
  target_id text, target_user_id text, target_hash text, target_family_id text, target_expires_at timestamp
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO device_sessions (id, "userId", "refreshTokenHash", "familyId", "rotationCounter", "expiresAt")
  VALUES (target_id, target_user_id, target_hash, target_family_id, 0, target_expires_at);
  RETURN target_id;
END $$;

CREATE OR REPLACE FUNCTION app_rotate_session(target_old_hash text, target_new_hash text, target_expires_at timestamp)
RETURNS TABLE("sessionId" text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target_session device_sessions%ROWTYPE;
BEGIN
  SELECT * INTO target_session FROM device_sessions WHERE "previousRefreshTokenHash"=target_old_hash FOR UPDATE;
  IF FOUND THEN
    UPDATE device_sessions SET "revokedAt"=CURRENT_TIMESTAMP WHERE "familyId"=target_session."familyId";
    RETURN QUERY SELECT target_session.id, 'REPLAY'::text;
    RETURN;
  END IF;
  SELECT * INTO target_session FROM device_sessions
    WHERE "refreshTokenHash"=target_old_hash AND "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE device_sessions SET
    "previousRefreshTokenHash"=target_old_hash,
    "refreshTokenHash"=target_new_hash,
    "rotationCounter"="rotationCounter"+1,
    "lastUsedAt"=CURRENT_TIMESTAMP,
    "expiresAt"=target_expires_at
  WHERE id=target_session.id;
  RETURN QUERY SELECT target_session.id, 'ROTATED'::text;
END $$;

CREATE OR REPLACE FUNCTION app_revoke_session_by_token(target_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE device_sessions SET "revokedAt"=CURRENT_TIMESTAMP
  WHERE "refreshTokenHash"=target_hash OR "previousRefreshTokenHash"=target_hash
$$;

CREATE OR REPLACE FUNCTION app_revoke_session_by_id(target_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE device_sessions SET "revokedAt"=CURRENT_TIMESTAMP WHERE id=target_id
$$;

CREATE OR REPLACE FUNCTION app_claim_outbox(target_limit integer DEFAULT 25)
RETURNS TABLE(id text, topic text, "eventType" text, "aggregateId" text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT o.id FROM outbox_events o
    WHERE o.status IN ('PENDING','FAILED') AND o."availableAt"<=CURRENT_TIMESTAMP AND o.attempts<10
    ORDER BY o."createdAt" FOR UPDATE SKIP LOCKED LIMIT target_limit
  ), updated AS (
    UPDATE outbox_events o SET status='PROCESSING', "lockedAt"=CURRENT_TIMESTAMP, attempts=o.attempts+1
    FROM claimed c WHERE o.id=c.id
    RETURNING o.id, o.topic, o."eventType", o."aggregateId", o.payload
  ) SELECT * FROM updated;
END $$;
CREATE OR REPLACE FUNCTION app_complete_outbox(target_id text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_events SET status='PUBLISHED', "publishedAt"=CURRENT_TIMESTAMP, "lockedAt"=NULL, "lastError"=NULL
  WHERE id=target_id
$$;
CREATE OR REPLACE FUNCTION app_fail_outbox(target_id text, target_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_events SET status='FAILED', "lockedAt"=NULL, "lastError"=left(target_error,1000),
    "availableAt"=CURRENT_TIMESTAMP + make_interval(secs => LEAST(300, power(2, attempts)::integer))
  WHERE id=target_id
$$;

REVOKE ALL ON FUNCTION app_create_session(text,text,text,text,timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_rotate_session(text,text,timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_revoke_session_by_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_revoke_session_by_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_claim_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_complete_outbox(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_fail_outbox(text,text) FROM PUBLIC;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_create_session(text,text,text,text,timestamp),
    app_rotate_session(text,text,timestamp), app_revoke_session_by_token(text),
    app_revoke_session_by_id(text), app_claim_outbox(integer), app_complete_outbox(text),
    app_fail_outbox(text,text) TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION app_is_firm_member(target_firm_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId"=target_firm_id AND fm."userId"=target_user_id AND fm.status='ACTIVE'
  )
$$;

CREATE OR REPLACE FUNCTION app_is_internal_client_member(target_firm_id text, target_client_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId" = target_firm_id AND fm."userId" = target_user_id AND fm.status = 'ACTIVE'
      AND (
        fm.role IN ('OWNER', 'ADMIN') OR EXISTS (
          SELECT 1 FROM client_assignments ca
          WHERE ca."firmId" = target_firm_id AND ca."clientId" = target_client_id AND ca."userId" = target_user_id
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION app_is_portal_client_member(target_firm_id text, target_client_id text, target_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM portal_memberships pm
    WHERE pm."firmId" = target_firm_id AND pm."clientId" = target_client_id
      AND pm."userId" = target_user_id AND pm.status = 'ACTIVE' AND pm."revokedAt" IS NULL
  )
$$;

CREATE OR REPLACE FUNCTION app_can_access_client(target_firm_id text, target_client_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT target_firm_id = current_setting('app.firm_id', true)
    AND (NULLIF(current_setting('app.client_id', true), '') IS NULL
      OR target_client_id = current_setting('app.client_id', true))
    AND (
      (current_user = 'contable_worker' AND current_setting('app.actor_kind', true) = 'SYSTEM')
      OR
      app_is_internal_client_member(target_firm_id, target_client_id, current_setting('app.user_id', true))
      OR app_is_portal_client_member(target_firm_id, target_client_id, current_setting('app.user_id', true))
    )
$$;

CREATE OR REPLACE FUNCTION app_can_access_tenant(target_firm_id text, target_client_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT target_firm_id = current_setting('app.firm_id', true)
    AND (
      (target_client_id IS NULL
        AND current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_is_firm_member(target_firm_id, current_setting('app.user_id', true)))
      OR (target_client_id IS NOT NULL AND app_can_access_client(target_firm_id, target_client_id))
    )
$$;

-- Identity and firm-owned tables are also isolated; auth uses only the narrow
-- SECURITY DEFINER functions declared above.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users FOR ALL
  USING (id=current_setting('app.user_id', true))
  WITH CHECK (id=current_setting('app.user_id', true));

ALTER TABLE firms ENABLE ROW LEVEL SECURITY;
ALTER TABLE firms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firms_member ON firms;
CREATE POLICY firms_member ON firms FOR SELECT
  USING (app_is_firm_member(id,current_setting('app.user_id', true)));

ALTER TABLE firm_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_memberships FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS firm_memberships_visible ON firm_memberships;
CREATE POLICY firm_memberships_visible ON firm_memberships FOR ALL
  USING ("userId"=current_setting('app.user_id', true) OR app_is_firm_member("firmId",current_setting('app.user_id', true)))
  WITH CHECK (app_is_firm_member("firmId",current_setting('app.user_id', true)));

ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS device_sessions_self ON device_sessions;
CREATE POLICY device_sessions_self ON device_sessions FOR SELECT
  USING ("userId"=current_setting('app.user_id', true));

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

-- A second tenant key on every client-owned table prevents a valid client id
-- being paired with the wrong firm id.
CREATE UNIQUE INDEX IF NOT EXISTS "clients_firmId_id_key" ON "clients"("firmId", "id");
DO $$
DECLARE row record; constraint_name text;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name <> 'clients'
  LOOP
    constraint_name := left(row.table_name || '_tenant_client_fk', 63);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("firmId", "clientId") REFERENCES clients("firmId", id) NOT VALID', row.table_name, constraint_name);
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', row.table_name, constraint_name);
    END IF;
  END LOOP;
END $$;

-- Replace permissive legacy policies on every client-owned table.
DO $$
DECLARE row record; pol record;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name NOT IN ('clients', 'audit_events', 'portal_memberships', 'portal_invitations')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', row.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', row.table_name);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=row.table_name LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, row.table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY tenant_select ON %I FOR SELECT USING (app_can_access_tenant("firmId", "clientId"))', row.table_name);
    EXECUTE format('CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId"))', row.table_name);
    EXECUTE format('CREATE POLICY tenant_update ON %I FOR UPDATE USING (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId")) WITH CHECK (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId"))', row.table_name);
    EXECUTE format('CREATE POLICY tenant_delete ON %I FOR DELETE USING (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_can_access_tenant("firmId", "clientId"))', row.table_name);
  END LOOP;
END $$;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
DO $$ DECLARE pol record; BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='clients' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON clients', pol.policyname);
  END LOOP;
END $$;
CREATE POLICY clients_select ON clients FOR SELECT USING (app_can_access_client("firmId", id));
CREATE POLICY clients_insert ON clients FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);
CREATE POLICY clients_update ON clients FOR UPDATE USING (
  current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_client("firmId", id)
) WITH CHECK (current_setting('app.actor_kind', true) <> 'PORTAL' AND app_can_access_client("firmId", id));

-- Portal membership rows are visible only to that user or internal members.
ALTER TABLE portal_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_memberships_select ON portal_memberships FOR SELECT USING (
  "userId" = current_setting('app.user_id', true)
  OR app_is_firm_member("firmId", current_setting('app.user_id', true))
);
CREATE POLICY portal_memberships_internal_write ON portal_memberships FOR ALL USING (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
) WITH CHECK (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);

ALTER TABLE portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_invitations_internal ON portal_invitations FOR ALL USING (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
) WITH CHECK (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_is_firm_member("firmId", current_setting('app.user_id', true))
);

-- El portal sólo puede escribir en los recursos colaborativos imprescindibles.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['upload_sessions','documents','document_file_versions',
    'document_processing_jobs','outbox_events','request_messages']
  LOOP
    EXECUTE format('CREATE POLICY portal_collaboration_write ON %I FOR ALL USING (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true))) WITH CHECK (current_setting(''app.actor_kind'', true)=''PORTAL'' AND app_is_portal_client_member("firmId","clientId",current_setting(''app.user_id'',true)))', table_name);
  END LOOP;
END $$;

CREATE POLICY audit_events_portal_insert ON audit_events FOR INSERT WITH CHECK (
  current_setting('app.actor_kind', true)='PORTAL'
  AND app_is_portal_client_member("firmId", "clientId", current_setting('app.user_id', true))
);

-- Append-only audit at SQL privilege and trigger level.
CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events are append-only' USING ERRCODE='55000'; END $$;
DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
DO $$ BEGIN
  REVOKE UPDATE, DELETE ON audit_events FROM contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Posted entries cannot be edited. Reversal is the only allowed transition.
CREATE OR REPLACE FUNCTION protect_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('POSTED', 'REVERSED') THEN
    IF NOT (OLD.status='POSTED' AND NEW.status='REVERSED'
      AND NEW."reversedByEntryId" IS NOT NULL
      AND NEW."clientId"=OLD."clientId" AND NEW."firmId"=OLD."firmId"
      AND NEW."fiscalYearId"=OLD."fiscalYearId" AND NEW."periodId"=OLD."periodId"
      AND NEW."entryDate"=OLD."entryDate" AND NEW.description=OLD.description
      AND NEW."sequenceNumber"=OLD."sequenceNumber") THEN
      RAISE EXCEPTION 'posted journal entries are immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_immutable ON journal_entries;
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_entry();

CREATE OR REPLACE FUNCTION mark_new_posted_journal_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='POSTED' THEN PERFORM set_config('app.new_posted_entry_id',NEW.id,true); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_mark_new_posted ON journal_entries;
CREATE TRIGGER journal_entries_mark_new_posted BEFORE INSERT ON journal_entries
FOR EACH ROW EXECUTE FUNCTION mark_new_posted_journal_entry();

CREATE OR REPLACE FUNCTION protect_posted_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_entry text; target_status "JournalEntryStatus";
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  target_entry := COALESCE(NEW."entryId", OLD."entryId");
  SELECT status INTO target_status FROM journal_entries WHERE id=target_entry;
  IF target_status IN ('POSTED', 'REVERSED')
    AND NOT (TG_OP='INSERT' AND current_setting('app.new_posted_entry_id',true)=target_entry) THEN
    RAISE EXCEPTION 'lines of posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_lines_immutable ON journal_lines;
CREATE TRIGGER journal_lines_immutable BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION protect_posted_journal_line();

CREATE OR REPLACE FUNCTION assert_posted_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE debit numeric; credit numeric;
BEGIN
  IF NEW.status='POSTED' THEN
    SELECT COALESCE(SUM("debitFunctional"),0), COALESCE(SUM("creditFunctional"),0)
      INTO debit, credit FROM journal_lines WHERE "entryId"=NEW.id;
    IF debit <> credit OR debit = 0 THEN
      RAISE EXCEPTION 'posted journal entry must be balanced and non-zero' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS journal_entries_balanced ON journal_entries;
CREATE CONSTRAINT TRIGGER journal_entries_balanced
AFTER INSERT OR UPDATE OF status ON journal_entries
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_posted_journal_balanced();

DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON portal_memberships, portal_invitations,
    idempotency_records, outbox_events TO contable_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO contable_worker;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
