-- ============================================================
-- G3-05: Inmutabilidad SQL de liquidaciones finalizadas
--
-- Una TaxSettlement FINALIZED no puede modificarse ni eliminarse,
-- ni siquiera con acceso SQL directo (rol runtime sin BYPASSRLS).
-- La rectificación crea una versión nueva; la anterior queda
-- FINALIZED e inmutable (V-003).
--
-- También se protege la integridad de los snapshots:
--   - settlement_inputs y tax_settlement_lines de una liquidación
--     FINALIZED no se modifican ni borran.
--   - tax_differences de una FINALIZED no se borran (historial).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Trigger de inmutabilidad sobre tax_settlements
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_guard_settlement_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_status := OLD."status";
    IF v_status = 'FINALIZED' THEN
      RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: una liquidación finalizada no puede eliminarse'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: la fila previa no puede ser FINALIZED (ni SUPERSEDED de una finalizada).
  v_status := OLD."status";
  IF v_status = 'FINALIZED' THEN
    RAISE EXCEPTION 'SETTLEMENT_IMMUTABLE: una liquidación finalizada no puede modificarse'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settlement_immutable ON tax_settlements;
CREATE TRIGGER trg_settlement_immutable
  BEFORE UPDATE OR DELETE ON tax_settlements
  FOR EACH ROW
  EXECUTE FUNCTION app_guard_settlement_immutable();

-- ------------------------------------------------------------
-- 2. Snapshots de una liquidación finalizada: inmutables
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_guard_settlement_child_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
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

DROP TRIGGER IF EXISTS trg_settlement_input_immutable ON settlement_inputs;
CREATE TRIGGER trg_settlement_input_immutable
  BEFORE UPDATE OR DELETE ON settlement_inputs
  FOR EACH ROW
  EXECUTE FUNCTION app_guard_settlement_child_immutable();

DROP TRIGGER IF EXISTS trg_settlement_line_immutable ON tax_settlement_lines;
CREATE TRIGGER trg_settlement_line_immutable
  BEFORE UPDATE OR DELETE ON tax_settlement_lines
  FOR EACH ROW
  EXECUTE FUNCTION app_guard_settlement_child_immutable();

-- ------------------------------------------------------------
-- 3. Diferencias de una finalizada: no se borran (historial)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_guard_settlement_diff_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
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

DROP TRIGGER IF EXISTS trg_settlement_diff_immutable ON tax_differences;
CREATE TRIGGER trg_settlement_diff_immutable
  BEFORE UPDATE OR DELETE ON tax_differences
  FOR EACH ROW
  EXECUTE FUNCTION app_guard_settlement_diff_immutable();