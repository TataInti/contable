# ADR-006 — RLS obligatorio y runtime non-owner

- **Estado:** Aceptado
- **Fecha:** 2026-08-12
- **Decisión:** [Sección 6.3 del plan](../../PLAN_DESARROLLO_CONTABLE.md)

## Contexto

El plan exige aislamiento multi-tenant con doble barrera: autorización por capacidades en Node y RLS comparativa en PostgreSQL. `example-platform` tiene una advertencia explícita: [`rls_corporate.sql`](../../example-platform/prisma/manual-sql/operations/rls_corporate.sql) comprueba sólo que `org_id` no sea nulo, lo que no aísla tenants, y el owner de tablas puede evadir RLS.

## Decisión

- Todas las tablas tenant tendrán políticas con `FORCE ROW LEVEL SECURITY`.
- El rol runtime no será owner de tablas ni tendrá `BYPASSRLS`.
- Cada transacción establece:

```sql
SELECT set_config('app.user_id', :user_id, true);
SELECT set_config('app.firm_id', :firm_id, true);
SELECT set_config('app.actor_kind', :actor_kind, true);
```

- Las policies comprueban membresía activa y, cuando corresponde, asignación o membresía portal.
- Las claves foráneas compuestas incluyen `firm_id` y `client_id` para impedir relaciones cruzadas incluso ante un bug de aplicación.
- Las respuestas ante recursos fuera de scope serán `404` cuando revelar existencia sea sensible; `403` se reserva para recursos conocidos dentro de la firma cuando el usuario carece de una capacidad de acción.

## Consecuencias

- El runtime DB no puede deshabilitar ni evadir RLS.
- Reemplazar IDs en URL no revela datos.
- Se necesita un helper transaccional `withTenantContext`.
- Las pruebas de aislamiento deben usar el rol runtime real, no el owner.

## Alternativas consideradas

- **Sólo autorización en aplicación:** descartado; el plan exige doble barrera.
- **RLS sin `FORCE`:** descartado; el owner podría evadirlo.