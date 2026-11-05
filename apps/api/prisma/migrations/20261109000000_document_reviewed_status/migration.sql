-- Aprobar una extracción también marca el documento como revisado.
-- La bandeja documental separa "Para revisar" (EXTRACTED) de "Revisados" (REVIEWED);
-- sin este valor el documento aprobado quedaba eternamente en "Para revisar".
ALTER TYPE "DocumentStatus" ADD VALUE 'REVIEWED';