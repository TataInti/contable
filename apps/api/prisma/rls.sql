-- ============================================================
-- RLS para Contable (ADR-006)
--
-- Principios:
--   - FORCE ROW LEVEL SECURITY en toda tabla tenant.
--   - El rol runtime NO es owner ni tiene BYPASSRLS.
--   - Cada transacción fija app.user_id, app.firm_id, app.actor_kind.
--   - Las policies comparan el contexto de sesión con cada fila.
--   - FKs compuestas (firm_id, client_id) impiden relaciones cruzadas.
--
-- IMPORTANTE (advertencia de example-platform rls_corporate.sql):
--   Una policy tipo `firm_id IS NOT NULL` NO aísla tenants.
--   Aquí SIEMPRE se compara el contexto de sesión con la fila.
-- ============================================================

-- Requiere que el rol runtime exista y no sea owner. Se crea en migración previa.

-- ------------------------------------------------------------
-- 0. Función helper de membresía (evita recursión en policies)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_is_firm_member(target_firm_id text, target_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM firm_memberships fm
    WHERE fm."firmId" = target_firm_id
      AND fm."userId" = target_user_id
      AND fm."status" = 'ACTIVE'
  )
$$;

-- ------------------------------------------------------------
-- 0b. Función helper de acceso a cliente (G0-09)
-- ------------------------------------------------------------
-- Determina si un usuario puede acceder a un cliente de la firma:
--   - Si app.client_id está seteado, sólo permite ese cliente (aislamiento por contexto).
--   - Si no, permite si el usuario es OWNER/ADMIN (firm-wide) o tiene asignación al cliente.
CREATE OR REPLACE FUNCTION app_can_access_client(target_client_id text, target_firm_id text, target_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Contexto client_id explícito: sólo ese cliente
    (current_setting('app.client_id', true) <> '' AND current_setting('app.client_id', true) = target_client_id)
    OR
    -- Sin contexto client_id: owner/admin o asignado
    (
      current_setting('app.client_id', true) = ''
      AND (
        EXISTS (
          SELECT 1 FROM firm_memberships fm
          WHERE fm."firmId" = target_firm_id
            AND fm."userId" = target_user_id
            AND fm."status" = 'ACTIVE'
            AND fm.role IN ('OWNER', 'ADMIN')
        )
        OR EXISTS (
          SELECT 1 FROM client_assignments ca
          WHERE ca."firmId" = target_firm_id
            AND ca."clientId" = target_client_id
            AND ca."userId" = target_user_id
        )
      )
    )
$$;

-- ------------------------------------------------------------
-- 1. users
-- ------------------------------------------------------------
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_self ON "users";
CREATE POLICY users_self ON "users"
  USING (id = current_setting('app.user_id', true))
  WITH CHECK (id = current_setting('app.user_id', true));

-- ------------------------------------------------------------
-- 2. firms
-- ------------------------------------------------------------
ALTER TABLE "firms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "firms" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firms_member ON "firms";
CREATE POLICY firms_member ON "firms"
  USING (app_is_firm_member(id, current_setting('app.user_id', true)));

-- ------------------------------------------------------------
-- 3. firm_memberships
-- ------------------------------------------------------------
ALTER TABLE "firm_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "firm_memberships" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firm_memberships_visible ON "firm_memberships";
CREATE POLICY firm_memberships_visible ON "firm_memberships"
  USING (
    "userId" = current_setting('app.user_id', true)
    OR app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 4. clients
-- ------------------------------------------------------------
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clients_firm_member ON "clients";
CREATE POLICY clients_firm_member ON "clients"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_can_access_client(id, "firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 5. client_assignments
-- ------------------------------------------------------------
ALTER TABLE "client_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_assignments" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_assignments_visible ON "client_assignments";
CREATE POLICY client_assignments_visible ON "client_assignments"
  USING (
    "userId" = current_setting('app.user_id', true)
    OR app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 6. fiscal_years, accounting_periods, accounts
-- ------------------------------------------------------------
ALTER TABLE "fiscal_years" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fiscal_years" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_years_client_scope ON "fiscal_years";
CREATE POLICY fiscal_years_client_scope ON "fiscal_years"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "accounting_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_periods" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_periods_client_scope ON "accounting_periods";
CREATE POLICY accounting_periods_client_scope ON "accounting_periods"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounts_client_scope ON "accounts";
CREATE POLICY accounts_client_scope ON "accounts"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 7. journal_entries, journal_lines, audit_events
-- ------------------------------------------------------------
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_entries_client_scope ON "journal_entries";
CREATE POLICY journal_entries_client_scope ON "journal_entries"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_lines" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS journal_lines_client_scope ON "journal_lines";
CREATE POLICY journal_lines_client_scope ON "journal_lines"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- Auditoría: append-only; el runtime puede insertar y leer los de su firma.
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_events_append ON "audit_events";
CREATE POLICY audit_events_append ON "audit_events"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 8. device_sessions
-- ------------------------------------------------------------
ALTER TABLE "device_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "device_sessions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_sessions_self ON "device_sessions";
CREATE POLICY device_sessions_self ON "device_sessions"
  USING ("userId" = current_setting('app.user_id', true));

-- ------------------------------------------------------------
-- 9. Fase 3 — client_profiles, chart_templates, counterparties, cost_centers, onboarding_checklists
-- ------------------------------------------------------------
ALTER TABLE "client_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_profiles" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_profiles_firm_scope ON "client_profiles";
CREATE POLICY client_profiles_firm_scope ON "client_profiles"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "chart_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chart_templates" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chart_templates_firm_scope ON "chart_templates";
CREATE POLICY chart_templates_firm_scope ON "chart_templates"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "counterparties" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "counterparties" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS counterparties_client_scope ON "counterparties";
CREATE POLICY counterparties_client_scope ON "counterparties"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_centers_client_scope ON "cost_centers";
CREATE POLICY cost_centers_client_scope ON "cost_centers"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "onboarding_checklists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "onboarding_checklists" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onboarding_checklists_firm_scope ON "onboarding_checklists";
CREATE POLICY onboarding_checklists_firm_scope ON "onboarding_checklists"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 9b. Catálogo de normas contables por estudio (ficha de cliente).
-- ------------------------------------------------------------
ALTER TABLE "accounting_standards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounting_standards" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_standards_firm_scope ON "accounting_standards";
CREATE POLICY accounting_standards_firm_scope ON "accounting_standards"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 10. Fase 4 — documents, document_file_versions, document_processing_jobs, upload_sessions
-- ------------------------------------------------------------
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS documents_client_scope ON "documents";
CREATE POLICY documents_client_scope ON "documents"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "document_file_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_file_versions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_file_versions_client_scope ON "document_file_versions";
CREATE POLICY document_file_versions_client_scope ON "document_file_versions"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "document_processing_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_processing_jobs" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_processing_jobs_client_scope ON "document_processing_jobs";
CREATE POLICY document_processing_jobs_client_scope ON "document_processing_jobs"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "upload_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "upload_sessions" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upload_sessions_client_scope ON "upload_sessions";
CREATE POLICY upload_sessions_client_scope ON "upload_sessions"
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );