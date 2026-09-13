# Manual de Prisma y PostgreSQL — Contable

> Guía operativa para trabajar con Prisma 7 y PostgreSQL en este monorepo.
> Cubre: entorno local, migraciones, RLS, roles y troubleshooting.

## 1. Entorno local

### 1.1 PostgreSQL

En macOS hay **dos** Postgres posibles:

- **Postgres 17.9 local (Homebrew)** — escucha en `localhost:5432` (PID del host).
- **Postgres 18 en Docker** — no puede bindear `5432` si el local ya lo ocupa.

**Decisión:** usar el **Postgres local (Homebrew)** para desarrollo. El docker queda para CI/staging.

Credenciales de desarrollo:

| Rol | Password | Uso |
|---|---|---|
| `contable` | `contable` | Migraciones, seed, owner (superuser) |
| `contable_runtime` | `runtime_secret` | Rol runtime de la app (sin `BYPASSRLS`, sin owner) |

Base de datos: `contable`.

### 1.2 Variables de entorno

`apps/api/.env`:

```env
DATABASE_URL="postgresql://contable:contable@localhost:5432/contable?schema=public"
```

Para tests de aislamiento RLS (rol runtime):

```env
RUNTIME_DATABASE_URL="postgresql://contable_runtime:runtime_secret@localhost:5432/contable"
```

## 2. Prisma 7 — diferencias clave

Prisma 7 cambió respecto a versiones anteriores:

1. **`url` NO va en `schema.prisma`.** Se mueve a `prisma.config.ts`.
2. El cliente usa **driver adapter** (`@prisma/adapter-pg`).
3. `migrate dev` con usuario superuser falla con `P1010` por la shadow database.

### 2.1 `prisma.config.ts`

```ts
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    adapter: () =>
      new PrismaPg({
        connectionString: process.env.DATABASE_URL ?? "",
      }),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
```

### 2.2 Cliente Prisma

`apps/api/src/lib/prisma.ts`:

```ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://contable:contable@localhost:5432/contable";

const adapter = new PrismaPg({ connectionString });
export const prisma = new PrismaClient({ adapter });
```

### 2.3 Generar el cliente

```bash
cd apps/api
npx prisma generate
```

Genera el cliente en `node_modules/@prisma/client`.

## 3. Migraciones

### 3.1 Problema con `migrate dev`

`npx prisma migrate dev` falla con `P1010: User was denied access` cuando el usuario es superuser, porque Prisma intenta crear una shadow database y el driver adapter no la resuelve bien en este setup.

**Workaround:** generar el SQL con `migrate diff` y aplicarlo con `migrate deploy`.

### 3.2 Flujo de migración manual

```bash
cd apps/api
export DATABASE_URL="postgresql://contable:contable@localhost:5432/contable"

# 1. Generar el SQL del schema completo (desde vacío)
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > /tmp/migration.sql

# 2. Crear la carpeta de migración
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_nombre_migracion
cp /tmp/migration.sql prisma/migrations/<timestamp>_nombre/migration.sql

# 3. Aplicar
npx prisma migrate deploy
```

> Nota: `migrate diff` con `--from-empty` genera el schema completo. Para migraciones incrementales usar `--from-schema <schema-anterior>` o `--from-migrations`.

### 3.3 Recuperar de una migración fallida

Si `migrate deploy` falla y deja la migración marcada como fallida:

```bash
# Ver estado
psql -h localhost -U contable -d contable -c "SELECT migration_name, finished_at IS NOT NULL as applied FROM _prisma_migrations;"

# Limpiar registros y re-desplegar (solo en dev)
psql -h localhost -U contable -d contable -c "DELETE FROM _prisma_migrations;"
npx prisma migrate deploy
```

> ⚠️ Solo en desarrollo. En producción usar `prisma migrate resolve --applied|--rolled-back`.

### 3.4 Validar el schema

```bash
cd apps/api
npx prisma validate
```

## 4. RLS (Row Level Security)

### 4.1 Archivos

- `apps/api/prisma/rls.sql` — policies de RLS (idempotente, re-aplicable).
- `apps/api/prisma/rls-isolation-test.sql` — test manual de aislamiento.
- `apps/api/prisma/seed-fase2.sql` — seed de prueba (2 firmas, 3 clientes, 3 membresías).

### 4.2 Aplicar RLS

```bash
psql -h localhost -U contable -d contable -f apps/api/prisma/rls.sql
```

### 4.3 Principios

- `FORCE ROW LEVEL SECURITY` en toda tabla tenant.
- El rol runtime (`contable_runtime`) NO es owner ni tiene `BYPASSRLS`.
- Cada transacción fija contexto con `set_config`:

```sql
SELECT set_config('app.user_id', :user_id, true);
SELECT set_config('app.firm_id', :firm_id, true);
SELECT set_config('app.actor_kind', :actor_kind, true);
```

- Las policies **comparan** el contexto de sesión con cada fila (nunca `firm_id IS NOT NULL`).
- Función helper `app_is_firm_member()` (SECURITY DEFINER) evita recursión en policies.

### 4.4 Nota sobre `CREATE OR REPLACE POLICY`

PostgreSQL **no soporta** `CREATE OR REPLACE POLICY`. Usar:

```sql
DROP POLICY IF EXISTS nombre ON tabla;
CREATE POLICY nombre ON tabla USING (...);
```

### 4.5 Contexto transaccional en Node

`apps/api/src/auth/tenant.ts`:

```ts
withTenantContext({ userId, firmId, actorKind }, async (tx) => { ... });
withoutTenantContext(async (tx) => { ... }); // alta de firmas, auth
```

## 5. Roles y permisos

### 5.1 Crear el rol runtime

```bash
psql -h localhost -U contable -d contable -c "CREATE ROLE contable_runtime LOGIN PASSWORD 'runtime_secret' NOSUPERUSER NOBYPASSRLS;"
```

### 5.2 Otorgar permisos

```bash
psql -h localhost -U contable -d contable -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO contable_runtime;"
psql -h localhost -U contable -d contable -c "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO contable_runtime;"
```

> ⚠️ En producción, otorgar permisos por tabla según necesidad, no `ALL TABLES`.

## 6. Verificar RLS

### 6.1 Tablas con RLS y FORCE

```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relname NOT LIKE '_prisma%'
ORDER BY c.relname;
```

### 6.2 Test de aislamiento

```bash
psql -h localhost -U contable -d contable -f apps/api/prisma/rls-isolation-test.sql
```

Resultados esperados:
- Runtime sin contexto → 0 clientes.
- Owner A con contexto → ve clientes de Alfa.
- Owner A con contexto → NO ve clientes de Beta (cruce = 0).
- Runtime NO puede deshabilitar RLS (error "must be owner").

### 6.3 Test automatizado

`apps/api/src/auth/tenant.test.ts` usa un cliente Prisma con el rol runtime para validar el aislamiento real. Requiere DB local con RLS y seed aplicados.

## 7. Seed de prueba

```bash
psql -h localhost -U contable -d contable -f apps/api/prisma/seed-fase2.sql
```

Crea:
- 2 firmas (Alfa, Beta).
- 3 clientes (2 de Alfa, 1 de Beta).
- 3 membresías (Owner A→Alfa, Owner B→Beta, Preparer A→Alfa).
- 1 asignación (Preparer A → Cliente Alfa Uno).

> Nota: `@updatedAt` en Prisma no tiene default en SQL directo; el seed debe pasar `now()` explícito.

## 8. Troubleshooting

| Problema | Causa | Solución |
|---|---|---|
| `P1010: User was denied access` en `migrate dev` | Shadow DB con superuser + adapter | Usar `migrate diff` + `migrate deploy` |
| `syntax error at or near "POLICY"` | `CREATE OR REPLACE POLICY` no existe | `DROP POLICY IF EXISTS` + `CREATE POLICY` |
| `infinite recursion detected in policy` | Policy consulta su propia tabla | Usar función helper `app_is_firm_member()` |
| `column "firmId" does not exist` | camelCase sin comillas | Usar `"firmId"` (comillas dobles) |
| `null value in column "updatedAt"` | `@updatedAt` sin default en SQL | Pasar `now()` explícito en el seed |
| Docker postgres no arranca | Montaje viejo `/var/lib/postgresql/data` | Montar en `/var/lib/postgresql` (PG 18+) |
| Puerto 5432 ocupado | Postgres local Homebrew | Usar el local; detener docker postgres |
| `migrate found failed migrations` | Migración fallida previa | Limpiar `_prisma_migrations` (dev) o `migrate resolve` |
| `Cannot find module './password.js'` | Import relativo incorrecto | Verificar ruta (auth/ vs firms/) |

## 9. Referencias

- [Prisma 7 — config datasource](https://pris.ly/d/config-datasource)
- [Prisma 7 — client config](https://pris.ly/d/prisma7-client-config)
- [PostgreSQL — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL — versionado](https://www.postgresql.org/support/versioning/)
