-- Corte 6a: el libro de saldos recibe los saldos de la declaración jurada (migración aditiva).
-- Agrega a tax_credit_lots: sourceFilingId (la presentación de la DJ que originó el lote; FK sin
-- cascada) y carryForward (marca de arrastre; por defecto el saldo arrastra). No cambia datos
-- existentes, no borra filas y no altera columnas actuales. tax_credit_lots conserva ENABLE y
-- FORCE RLS y su GRANT a contable_runtime: el privilegio de tabla cubre las columnas nuevas.
-- La FK no abre lectura entre estudios: la lectura sigue por la política RLS de la tabla y el
-- servicio nunca toma sourceFilingId del cliente (lo fija desde la DJ del propio estudio).

ALTER TABLE "tax_credit_lots"
  ADD COLUMN "sourceFilingId" TEXT,
  ADD COLUMN "carryForward" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "tax_credit_lots"
  ADD CONSTRAINT "tax_credit_lots_sourceFilingId_fkey"
  FOREIGN KEY ("sourceFilingId") REFERENCES "tax_filings"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Identidad de la DJ: un solo lote vigente por presentación, clase, régimen y jurisdicción.
-- Un lote SUPERSEDED queda fuera del índice, así la corrección puede crear su reemplazo.
-- NULLS NOT DISTINCT (PostgreSQL 15 o superior; el CI y la base local usan 18) trata el régimen
-- y la jurisdicción nulos como iguales, sin cuatro índices parciales por combinación de nulos.
CREATE UNIQUE INDEX "tax_credit_lots_sourceFilingId_kind_regime_jurisdiction_key"
  ON "tax_credit_lots" ("sourceFilingId", "kind", "regimeId", "jurisdictionId") NULLS NOT DISTINCT
  WHERE "sourceFilingId" IS NOT NULL AND "verificationStatus" <> 'SUPERSEDED';
