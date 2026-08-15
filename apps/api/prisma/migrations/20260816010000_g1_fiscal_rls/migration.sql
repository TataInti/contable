-- ============================================================
-- G1: RLS para la fundación fiscal (puerta 1)
-- Patrón: app_can_access_tenant("firmId","clientId") para tablas
-- de cliente; app_is_firm_member + actor != PORTAL para maestros.
-- ============================================================

-- Maestros con scope de firma (sin clientId): sólo miembros del estudio,
-- nunca el portal.
DO $$
DECLARE row record; pol record;
BEGIN
  FOR row IN SELECT unnest(ARRAY[
    'jurisdictions', 'tax_authorities', 'tax_types', 'tax_regimes',
    'economic_activities', 'professional_credentials', 'holidays'
  ]) AS table_name
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', row.table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', row.table_name);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=row.table_name LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, row.table_name);
    END LOOP;
    EXECUTE format('CREATE POLICY firm_scope_select ON %I FOR SELECT USING (app_is_firm_member(current_setting(''app.firm_id'', true), current_setting(''app.user_id'', true)))', row.table_name);
    EXECUTE format('CREATE POLICY firm_scope_insert ON %I FOR INSERT WITH CHECK (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_is_firm_member(current_setting(''app.firm_id'', true), current_setting(''app.user_id'', true)))', row.table_name);
    EXECUTE format('CREATE POLICY firm_scope_update ON %I FOR UPDATE USING (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_is_firm_member(current_setting(''app.firm_id'', true), current_setting(''app.user_id'', true))) WITH CHECK (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_is_firm_member(current_setting(''app.firm_id'', true), current_setting(''app.user_id'', true)))', row.table_name);
    EXECUTE format('CREATE POLICY firm_scope_delete ON %I FOR DELETE USING (current_setting(''app.actor_kind'', true) <> ''PORTAL'' AND app_is_firm_member(current_setting(''app.firm_id'', true), current_setting(''app.user_id'', true)))', row.table_name);
  END LOOP;
END $$;

-- Tablas de tenant: firma + cliente + miembro (mismo patrón que el resto
-- del dominio, ver 20260813000000_security_integration).
DO $$
DECLARE row record; pol record;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name IN (
        'taxpayer_profile_versions', 'tax_registrations', 'client_activities',
        'tax_periods', 'tax_obligations', 'tax_rule_packs', 'tax_rule_versions',
        'tax_rate_rules', 'tax_minimum_rules', 'tax_bracket_rules',
        'due_date_rules', 'rounding_rules', 'normative_sources', 'rule_approvals'
      )
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

-- Segunda clave de tenancy sobre cada tabla tenant fiscal.
DO $$
DECLARE row record; constraint_name text;
BEGIN
  FOR row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.columns d ON d.table_schema=c.table_schema AND d.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='firmId' AND d.column_name='clientId'
      AND c.table_name IN (
        'taxpayer_profile_versions', 'tax_registrations', 'client_activities',
        'tax_periods', 'tax_obligations'
      )
  LOOP
    constraint_name := left(row.table_name || '_tenant_client_fk', 63);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("firmId", "clientId") REFERENCES clients("firmId", id) NOT VALID', row.table_name, constraint_name);
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', row.table_name, constraint_name);
    END IF;
  END LOOP;
END $$;

-- Grants para contable_runtime: lectura de maestros + CRUD de tablas tenant.
DO $$ BEGIN
  GRANT SELECT ON
    jurisdictions,
    tax_authorities,
    tax_types,
    tax_regimes,
    economic_activities,
    professional_credentials,
    holidays
  TO contable_runtime;

  GRANT SELECT, INSERT, UPDATE, DELETE ON
    taxpayer_profile_versions,
    tax_registrations,
    client_activities,
    tax_periods,
    tax_obligations
  TO contable_runtime;

  GRANT SELECT, INSERT, UPDATE ON
    tax_rule_packs,
    tax_rule_versions,
    tax_rate_rules,
    tax_minimum_rules,
    tax_bracket_rules,
    due_date_rules,
    rounding_rules,
    normative_sources
  TO contable_runtime;

  -- Las aprobaciones de reglas son append-only: el runtime crea, nunca
  -- borra ni edita un approval emitido.
  GRANT SELECT, INSERT ON rule_approvals TO contable_runtime;
  REVOKE UPDATE, DELETE ON rule_approvals FROM contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;