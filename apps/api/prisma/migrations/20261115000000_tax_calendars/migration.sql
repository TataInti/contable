-- ============================================================
-- Corte 2a-i: calendarios fiscales (modelo, cobertura y resolucion)
--
-- Migracion aditiva escrita a mano. prisma migrate dev queda fuera de este
-- flujo porque detecta drift preexistente y genera sentencias sobre tablas
-- ajenas. Solo crea tipos, tablas nuevas y columnas nulables o con default
-- constante (sin reescritura de datos).
--
-- Patron de RLS, grants y FK compuestas (firmId, id): igual que G1
-- (20260816010000_g1_fiscal_rls). Cada FK de referencia tiene una FK simple
-- (modelada en Prisma) y una FK compuesta (firmId, id) que impide relaciones
-- cruzadas entre estudios.
--
-- Una sola version visible por (estudio, organismo, jurisdiccion, anio):
-- indice unico parcial tax_calendars_one_published_key (solo SQL; Prisma no lo
-- modela).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Tipos
-- ------------------------------------------------------------
CREATE TYPE "TaxCalendarStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'HIDDEN');
CREATE TYPE "TaxCalendarGrouping" AS ENUM ('ENDING_DIGITS', 'ALL', 'ZONE');
CREATE TYPE "TaxCalendarEntryReview" AS ENUM ('PROPOSED', 'REVIEWED', 'FLAGGED');
CREATE TYPE "TaxCalendarAdjustment" AS ENUM ('NONE', 'HOLIDAY', 'WEEKEND', 'NOTE');
CREATE TYPE "TaxDueDateSource" AS ENUM ('CALENDAR', 'RULE', 'MANUAL');

-- ------------------------------------------------------------
-- 2. Fuentes (PDF u otra imagen del calendario; el binario va al storage)
-- ------------------------------------------------------------
CREATE TABLE "tax_calendar_sources" (
  "id" TEXT NOT NULL,
  "firmId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT,
  "pageCount" INTEGER,
  "hasTextLayer" BOOLEAN,
  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_calendar_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_calendar_sources_byteSize_check" CHECK ("byteSize" > 0)
);

CREATE UNIQUE INDEX "tax_calendar_sources_firmId_id_key" ON "tax_calendar_sources"("firmId", "id");
CREATE UNIQUE INDEX "tax_calendar_sources_firmId_sha256_key" ON "tax_calendar_sources"("firmId", "sha256");

ALTER TABLE "tax_calendar_sources"
  ADD CONSTRAINT "tax_calendar_sources_firmId_fkey"
  FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendar_sources"
  ADD CONSTRAINT "tax_calendar_sources_uploadedByUserId_fkey"
  FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 3. Calendarios (un organismo, una jurisdiccion y un anio; versionados)
-- ------------------------------------------------------------
CREATE TABLE "tax_calendars" (
  "id" TEXT NOT NULL,
  "firmId" TEXT NOT NULL,
  "taxAuthorityId" TEXT NOT NULL,
  "jurisdictionId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "TaxCalendarStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceId" TEXT,
  "supersedesId" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "publishedByUserId" TEXT,
  "publishedAt" TIMESTAMP(3),
  "hiddenByUserId" TEXT,
  "hiddenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tax_calendars_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_calendars_version_check" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "tax_calendars_firmId_id_key" ON "tax_calendars"("firmId", "id");
CREATE UNIQUE INDEX "tax_calendars_version_key"
  ON "tax_calendars"("firmId", "taxAuthorityId", "jurisdictionId", "year", "version");
CREATE INDEX "tax_calendars_scope_idx"
  ON "tax_calendars"("firmId", "taxAuthorityId", "jurisdictionId", "year");
CREATE UNIQUE INDEX "tax_calendars_one_published_key"
  ON "tax_calendars"("firmId", "taxAuthorityId", "jurisdictionId", "year")
  WHERE "status" = 'PUBLISHED';

ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_firmId_fkey"
  FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_taxAuthorityId_fkey"
  FOREIGN KEY ("taxAuthorityId") REFERENCES "tax_authorities"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_jurisdictionId_fkey"
  FOREIGN KEY ("jurisdictionId") REFERENCES "jurisdictions"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "tax_calendar_sources"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_firmId_sourceId_fkey"
  FOREIGN KEY ("firmId", "sourceId") REFERENCES "tax_calendar_sources"("firmId", "id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "tax_calendars"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_firmId_supersedesId_fkey"
  FOREIGN KEY ("firmId", "supersedesId") REFERENCES "tax_calendars"("firmId", "id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_publishedByUserId_fkey"
  FOREIGN KEY ("publishedByUserId") REFERENCES "users"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendars"
  ADD CONSTRAINT "tax_calendars_hiddenByUserId_fkey"
  FOREIGN KEY ("hiddenByUserId") REFERENCES "users"("id") ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 4. Celdas del calendario (un vencimiento por concepto, grupo y periodo)
-- ------------------------------------------------------------
CREATE TABLE "tax_calendar_entries" (
  "id" TEXT NOT NULL,
  "firmId" TEXT NOT NULL,
  "calendarId" TEXT NOT NULL,
  "conceptLabel" TEXT NOT NULL,
  "taxTypeId" TEXT,
  "regimeId" TEXT,
  "groupingKind" "TaxCalendarGrouping" NOT NULL,
  "endingDigits" TEXT,
  "zoneCode" TEXT,
  "referencePeriodStart" TIMESTAMP(3),
  "referencePeriodEnd" TIMESTAMP(3),
  "referenceLabel" TEXT,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "dueDateRaw" TEXT,
  "adjustment" "TaxCalendarAdjustment" NOT NULL DEFAULT 'NONE',
  "noteRef" TEXT,
  "noteText" TEXT,
  "sourcePage" INTEGER,
  "sourceBox" JSONB,
  "reviewState" "TaxCalendarEntryReview",
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "extraction" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_calendar_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_calendar_entries_endingDigits_check"
    CHECK ("groupingKind" <> 'ENDING_DIGITS' OR "endingDigits" ~ '^[0-9]{1,10}$'),
  CONSTRAINT "tax_calendar_entries_referencePeriod_check"
    CHECK ("referencePeriodStart" IS NULL OR "referencePeriodEnd" IS NULL OR "referencePeriodStart" <= "referencePeriodEnd")
);

CREATE UNIQUE INDEX "tax_calendar_entries_firmId_id_key" ON "tax_calendar_entries"("firmId", "id");
CREATE INDEX "tax_calendar_entries_scope_idx" ON "tax_calendar_entries"("firmId", "calendarId");
CREATE INDEX "tax_calendar_entries_regime_due_idx" ON "tax_calendar_entries"("firmId", "regimeId", "dueDate");

ALTER TABLE "tax_calendar_entries"
  ADD CONSTRAINT "tax_calendar_entries_firmId_fkey"
  FOREIGN KEY ("firmId") REFERENCES "firms"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendar_entries"
  ADD CONSTRAINT "tax_calendar_entries_calendarId_fkey"
  FOREIGN KEY ("calendarId") REFERENCES "tax_calendars"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendar_entries"
  ADD CONSTRAINT "tax_calendar_entries_firmId_calendarId_fkey"
  FOREIGN KEY ("firmId", "calendarId") REFERENCES "tax_calendars"("firmId", "id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendar_entries"
  ADD CONSTRAINT "tax_calendar_entries_taxTypeId_fkey"
  FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendar_entries"
  ADD CONSTRAINT "tax_calendar_entries_regimeId_fkey"
  FOREIGN KEY ("regimeId") REFERENCES "tax_regimes"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_calendar_entries"
  ADD CONSTRAINT "tax_calendar_entries_reviewedByUserId_fkey"
  FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 5. Obligaciones: fecha calculada, origen de la fecha y valor manual
--    (columnas nuevas nulables; dueDateSource con default MANUAL)
-- ------------------------------------------------------------
ALTER TABLE "tax_obligations"
  ADD COLUMN "calculatedDueDate" TIMESTAMP(3),
  ADD COLUMN "dueDateSource" "TaxDueDateSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "dueDateEntryId" TEXT,
  ADD COLUMN "dueDateOverrideReason" TEXT,
  ADD COLUMN "dueDateOverriddenByUserId" TEXT,
  ADD COLUMN "dueDateOverriddenAt" TIMESTAMP(3);

CREATE INDEX "tax_obligations_firmId_dueDate_idx" ON "tax_obligations"("firmId", "dueDate");

ALTER TABLE "tax_obligations"
  ADD CONSTRAINT "tax_obligations_dueDateEntryId_fkey"
  FOREIGN KEY ("dueDateEntryId") REFERENCES "tax_calendar_entries"("id") ON UPDATE CASCADE;
ALTER TABLE "tax_obligations"
  ADD CONSTRAINT "tax_obligations_firmId_dueDateEntryId_fkey"
  FOREIGN KEY ("firmId", "dueDateEntryId") REFERENCES "tax_calendar_entries"("firmId", "id") ON UPDATE CASCADE;
ALTER TABLE "tax_obligations"
  ADD CONSTRAINT "tax_obligations_dueDateOverriddenByUserId_fkey"
  FOREIGN KEY ("dueDateOverriddenByUserId") REFERENCES "users"("id") ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- 6. RLS: firma (miembro activo) en las tres tablas nuevas. El portal no escribe.
--    Sin politica de borrado: lo publicado se oculta, no se quita.
-- ------------------------------------------------------------
ALTER TABLE "tax_calendar_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_calendar_sources" FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_scope_select ON "tax_calendar_sources" FOR SELECT
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );
CREATE POLICY firm_scope_insert ON "tax_calendar_sources" FOR INSERT
  WITH CHECK (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );
CREATE POLICY firm_scope_update ON "tax_calendar_sources" FOR UPDATE
  USING (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "tax_calendars" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_calendars" FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_scope_select ON "tax_calendars" FOR SELECT
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );
CREATE POLICY firm_scope_insert ON "tax_calendars" FOR INSERT
  WITH CHECK (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );
CREATE POLICY firm_scope_update ON "tax_calendars" FOR UPDATE
  USING (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

ALTER TABLE "tax_calendar_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_calendar_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_scope_select ON "tax_calendar_entries" FOR SELECT
  USING (
    "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );
CREATE POLICY firm_scope_insert ON "tax_calendar_entries" FOR INSERT
  WITH CHECK (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );
CREATE POLICY firm_scope_update ON "tax_calendar_entries" FOR UPDATE
  USING (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  )
  WITH CHECK (
    current_setting('app.actor_kind', true) <> 'PORTAL'
    AND "firmId" = current_setting('app.firm_id', true)
    AND app_is_firm_member("firmId", current_setting('app.user_id', true))
  );

-- ------------------------------------------------------------
-- 7. Permisos del rol de runtime: lectura y alta/edicion; sin borrado.
-- ------------------------------------------------------------
DO $$ BEGIN
  GRANT SELECT, INSERT, UPDATE ON
    "tax_calendar_sources",
    "tax_calendars",
    "tax_calendar_entries"
  TO contable_runtime;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

COMMIT;
