-- Permiso de app_firm_member_name (comentarios y menciones): solo el rol de runtime puede ejecutarla.
-- La función quedó con EXECUTE para PUBLIC en 20261122120000. Solo la usa la API con contable_runtime.
-- Aditiva: no cambia datos ni la definición de la función.
REVOKE EXECUTE ON FUNCTION app_firm_member_name(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_firm_member_name(text, text) TO contable_runtime;
