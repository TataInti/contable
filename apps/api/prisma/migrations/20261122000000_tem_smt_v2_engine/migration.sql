-- TEM San Miguel de Tucumán, Ordenanza 4.536 (ar-tem-smt-v2.0.0).
-- Aditiva: registra un motor nuevo en la familia TEM_SMT. No modifica filas
-- existentes: las liquidaciones ya calculadas siguen con su motor (tem-smt,
-- ar-tem-smt-v1.1.0) y sus pack versions no cambian de versión.
INSERT INTO "tax_engines"
  ("id", "engineKey", "engineVersion", "familyId", "label", "isActive",
   "sortOrder", "createdAt", "updatedAt")
VALUES
  ('e1000000-0000-4000-8000-00000000000a', 'tem-smt-v2',
   'ar-tem-smt-v2.0.0', 'f1000000-0000-4000-8000-000000000004',
   'TEM San Miguel de Tucumán (Ordenanza 4.536)', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("engineKey") DO NOTHING;
