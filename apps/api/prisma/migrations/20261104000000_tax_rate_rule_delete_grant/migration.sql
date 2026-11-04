-- El reemplazo de reglas de una versión DRAFT elimina las filas existentes
-- antes de insertar el conjunto nuevo. La API valida el estado de la versión;
-- el rol runtime necesita este privilegio para completar esa operación.
GRANT DELETE ON tax_rate_rules TO contable_runtime;
