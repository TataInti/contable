-- Control de CUIT en la Bandeja (corte 4A-2): dónde queda la aceptación con motivo de un
-- comprobante cuyo CUIT no es el del cliente. Migración aditiva: cuatro columnas nulas en
-- «documents». No altera datos, RLS ni políticas existentes (la tabla ya tiene RLS forzado).

ALTER TABLE "documents"
    ADD COLUMN "cuitAcceptedExtractionId" TEXT,
    ADD COLUMN "cuitAcceptedByUserId" TEXT,
    ADD COLUMN "cuitAcceptedAt" TIMESTAMP(3),
    ADD COLUMN "cuitAcceptedReason" TEXT;
