-- Corte 5a: declaración jurada (DJ) con sus importes, colgada de la presentación.
-- D13-4 a: detalle del saldo a favor por impuesto y jurisdicción (JSONB nullable).
-- Migración aditiva: agrega columnas nullables a tax_filings y una clave foránea a documents.
-- No cambia datos, no crea tablas y no altera columnas existentes. Las columnas nuevas
-- heredan la política RLS por estudio de tax_filings y sus privilegios de tabla.
-- La clave foránea no declara regla de borrado (queda NO ACTION): un documento que
-- respalda una DJ no se puede quitar mientras esté adjunto.

ALTER TABLE "tax_filings"
  ADD COLUMN "declarationDocumentId" TEXT,
  ADD COLUMN "impuestoDeterminado" NUMERIC(20,4),
  ADD COLUMN "saldoFavorTecnico" NUMERIC(20,4),
  ADD COLUMN "saldoLibreDisponibilidad" NUMERIC(20,4),
  ADD COLUMN "totalAPagar" NUMERIC(20,4),
  ADD COLUMN "declaredByUserId" TEXT,
  ADD COLUMN "declaredAt" TIMESTAMP(3),
  ADD COLUMN "saldosFavorDetalle" JSONB;

ALTER TABLE "tax_filings"
  ADD CONSTRAINT "tax_filings_declarationDocumentId_fkey"
  FOREIGN KEY ("declarationDocumentId") REFERENCES "documents"("id") ON UPDATE CASCADE;
