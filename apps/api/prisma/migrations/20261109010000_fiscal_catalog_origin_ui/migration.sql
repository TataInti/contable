-- Trazabilidad de origen para los catálogos de jurisdicciones e impuestos.
-- Las filas existentes reciben REFERENCE por el DEFAULT; no se reescriben.
ALTER TABLE jurisdictions
  ADD COLUMN "origin" "CatalogOrigin" NOT NULL DEFAULT 'REFERENCE',
  ADD COLUMN "createdByFirmId" text;

ALTER TABLE tax_types
  ADD COLUMN "origin" "CatalogOrigin" NOT NULL DEFAULT 'REFERENCE',
  ADD COLUMN "createdByFirmId" text;

ALTER TABLE jurisdictions
  ADD CONSTRAINT "jurisdictions_createdByFirmId_fkey"
  FOREIGN KEY ("createdByFirmId") REFERENCES firms(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE tax_types
  ADD CONSTRAINT "tax_types_createdByFirmId_fkey"
  FOREIGN KEY ("createdByFirmId") REFERENCES firms(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "jurisdictions_createdByFirmId_idx" ON jurisdictions("createdByFirmId");
CREATE INDEX "tax_types_createdByFirmId_idx" ON tax_types("createdByFirmId");

-- La API escribe y el flujo Titular usa DELETE tras validar origen y dependencias.
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE ON jurisdictions, tax_types TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
