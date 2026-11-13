-- P2 corte 4a-ii — catálogo de conceptos de ajuste.
-- Los ajustes dejan de clasificarse por el texto de `concept`: la fila de
-- catálogo guarda el comportamiento que consume la liquidación. El texto se
-- conserva y se sigue escribiendo como etiqueta/legado.

BEGIN;

CREATE TABLE "adjustment_concepts" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "behavior" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adjustment_concepts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adjustment_concepts_key_key" ON "adjustment_concepts"("key");
CREATE INDEX "adjustment_concepts_isActive_sortOrder_idx"
  ON "adjustment_concepts"("isActive", "sortOrder");

-- Se siembran las claves que hoy admite settlement-service (C12) con sus
-- sinónimos históricos; los sinónimos comparten el mismo comportamiento.
INSERT INTO "adjustment_concepts"
  ("id", "key", "label", "behavior", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES
  ('ac400000-0000-4000-8000-000000000001', 'GASTO_GERENCIAL_COMPUTABLE', 'Gasto gerencial computable', 'PURCHASE_FACT', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ac400000-0000-4000-8000-000000000002', 'IVA_RESTITUCION', 'Restitución de IVA', 'IVA_RESTITUTION', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ac400000-0000-4000-8000-000000000003', 'RESTITUCION', 'Restitución (alias histórico)', 'IVA_RESTITUTION', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ac400000-0000-4000-8000-000000000004', 'IVA_COMPENSACION', 'Compensación de IVA', 'IVA_COMPENSATION', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ac400000-0000-4000-8000-000000000005', 'COMPENSACION', 'Compensación (alias histórico)', 'IVA_COMPENSATION', true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ac400000-0000-4000-8000-000000000006', 'IIBB_OTRO_CREDITO', 'Otro crédito IIBB', 'IIBB_OTHER_CREDIT', true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ac400000-0000-4000-8000-000000000007', 'IIBB_OTROS_CREDITOS', 'Otros créditos IIBB (alias histórico)', 'IIBB_OTHER_CREDIT', true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ac400000-0000-4000-8000-000000000008', 'OTRO_CREDITO', 'Otro crédito (alias histórico)', 'IIBB_OTHER_CREDIT', true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "tax_adjustments" ADD COLUMN "conceptId" TEXT;
ALTER TABLE "tax_adjustments"
  ADD CONSTRAINT "tax_adjustments_conceptId_fkey"
    FOREIGN KEY ("conceptId") REFERENCES "adjustment_concepts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "tax_adjustments_conceptId_idx" ON "tax_adjustments"("conceptId");

-- Backfill por clave exacta: no se adivina el comportamiento de textos
-- desconocidos. Esos ajustes quedan con conceptId NULL y, como antes, no
-- entran al cálculo (no eran parte de la lista admitida).
UPDATE "tax_adjustments" a
SET "conceptId" = c."id"
FROM "adjustment_concepts" c
WHERE a."conceptId" IS NULL AND a."concept" = c."key";

DO $$ BEGIN
  GRANT SELECT ON "adjustment_concepts" TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
