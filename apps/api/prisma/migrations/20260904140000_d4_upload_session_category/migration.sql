-- C/D (§10): categoría declarada en la sesión de carga del portal para que
-- el documento herede la categoría (p.ej. ACUSE de una presentación fiscal).

ALTER TABLE "upload_sessions" ADD COLUMN "category" TEXT;
