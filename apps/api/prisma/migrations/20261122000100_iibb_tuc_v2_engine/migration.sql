-- IIBB local Tucumán, base negativa (ar-iibb-tuc-local-v1.2.0; brief 4E, regla 3).
-- Aditiva: registra un motor nuevo en la familia IIBB_LOCAL_TUC. La fila
-- iibb-local-tuc (v1.1.0) y las liquidaciones ya calculadas no cambian.
INSERT INTO "tax_engines"
  ("id", "engineKey", "engineVersion", "familyId", "label", "isActive",
   "sortOrder", "createdAt", "updatedAt")
VALUES
  ('e1000000-0000-4000-8000-00000000000b', 'iibb-local-tuc-v2',
   'ar-iibb-tuc-local-v1.2.0', 'f1000000-0000-4000-8000-000000000002',
   'IIBB local Tucumán (base negativa)', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("engineKey") DO NOTHING;
