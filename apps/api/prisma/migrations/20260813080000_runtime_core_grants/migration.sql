-- The first domain migrations predate the dedicated runtime role. RLS alone is
-- not enough: PostgreSQL evaluates table privileges before row policies. Grant
-- only the operations the HTTP application needs; authentication/session
-- mutations continue through narrow SECURITY DEFINER functions.

DO $$ BEGIN
  GRANT SELECT, UPDATE ON users TO contable_runtime;
  GRANT SELECT ON firms TO contable_runtime;
  GRANT SELECT, INSERT, UPDATE, DELETE ON
    firm_memberships,
    client_assignments,
    clients,
    fiscal_years,
    accounting_periods,
    accounts,
    journal_entries,
    journal_lines,
    chart_templates,
    client_profiles,
    counterparties,
    cost_centers,
    onboarding_checklists,
    documents,
    document_file_versions,
    document_processing_jobs,
    upload_sessions,
    document_extractions,
    extracted_fields,
    extracted_line_items
  TO contable_runtime;

  -- Audit is append-only even when the application role is compromised.
  GRANT SELECT, INSERT ON audit_events TO contable_runtime;
  REVOKE UPDATE, DELETE ON audit_events FROM contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
