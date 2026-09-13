-- Una evidencia sólo puede tener una imputación activa dentro de la misma
-- obligación del expediente. La jurisdicción es un atributo corregible de
-- esa imputación, no parte de su identidad.

DROP INDEX IF EXISTS "tax_input_allocations_workpaperId_sourceType_sourceId_obligationId_jurisdictionId_key";

CREATE UNIQUE INDEX "tax_input_allocations_workpaperId_sourceType_sourceId_obligationId_key"
  ON "tax_input_allocations"("workpaperId", "sourceType", "sourceId", "obligationId");
