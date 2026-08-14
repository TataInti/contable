# ADR-007 — Monolito modular Node más workers

- **Estado:** Aceptado
- **Fecha:** 2026-08-12
- **Decisión:** [Sección 5.4 del plan](../../PLAN_DESARROLLO_CONTABLE.md)

## Contexto

El plan define una API Node (Fastify/Prisma) y un worker Node (BullMQ). Se prioriza simplicidad operacional y evitar microservicios innecesarios.

## Decisión

- Monolito modular Node (API) más workers separados por cola.
- BullMQ sobre Valkey como única cola de ejecución del producto; PostgreSQL/outbox conserva la intención durable y permite reconstruir trabajos.
- Colas separadas: `documents`, `exports`, `notifications`, `recurrences`, `ai`, `maintenance`.
- Dead-letter lógico mediante estado `DEAD_LETTER` y panel de reintentos.
- Jobs idempotentes por clave natural o `deduplicationKey`.
- El worker obtiene una URL firmada de MinIO, invoca FastAPI en la red privada y entrega el resultado a la API mediante un comando interno autenticado.
- Si el worker cae, BullMQ reintenta; FastAPI debe reconocer `extractionRunId` y devolver el mismo resultado o continuar el run existente.

## Consecuencias

- No se introducen microservicios distribuidos en v1.
- La arquitectura contractual no depende de Docker Compose, pero la primera operación sí será deliberadamente simple.
- Los procesos se mantienen stateless donde sea razonable para poder migrar a orquestación mayor sin cambiar contratos.

## Alternativas consideradas

- **Microservicios por dominio:** descartado por complejidad operacional sin beneficio a la escala prevista.