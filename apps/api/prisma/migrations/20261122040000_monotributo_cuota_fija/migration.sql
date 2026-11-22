-- Monotributo: cuota fija mensual por categoría y tipo de actividad (corte 3F).
-- Aditiva: tres tablas nuevas y el INSERT idempotente de la escala vigente. No altera
-- tablas, columnas ni datos existentes. No crea liquidación ni declaración.
--
-- Fuente de la escala: ARCA, «Montos y categorías vigentes — Monotributo», valores de
-- aplicación desde el 1/08/2026. https://www.afip.gob.ar/monotributo/categorias.asp
-- Consultada el 22/11/2026. Importe: total mensual (impuesto integrado + aportes SIPA +
-- aportes obra social) para «Locaciones y prestaciones de servicios» (SERVICIOS) y
-- «Venta de cosas muebles» (BIENES).

-- Catálogo de cuotas (dato, no constante en código). Una fila por categoría y tipo y
-- vigencia. validTo nulo = vigente.
CREATE TABLE "monotributo_cuotas" (
    "id" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "category" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monotributo_cuotas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "monotributo_cuotas_category_check" CHECK ("category" IN ('A','B','C','D','E','F','G','H','I','J','K')),
    CONSTRAINT "monotributo_cuotas_activity_check" CHECK ("activity" IN ('SERVICIOS','BIENES')),
    CONSTRAINT "monotributo_cuotas_amount_check" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "monotributo_cuotas_validFrom_category_activity_key"
    ON "monotributo_cuotas"("validFrom", "category", "activity");

INSERT INTO "monotributo_cuotas" ("id", "validFrom", "validTo", "category", "activity", "amount", "source", "createdAt")
VALUES
    (gen_random_uuid()::text, '2026-08-01', NULL, 'A', 'SERVICIOS', 49527.18, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'A', 'BIENES', 49527.18, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'B', 'SERVICIOS', 56379.08, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'B', 'BIENES', 56379.08, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'C', 'SERVICIOS', 66020.12, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'C', 'BIENES', 64530.58, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'D', 'SERVICIOS', 84612.93, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'D', 'BIENES', 82564.81, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'E', 'SERVICIOS', 119811.45, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'E', 'BIENES', 108267.51, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'F', 'SERVICIOS', 150784.21, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'F', 'BIENES', 129930.65, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'G', 'SERVICIOS', 230312.94, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'G', 'BIENES', 158815.05, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'H', 'SERVICIOS', 522706.68, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'H', 'BIENES', 317895.01, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'I', 'SERVICIOS', 963747.86, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'I', 'BIENES', 474992.78, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'J', 'SERVICIOS', 1167299.76, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'J', 'BIENES', 580793.69, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'K', 'SERVICIOS', 1614446.04, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC')),
    (gen_random_uuid()::text, '2026-08-01', NULL, 'K', 'BIENES', 702103.24, 'ARCA, Montos y categorías vigentes (desde 1/08/2026), consulta 22/11/2026', (now() AT TIME ZONE 'UTC'))
ON CONFLICT ("validFrom", "category", "activity") DO NOTHING;

-- Categoría y tipo de actividad del cliente por vigencia: cada fila rige desde su mes
-- hasta la siguiente fila (recategorizaciones). Una fila por cliente y mes de inicio.
CREATE TABLE "client_monotributo_categories" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_monotributo_categories_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_monotributo_categories_category_check" CHECK ("category" IN ('A','B','C','D','E','F','G','H','I','J','K')),
    CONSTRAINT "client_monotributo_categories_activity_check" CHECK ("activity" IN ('SERVICIOS','BIENES'))
);

CREATE UNIQUE INDEX "client_monotributo_categories_firmId_clientId_validFrom_key"
    ON "client_monotributo_categories"("firmId", "clientId", "validFrom");

ALTER TABLE "client_monotributo_categories"
    ADD CONSTRAINT "client_monotributo_categories_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_monotributo_categories"
    ADD CONSTRAINT "client_monotributo_categories_firmId_clientId_fkey"
    FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Pagos de la cuota de cada mes (historial). Varias filas por mes admitidas (pagos parciales).
-- El mes se guarda como primer día del mes de la cuota.
CREATE TABLE "client_monotributo_payments" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "paidAt" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "comprobante" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_monotributo_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "client_monotributo_payments_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "client_monotributo_payments_firmId_clientId_period_idx"
    ON "client_monotributo_payments"("firmId", "clientId", "period");

ALTER TABLE "client_monotributo_payments"
    ADD CONSTRAINT "client_monotributo_payments_firmId_fkey"
    FOREIGN KEY ("firmId") REFERENCES "firms"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_monotributo_payments"
    ADD CONSTRAINT "client_monotributo_payments_firmId_clientId_fkey"
    FOREIGN KEY ("firmId", "clientId") REFERENCES "clients"("firmId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: la escala la leen los miembros del estudio; categoría y pagos, quien accede al
-- cliente (sin borrado ni edición de pagos desde el runtime).
ALTER TABLE "monotributo_cuotas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "monotributo_cuotas" FORCE ROW LEVEL SECURITY;

CREATE POLICY "monotributo_cuotas_select" ON "monotributo_cuotas" FOR SELECT
    USING (app_is_firm_member(current_setting('app.firm_id', true), current_setting('app.user_id', true)));

GRANT SELECT ON "monotributo_cuotas" TO contable_runtime;

ALTER TABLE "client_monotributo_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_monotributo_categories" FORCE ROW LEVEL SECURITY;

CREATE POLICY "client_monotributo_categories_select" ON "client_monotributo_categories" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));

CREATE POLICY "client_monotributo_categories_insert" ON "client_monotributo_categories" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

CREATE POLICY "client_monotributo_categories_update" ON "client_monotributo_categories" FOR UPDATE
    USING (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    )
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

GRANT SELECT, INSERT, UPDATE ON "client_monotributo_categories" TO contable_runtime;
REVOKE DELETE ON "client_monotributo_categories" FROM contable_runtime;

ALTER TABLE "client_monotributo_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_monotributo_payments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "client_monotributo_payments_select" ON "client_monotributo_payments" FOR SELECT
    USING (app_can_access_tenant("firmId", "clientId"));

CREATE POLICY "client_monotributo_payments_insert" ON "client_monotributo_payments" FOR INSERT
    WITH CHECK (
        current_setting('app.actor_kind', true) <> 'PORTAL'
        AND app_can_access_tenant("firmId", "clientId")
    );

GRANT SELECT, INSERT ON "client_monotributo_payments" TO contable_runtime;
REVOKE DELETE, UPDATE ON "client_monotributo_payments" FROM contable_runtime;
