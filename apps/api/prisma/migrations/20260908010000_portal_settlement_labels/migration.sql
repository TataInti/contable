-- El portal no lee maestros globales directamente: las políticas de RLS los
-- reservan para miembros del estudio. Esta función expone sólo las etiquetas
-- de liquidaciones FINALIZED ya acotadas a una firma y cliente.
CREATE OR REPLACE FUNCTION app_portal_settlement_tax_labels(
  p_firm_id text,
  p_client_id text
)
RETURNS TABLE(
  "settlementId" text,
  "taxTypeCode" text,
  "taxTypeName" text,
  "regimeCode" text,
  "regimeName" text,
  "jurisdictionCode" text,
  "jurisdictionName" text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    tt.code,
    tt.name,
    tr.code,
    tr.name,
    j.code,
    j.name
  FROM tax_settlements s
  JOIN tax_types tt ON tt.id = s."taxTypeId"
  JOIN tax_regimes tr ON tr.id = s."regimeId"
  JOIN jurisdictions j ON j.id = s."jurisdictionId"
  WHERE s."firmId" = p_firm_id
    AND s."clientId" = p_client_id
    AND s.status = 'FINALIZED'
$$;

REVOKE ALL ON FUNCTION app_portal_settlement_tax_labels(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_portal_settlement_tax_labels(text, text) TO contable_runtime;
