# ADR-002 — Node/Fastify como autoridad de escritura

- **Estado:** Aceptado
- **Fecha:** 2026-08-12
- **Decisión:** [Sección 2.5 del plan](../../PLAN_DESARROLLO_CONTABLE.md)

## Contexto

El plan establece que Node y PostgreSQL son la autoridad transaccional. La IA puede clasificar, extraer, resumir y proponer, pero no puede contabilizar ni publicar. Se necesita un backend transaccional que concentre auth, tenancy, ledger, impuestos y publicaciones.

## Decisión

- Backend: Node 22 LTS (baseline de desarrollo) + Fastify + TypeScript + Prisma.
- OpenAPI generado desde schemas Zod.
- Request context con `requestId`, usuario, sesión, firma, cliente y capacidades.
- Cada request de negocio ejecuta una transacción que establece el contexto RLS.
- Servicios por dominio; las rutas no contienen lógica contable.
- Patrón outbox para publicar jobs/notificaciones después de la transacción.
- `Idempotency-Key` persistido y validado para comandos sensibles.
- ETags para edición optimista de borradores y configuración.

## Consecuencias

- Todo comando de posting, cierre, reapertura, publicación y presentación vive en Node.
- FastAPI nunca es autoridad de autorización ni de posting.
- El motor contable (`packages/accounting-engine`) es un paquete puro reutilizable.
- Los estados sólo cambian por endpoints comando; no hay PATCH genérico de `status`.

## Alternativas consideradas

- **Microservicios distribuidos:** descartado; el plan prioriza un monolito modular Node más workers (ver ADR-007).
