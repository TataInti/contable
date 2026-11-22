-- Brief 4L: la actividad vale desde siempre salvo que haya un cambio de actividad registrado.
-- Migración aditiva: columnas con default (isChange = false para todas las vinculaciones existentes),
-- sin borrar datos ni cambiar RLS. El runtime no necesita DELETE sobre client_activities.

ALTER TABLE "client_activities"
    ADD COLUMN "isChange" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "changeReason" TEXT;
