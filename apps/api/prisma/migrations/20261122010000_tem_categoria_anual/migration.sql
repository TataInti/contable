-- Categoría anual del TEM (Ordenanza 4.536 y categorización DIM): el mínimo mensual
-- depende de la categoría que el contador indica una vez por año para cada cliente.
-- Migración aditiva: dos tablas nuevas y el INSERT idempotente de los mínimos 2026.
-- No altera tablas, columnas ni datos existentes.

-- Catálogo de mínimos mensuales por categoría y año (dato, no constante en código).
CREATE TABLE "tem_category_minimums" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tem_category_minimums_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tem_category_minimums_year_category_key"
    ON "tem_category_minimums"("year", "category");

-- Mínimos mensuales 2026 (DIM, «TEM Categorización Año 2026», RG DIM 02/2026).
INSERT INTO "tem_category_minimums" ("id", "year", "category", "label", "sortOrder", "amount", "source", "createdAt")
VALUES
    (gen_random_uuid()::text, 2026, 'A',      'A',      1, 6210.0000,  'DIM San Miguel de Tucumán, categorización TEM 2026 (RG DIM 02/2026)', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, 2026, 'B',      'B',      2, 10028.0000, 'DIM San Miguel de Tucumán, categorización TEM 2026 (RG DIM 02/2026)', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, 2026, 'C',      'C',      3, 14674.0000, 'DIM San Miguel de Tucumán, categorización TEM 2026 (RG DIM 02/2026)', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, 2026, 'D',      'D',      4, 18998.0000, 'DIM San Miguel de Tucumán, categorización TEM 2026 (RG DIM 02/2026)', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, 2026, 'E',      'E',      5, 26910.0000, 'DIM San Miguel de Tucumán, categorización TEM 2026 (RG DIM 02/2026)', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, 2026, 'GRANDE', 'Grande', 6, 67298.0000, 'DIM San Miguel de Tucumán, categorización TEM 2026 (RG DIM 02/2026)', (now() AT TIME ZONE 'UTC'))
ON CONFLICT ("year", "category") DO NOTHING;

-- Categoría anual de cada cliente: una por cliente y año, validada contra el catálogo.
CREATE TABLE "client_tem_categories" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_tem_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "client_tem_categories_firmId_clientId_year_key"
    ON "client_tem_categories"("firmId", "clientId", "year");

ALTER TABLE "client_tem_categories"
    ADD CONSTRAINT "client_tem_categories_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_tem_categories"
    ADD CONSTRAINT "client_tem_categories_firmId_clientId_fkey"
    FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_tem_categories"
    ADD CONSTRAINT "client_tem_categories_year_category_fkey"
    FOREIGN KEY ("year", "category") REFERENCES "tem_category_minimums"("year", "category")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: el catálogo lo leen los miembros del estudio; la categoría del cliente,
-- quien accede al cliente (sin borrado físico).
ALTER TABLE "tem_category_minimums" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tem_category_minimums" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tem_category_minimums_select" ON "tem_category_minimums" FOR SELECT
    USING (app_is_firm_member(current_setting('app.firm_id', true), current_setting('app.user_id', true)));

GRANT SELECT ON "tem_category_minimums" TO contable_runtime;

ALTER TABLE "client_tem_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_tem_categories" FORCE ROW LEVEL SECURITY;

CREATE POLICY "client_tem_categories_select" ON "client_tem_categories" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));

CREATE POLICY "client_tem_categories_insert" ON "client_tem_categories" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

CREATE POLICY "client_tem_categories_update" ON "client_tem_categories" FOR UPDATE
    USING (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    )
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

GRANT SELECT, INSERT, UPDATE ON "client_tem_categories" TO contable_runtime;
REVOKE DELETE ON "client_tem_categories" FROM contable_runtime;
