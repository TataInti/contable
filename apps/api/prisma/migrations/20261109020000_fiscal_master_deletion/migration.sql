-- Baja titular auditada de jurisdicciones y tipos UI sin dependencias.
-- La lectura de dependencias incluye todas las columnas de referencia del catálogo,
-- incluso campos históricos que no tienen una FK física.

CREATE OR REPLACE FUNCTION app_tax_master_dependency_counts(
  p_column_name text,
  p_target_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_table record;
  v_count bigint;
  v_result jsonb := '{}'::jsonb;
BEGIN
  IF p_column_name NOT IN ('jurisdictionId', 'taxTypeId') THEN
    RAISE EXCEPTION 'CATALOG_COLUMN_INVALID' USING ERRCODE = '22023';
  END IF;

  FOR v_table IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = p_column_name
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE %I::text = $1',
      v_table.table_name,
      p_column_name
    ) INTO v_count USING p_target_id;
    IF v_count > 0 THEN
      v_result := v_result || jsonb_build_object(v_table.table_name, v_count);
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION app_tax_master_deletion_preview(
  p_entity_kind text,
  p_entity_id text,
  p_firm_id text,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_code text;
  v_result jsonb;
  v_children bigint;
BEGIN
  IF current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.user_id', true) IS DISTINCT FROM p_user_id
     OR NOT app_is_firm_owner(p_firm_id, p_user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  CASE p_entity_kind
    WHEN 'JURISDICTION' THEN
      SELECT code INTO v_code FROM jurisdictions
      WHERE id = p_entity_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      v_result := app_tax_master_dependency_counts('jurisdictionId', p_entity_id);
      SELECT count(*) INTO v_children FROM jurisdictions WHERE "parentId" = p_entity_id;
      IF v_children > 0 THEN
        v_result := v_result || jsonb_build_object('children', v_children);
      END IF;
    WHEN 'TAX_TYPE' THEN
      SELECT code INTO v_code FROM tax_types
      WHERE id = p_entity_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      v_result := app_tax_master_dependency_counts('taxTypeId', p_entity_id);
    ELSE
      RAISE EXCEPTION 'CATALOG_KIND_INVALID' USING ERRCODE = '22023';
  END CASE;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION app_delete_tax_master_entity(
  p_entity_kind text,
  p_entity_id text,
  p_firm_id text,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_impact jsonb;
  v_dependency_count bigint;
  v_deleted int := 0;
  v_table_name text;
BEGIN
  IF current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.user_id', true) IS DISTINCT FROM p_user_id
     OR NOT app_is_firm_owner(p_firm_id, p_user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  CASE p_entity_kind
    WHEN 'JURISDICTION' THEN
      PERFORM 1 FROM jurisdictions WHERE id = p_entity_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      v_table_name := 'jurisdictions';
    WHEN 'TAX_TYPE' THEN
      PERFORM 1 FROM tax_types WHERE id = p_entity_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      v_table_name := 'tax_types';
    ELSE
      RAISE EXCEPTION 'CATALOG_KIND_INVALID' USING ERRCODE = '22023';
  END CASE;

  v_impact := app_tax_master_deletion_preview(p_entity_kind, p_entity_id, p_firm_id, p_user_id);
  SELECT coalesce(sum(value::bigint), 0) INTO v_dependency_count FROM jsonb_each_text(v_impact);
  IF v_dependency_count > 0 THEN
    RAISE EXCEPTION 'CATALOG_IN_USE' USING ERRCODE = 'P0001';
  END IF;

  IF p_entity_kind = 'JURISDICTION' THEN
    DELETE FROM jurisdictions
    WHERE id = p_entity_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id;
  ELSE
    DELETE FROM tax_types
    WHERE id = p_entity_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id;
  END IF;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  RETURN jsonb_build_object(
    'deletedRows', v_deleted,
    'counts', jsonb_build_object(v_table_name, v_deleted)
  );
END;
$$;

REVOKE ALL ON FUNCTION app_tax_master_dependency_counts(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_tax_master_deletion_preview(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_delete_tax_master_entity(text, text, text, text) FROM PUBLIC;

DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION app_tax_master_deletion_preview(text, text, text, text) TO contable_runtime;
  GRANT EXECUTE ON FUNCTION app_delete_tax_master_entity(text, text, text, text) TO contable_runtime;
  REVOKE DELETE ON jurisdictions, tax_types FROM contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
