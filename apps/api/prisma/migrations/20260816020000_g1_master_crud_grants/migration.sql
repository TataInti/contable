-- G1: los maestros fiscales se administran desde la API del estudio
-- (jurisdicciones, autoridades, impuestos, regímenes, actividades y
-- matrículas). El runtime necesita CRUD, no sólo SELECT.
-- Las políticas RLS ya restringen por firma y actor != PORTAL.

DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON
    jurisdictions,
    tax_authorities,
    tax_types,
    tax_regimes,
    economic_activities,
    professional_credentials,
    holidays
  TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;