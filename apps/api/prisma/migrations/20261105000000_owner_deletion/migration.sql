-- ============================================================
-- Eliminación definitiva desde la UI — sólo Titular (OWNER)
--
-- 1) Capability data.delete (API) + policy RLS de DELETE en clients.
-- 2) Excepción acotada de inmutabilidad para la purga de un cliente:
--    los triggers siguen bloqueando cualquier DELETE normal; sólo permiten
--    el borrado cuando la transacción fija app.purge_client_id con el mismo
--    clientId y el usuario es OWNER activo del estudio.
-- 3) Funciones SECURITY DEFINER para borrar paquetes/versiones de reglas,
--    cuyas tablas hijas (aprobaciones/fuentes) no tienen DELETE para runtime.
--
-- audit_events NO se toca: sigue append-only y sin FK a clients.
-- ============================================================

-- Los registros preexistentes quedan clasificados como referencia. Las altas
-- hechas desde UI se marcan explícitamente junto a su estudio creador.
CREATE TYPE "CatalogOrigin" AS ENUM ('REFERENCE', 'UI');

ALTER TABLE tax_authorities
  ADD COLUMN "origin" "CatalogOrigin" NOT NULL DEFAULT 'REFERENCE',
  ADD COLUMN "createdByFirmId" text;
ALTER TABLE tax_regimes
  ADD COLUMN "origin" "CatalogOrigin" NOT NULL DEFAULT 'REFERENCE',
  ADD COLUMN "createdByFirmId" text;
ALTER TABLE economic_activities
  ADD COLUMN "origin" "CatalogOrigin" NOT NULL DEFAULT 'REFERENCE',
  ADD COLUMN "createdByFirmId" text;
ALTER TABLE tax_rule_packs
  ADD COLUMN "origin" "CatalogOrigin" NOT NULL DEFAULT 'REFERENCE',
  ADD COLUMN "createdByFirmId" text;
ALTER TABLE tax_rule_versions
  ADD COLUMN "origin" "CatalogOrigin" NOT NULL DEFAULT 'REFERENCE',
  ADD COLUMN "createdByFirmId" text;

ALTER TABLE tax_authorities ADD CONSTRAINT "tax_authorities_createdByFirmId_fkey"
  FOREIGN KEY ("createdByFirmId") REFERENCES firms(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE tax_regimes ADD CONSTRAINT "tax_regimes_createdByFirmId_fkey"
  FOREIGN KEY ("createdByFirmId") REFERENCES firms(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE economic_activities ADD CONSTRAINT "economic_activities_createdByFirmId_fkey"
  FOREIGN KEY ("createdByFirmId") REFERENCES firms(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE tax_rule_packs ADD CONSTRAINT "tax_rule_packs_createdByFirmId_fkey"
  FOREIGN KEY ("createdByFirmId") REFERENCES firms(id) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE tax_rule_versions ADD CONSTRAINT "tax_rule_versions_createdByFirmId_fkey"
  FOREIGN KEY ("createdByFirmId") REFERENCES firms(id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tax_authorities_createdByFirmId_idx" ON tax_authorities("createdByFirmId");
CREATE INDEX "tax_regimes_createdByFirmId_idx" ON tax_regimes("createdByFirmId");
CREATE INDEX "economic_activities_createdByFirmId_idx" ON economic_activities("createdByFirmId");
CREATE INDEX "tax_rule_packs_createdByFirmId_idx" ON tax_rule_packs("createdByFirmId");
CREATE INDEX "tax_rule_versions_createdByFirmId_idx" ON tax_rule_versions("createdByFirmId");

-- 1) Owner activo del estudio.
CREATE OR REPLACE FUNCTION app_is_firm_owner(target_firm_id text, target_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM firm_memberships fm
    WHERE fm."firmId" = target_firm_id
      AND fm."userId" = target_user_id
      AND fm.status = 'ACTIVE'
      AND fm.role = 'OWNER'
  )
$$;

GRANT EXECUTE ON FUNCTION app_is_firm_owner(text, text) TO contable_runtime;

-- Marca de purga: la fija la transacción de borrado del cliente. No alcanza
-- con setear el GUC: el usuario debe ser OWNER activo del estudio.
CREATE OR REPLACE FUNCTION app_is_client_purge(target_client_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
  SELECT target_client_id IS NOT NULL
    AND target_client_id <> ''
    AND current_setting('app.purge_client_id', true) = target_client_id
    AND app_is_firm_owner(
      current_setting('app.firm_id', true),
      current_setting('app.user_id', true)
    )
$$;

GRANT EXECUTE ON FUNCTION app_is_client_purge(text) TO contable_runtime;

-- 2) RLS: el runtime ya tenía GRANT DELETE sobre clients, pero no policy.
DROP POLICY IF EXISTS clients_delete ON clients;
CREATE POLICY clients_delete ON clients FOR DELETE USING (
  current_setting('app.actor_kind', true) <> 'PORTAL'
  AND app_can_access_client("firmId", id)
  AND app_is_firm_owner(
    current_setting('app.firm_id', true),
    current_setting('app.user_id', true)
  )
);

-- outbox_events se borra con el cliente; faltaba el privilegio de tabla.
DO $$ BEGIN
  GRANT DELETE ON outbox_events TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- 3) Inmutabilidad: excepción sólo para la purga auditada de un cliente.
CREATE OR REPLACE FUNCTION protect_posted_journal_entry()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND app_is_client_purge(OLD."clientId") THEN RETURN OLD; END IF;
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

CREATE OR REPLACE FUNCTION protect_posted_journal_line()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE target_entry text; target_status "JournalEntryStatus";
BEGIN
  IF current_user = 'contable' AND TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' AND app_is_client_purge(OLD."clientId") THEN RETURN OLD; END IF;
  target_entry := COALESCE(NEW."entryId", OLD."entryId");
  SELECT status INTO target_status FROM journal_entries WHERE id=target_entry;
  IF target_status IN ('POSTED', 'REVERSED')
    AND NOT (TG_OP='INSERT' AND current_setting('app.new_posted_entry_id',true)=target_entry) THEN
    RAISE EXCEPTION 'lines of posted journal entries are immutable' USING ERRCODE='55000';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app_guard_settlement_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_is_client_purge(OLD."clientId") THEN RETURN OLD; END IF;
    v_status := OLD."status";
    IF v_status = 'FINALIZED' THEN
      RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: una liquidación finalizada no puede eliminarse'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  v_status := OLD."status";
  IF v_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: una liquidación finalizada no puede modificarse'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_guard_settlement_child_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_is_client_purge(OLD."clientId") THEN RETURN OLD; END IF;
    SELECT "status" INTO v_status FROM tax_settlements WHERE id = OLD."settlementId";
    IF v_status = 'FINALIZED' THEN
      RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: los snapshots de una liquidación finalizada no pueden eliminarse'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  SELECT "status" INTO v_status FROM tax_settlements WHERE id = NEW."settlementId";
  IF v_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: los snapshots de una liquidación finalizada no pueden modificarse'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_guard_settlement_diff_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF app_is_client_purge(OLD."clientId") THEN RETURN OLD; END IF;
    SELECT "status" INTO v_status FROM tax_settlements WHERE id = OLD."settlementId";
    IF v_status = 'FINALIZED' THEN
      RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: las diferencias de una liquidación finalizada no pueden eliminarse'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 4) Paquetes y versiones de reglas: borrado en cascada controlado.
--    Valida OWNER y bloquea si la versión está referenciada por liquidaciones,
--    decisiones de tratamiento o ajustes (esas referencias son historial).
CREATE OR REPLACE FUNCTION app_delete_tax_rule_pack(
  p_pack_id uuid,
  p_firm_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_versions int;
  v_rates int;
  v_minimums int;
  v_brackets int;
  v_due_dates int;
  v_roundings int;
  v_sources int;
  v_approvals int;
BEGIN
  IF NOT app_is_firm_owner(p_firm_id::text, p_user_id::text) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tax_rule_packs WHERE id = p_pack_id) THEN
    RAISE EXCEPTION 'RULE_PACK_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tax_settlements s
    JOIN tax_rule_versions v ON v.id = s."ruleVersionId"
    WHERE v."packId" = p_pack_id
  ) OR EXISTS (
    SELECT 1 FROM tax_treatment_decisions d
    JOIN tax_rule_versions v ON v.id = d."ruleVersionId"
    WHERE v."packId" = p_pack_id
  ) OR EXISTS (
    SELECT 1 FROM tax_adjustments a
    JOIN tax_rule_versions v ON v.id = a."ruleVersionId"
    WHERE v."packId" = p_pack_id
  ) THEN
    RAISE EXCEPTION 'RULE_PACK_IN_USE' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_versions FROM tax_rule_versions WHERE "packId" = p_pack_id;
  SELECT count(*) INTO v_rates FROM tax_rate_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_minimums FROM tax_minimum_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_brackets FROM tax_bracket_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_due_dates FROM due_date_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_roundings FROM rounding_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_sources FROM normative_sources WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_approvals FROM rule_approvals WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);

  DELETE FROM rule_approvals WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM normative_sources WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM tax_rate_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM tax_minimum_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM tax_bracket_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM due_date_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM rounding_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM tax_rule_versions WHERE "packId" = p_pack_id;
  DELETE FROM tax_rule_packs WHERE id = p_pack_id;

  RETURN jsonb_build_object(
    'versions', v_versions,
    'rateRules', v_rates,
    'minimumRules', v_minimums,
    'bracketRules', v_brackets,
    'dueDateRules', v_due_dates,
    'roundingRules', v_roundings,
    'sources', v_sources,
    'approvals', v_approvals
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_delete_tax_rule_pack(uuid, uuid, uuid) TO contable_runtime;

CREATE OR REPLACE FUNCTION app_delete_tax_rule_version(
  p_version_id uuid,
  p_firm_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rates int;
  v_minimums int;
  v_brackets int;
  v_due_dates int;
  v_roundings int;
  v_sources int;
  v_approvals int;
BEGIN
  IF NOT app_is_firm_owner(p_firm_id::text, p_user_id::text) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tax_rule_versions WHERE id = p_version_id) THEN
    RAISE EXCEPTION 'RULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM tax_rule_versions WHERE "supersedesId" = p_version_id) THEN
    RAISE EXCEPTION 'RULE_VERSION_SUPERSEDED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM tax_settlements WHERE "ruleVersionId" = p_version_id)
     OR EXISTS (SELECT 1 FROM tax_treatment_decisions WHERE "ruleVersionId" = p_version_id)
     OR EXISTS (SELECT 1 FROM tax_adjustments WHERE "ruleVersionId" = p_version_id) THEN
    RAISE EXCEPTION 'RULE_VERSION_IN_USE' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_rates FROM tax_rate_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_minimums FROM tax_minimum_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_brackets FROM tax_bracket_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_due_dates FROM due_date_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_roundings FROM rounding_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_sources FROM normative_sources WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_approvals FROM rule_approvals WHERE "ruleVersionId" = p_version_id;

  DELETE FROM rule_approvals WHERE "ruleVersionId" = p_version_id;
  DELETE FROM normative_sources WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_rate_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_minimum_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_bracket_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM due_date_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM rounding_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_rule_versions WHERE id = p_version_id;

  RETURN jsonb_build_object(
    'rateRules', v_rates,
    'minimumRules', v_minimums,
    'bracketRules', v_brackets,
    'dueDateRules', v_due_dates,
    'roundingRules', v_roundings,
    'sources', v_sources,
    'approvals', v_approvals
  );
END;
$$;

GRANT EXECUTE ON FUNCTION app_delete_tax_rule_version(uuid, uuid, uuid) TO contable_runtime;

-- Reemplazo con alcance de creador y protección de versiones publicadas e
-- historial de aprobaciones. Sólo borradores UI sin referencias se eliminan.
CREATE OR REPLACE FUNCTION app_delete_tax_rule_pack(
  p_pack_id text,
  p_firm_id text,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_versions int;
  v_rates int;
  v_minimums int;
  v_brackets int;
  v_due_dates int;
  v_roundings int;
  v_sources int;
BEGIN
  IF current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id::text
     OR current_setting('app.user_id', true) IS DISTINCT FROM p_user_id::text
     OR NOT app_is_firm_owner(p_firm_id::text, p_user_id::text) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM tax_rule_packs WHERE id = p_pack_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RULE_PACK_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tax_rule_packs
    WHERE id = p_pack_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id::text
  ) THEN
    RAISE EXCEPTION 'RULE_PACK_OUT_OF_SCOPE' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM tax_rule_packs WHERE id = p_pack_id AND status <> 'DRAFT')
     OR EXISTS (
       SELECT 1 FROM tax_rule_versions
       WHERE "packId" = p_pack_id AND status <> 'DRAFT'
     ) THEN
    RAISE EXCEPTION 'RULE_PACK_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tax_rule_versions
    WHERE "packId" = p_pack_id
      AND (origin <> 'UI' OR "createdByFirmId" IS DISTINCT FROM p_firm_id::text)
  ) THEN
    RAISE EXCEPTION 'RULE_PACK_REFERENCE_VERSION' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tax_rule_versions v
    WHERE v."packId" = p_pack_id AND (
      EXISTS (SELECT 1 FROM rule_approvals a WHERE a."ruleVersionId" = v.id)
      OR EXISTS (SELECT 1 FROM tax_settlements s WHERE s."ruleVersionId" = v.id)
      OR EXISTS (SELECT 1 FROM tax_treatment_decisions d WHERE d."ruleVersionId" = v.id)
      OR EXISTS (SELECT 1 FROM tax_adjustments a WHERE a."ruleVersionId" = v.id)
    )
  ) THEN
    RAISE EXCEPTION 'RULE_PACK_IN_USE' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_versions FROM tax_rule_versions WHERE "packId" = p_pack_id;
  SELECT count(*) INTO v_rates FROM tax_rate_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_minimums FROM tax_minimum_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_brackets FROM tax_bracket_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_due_dates FROM due_date_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_roundings FROM rounding_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  SELECT count(*) INTO v_sources FROM normative_sources WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);

  DELETE FROM normative_sources WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM tax_rate_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM tax_minimum_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM tax_bracket_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM due_date_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  DELETE FROM rounding_rules WHERE "ruleVersionId" IN (SELECT id FROM tax_rule_versions WHERE "packId" = p_pack_id);
  UPDATE tax_rule_versions SET "supersedesId" = NULL WHERE "packId" = p_pack_id;
  DELETE FROM tax_rule_versions WHERE "packId" = p_pack_id;
  DELETE FROM tax_rule_packs WHERE id = p_pack_id;

  RETURN jsonb_build_object(
    'versions', v_versions,
    'rateRules', v_rates,
    'minimumRules', v_minimums,
    'bracketRules', v_brackets,
    'dueDateRules', v_due_dates,
    'roundingRules', v_roundings,
    'sources', v_sources,
    'approvals', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_delete_tax_rule_version(
  p_version_id text,
  p_firm_id text,
  p_user_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_rates int;
  v_minimums int;
  v_brackets int;
  v_due_dates int;
  v_roundings int;
  v_sources int;
BEGIN
  IF current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id::text
     OR current_setting('app.user_id', true) IS DISTINCT FROM p_user_id::text
     OR NOT app_is_firm_owner(p_firm_id::text, p_user_id::text) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM tax_rule_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tax_rule_versions
    WHERE id = p_version_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id::text
  ) THEN
    RAISE EXCEPTION 'RULE_VERSION_OUT_OF_SCOPE' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM tax_rule_versions WHERE id = p_version_id AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'RULE_VERSION_NOT_DRAFT' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM tax_rule_versions WHERE "supersedesId" = p_version_id) THEN
    RAISE EXCEPTION 'RULE_VERSION_SUPERSEDED' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM rule_approvals WHERE "ruleVersionId" = p_version_id)
     OR EXISTS (SELECT 1 FROM tax_settlements WHERE "ruleVersionId" = p_version_id)
     OR EXISTS (SELECT 1 FROM tax_treatment_decisions WHERE "ruleVersionId" = p_version_id)
     OR EXISTS (SELECT 1 FROM tax_adjustments WHERE "ruleVersionId" = p_version_id) THEN
    RAISE EXCEPTION 'RULE_VERSION_IN_USE' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_rates FROM tax_rate_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_minimums FROM tax_minimum_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_brackets FROM tax_bracket_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_due_dates FROM due_date_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_roundings FROM rounding_rules WHERE "ruleVersionId" = p_version_id;
  SELECT count(*) INTO v_sources FROM normative_sources WHERE "ruleVersionId" = p_version_id;

  DELETE FROM normative_sources WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_rate_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_minimum_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_bracket_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM due_date_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM rounding_rules WHERE "ruleVersionId" = p_version_id;
  DELETE FROM tax_rule_versions WHERE id = p_version_id;

  RETURN jsonb_build_object(
    'rateRules', v_rates,
    'minimumRules', v_minimums,
    'bracketRules', v_brackets,
    'dueDateRules', v_due_dates,
    'roundingRules', v_roundings,
    'sources', v_sources,
    'approvals', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION app_delete_tax_rule_pack(uuid, uuid, uuid) FROM PUBLIC, contable_runtime;
REVOKE ALL ON FUNCTION app_delete_tax_rule_version(uuid, uuid, uuid) FROM PUBLIC, contable_runtime;
REVOKE ALL ON FUNCTION app_delete_tax_rule_pack(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_delete_tax_rule_version(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_delete_tax_rule_pack(text, text, text) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_delete_tax_rule_version(text, text, text) TO contable_runtime;

-- Los catálogos fiscales son globales y sus registros pueden estar referidos
-- por otros estudios. Estas funciones producen el preview agregado y ejecutan
-- la baja sólo si no se afectan referencias ajenas.
CREATE OR REPLACE FUNCTION app_tax_catalog_deletion_preview(
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
  v_count bigint;
  v_own_count bigint;
  v_result jsonb;
BEGIN
  IF current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.user_id', true) IS DISTINCT FROM p_user_id
     OR NOT app_is_firm_owner(p_firm_id, p_user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  CASE p_entity_kind
    WHEN 'AUTHORITY' THEN
      SELECT code INTO v_code FROM tax_authorities
      WHERE id = p_entity_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      SELECT count(*) INTO v_count FROM tax_regimes WHERE "authorityId" = p_entity_id;
      v_result := jsonb_build_object(
        'regimes', v_count,
        'sources', (SELECT count(*) FROM normative_sources WHERE "authorityId" = p_entity_id),
        'credentials', (SELECT count(*) FROM professional_credentials WHERE "authorityId" = p_entity_id)
      );
    WHEN 'REGIME' THEN
      SELECT code INTO v_code FROM tax_regimes
      WHERE id = p_entity_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      SELECT count(*) INTO v_count FROM tax_registrations WHERE "regimeId" = p_entity_id;
      SELECT count(*) INTO v_own_count FROM tax_registrations
      WHERE "regimeId" = p_entity_id AND "firmId" = p_firm_id;
      v_result := jsonb_build_object(
        'registrations', v_own_count,
        'otherFirmRegistrations', v_count - v_own_count,
        'obligations', (SELECT count(*) FROM tax_obligations WHERE "regimeId" = p_entity_id),
        'settlements', (SELECT count(*) FROM tax_settlements WHERE "regimeId" = p_entity_id),
        'packs', (SELECT count(*) FROM tax_rule_packs WHERE "regimeId" = p_entity_id)
      );
    WHEN 'ACTIVITY' THEN
      SELECT code INTO v_code FROM economic_activities
      WHERE id = p_entity_id AND origin = 'UI' AND "createdByFirmId" = p_firm_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'CATALOG_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
      SELECT count(*) INTO v_count FROM client_activities WHERE "activityId" = p_entity_id;
      SELECT count(*) INTO v_own_count FROM client_activities
      WHERE "activityId" = p_entity_id AND "firmId" = p_firm_id;
      v_result := jsonb_build_object(
        'clientActivities', v_own_count,
        'otherFirmClientActivities', v_count - v_own_count,
        'rateRules', (SELECT count(*) FROM tax_rate_rules WHERE "activityCode" = v_code)
      );
    ELSE
      RAISE EXCEPTION 'CATALOG_KIND_INVALID' USING ERRCODE = '22023';
  END CASE;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION app_delete_tax_catalog_entity(
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
  v_deleted int := 0;
  v_counts jsonb;
BEGIN
  IF current_setting('app.firm_id', true) IS DISTINCT FROM p_firm_id
     OR current_setting('app.user_id', true) IS DISTINCT FROM p_user_id
     OR NOT app_is_firm_owner(p_firm_id, p_user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  CASE p_entity_kind
    WHEN 'AUTHORITY' THEN PERFORM 1 FROM tax_authorities WHERE id = p_entity_id FOR UPDATE;
    WHEN 'REGIME' THEN PERFORM 1 FROM tax_regimes WHERE id = p_entity_id FOR UPDATE;
    WHEN 'ACTIVITY' THEN PERFORM 1 FROM economic_activities WHERE id = p_entity_id FOR UPDATE;
    ELSE RAISE EXCEPTION 'CATALOG_KIND_INVALID' USING ERRCODE = '22023';
  END CASE;

  v_impact := app_tax_catalog_deletion_preview(p_entity_kind, p_entity_id, p_firm_id, p_user_id);

  IF p_entity_kind = 'AUTHORITY' THEN
    IF (v_impact->>'regimes')::bigint + (v_impact->>'sources')::bigint +
       (v_impact->>'credentials')::bigint > 0 THEN
      RAISE EXCEPTION 'CATALOG_IN_USE' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM tax_authorities WHERE id = p_entity_id;
    v_counts := jsonb_build_object('tax_authorities', 1);
  ELSIF p_entity_kind = 'REGIME' THEN
    IF (v_impact->>'otherFirmRegistrations')::bigint + (v_impact->>'obligations')::bigint +
       (v_impact->>'settlements')::bigint + (v_impact->>'packs')::bigint > 0 THEN
      RAISE EXCEPTION 'CATALOG_IN_USE' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM tax_registrations
    WHERE "firmId" = p_firm_id AND "regimeId" = p_entity_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    DELETE FROM tax_regimes WHERE id = p_entity_id;
    v_counts := jsonb_build_object('tax_registrations', v_deleted, 'tax_regimes', 1);
  ELSE
    IF (v_impact->>'otherFirmClientActivities')::bigint + (v_impact->>'rateRules')::bigint > 0 THEN
      RAISE EXCEPTION 'CATALOG_IN_USE' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM client_activities
    WHERE "firmId" = p_firm_id AND "activityId" = p_entity_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    DELETE FROM economic_activities WHERE id = p_entity_id;
    v_counts := jsonb_build_object('client_activities', v_deleted, 'economic_activities', 1);
  END IF;

  RETURN jsonb_build_object(
    'deletedRows', (SELECT coalesce(sum(value::int), 0) FROM jsonb_each_text(v_counts)),
    'counts', v_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION app_tax_catalog_deletion_preview(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_delete_tax_catalog_entity(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_tax_catalog_deletion_preview(text, text, text, text) TO contable_runtime;
GRANT EXECUTE ON FUNCTION app_delete_tax_catalog_entity(text, text, text, text) TO contable_runtime;
