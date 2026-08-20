# Registro de Decisiones de Arquitectura (ADR)

Este directorio contiene las decisiones de arquitectura de **Contable**, la plataforma contable multiestudio para estudios argentinos definida en [`PLAN_DESARROLLO_CONTABLE.md`](../../PLAN_DESARROLLO_CONTABLE.md).

## Convención

- Cada ADR es un documento autocontenido con estado, contexto, decisión y consecuencias.
- Un ADR **aceptado** es vinculante: no se reabre salvo que el propietario del producto modifique expresamente el alcance.
- Un ADR **propuesto** está en discusión y no debe implementarse como si fuera definitivo.
- Toda decisión nueva se agrega a la sección 2 del plan y, si es arquitectónica, a un ADR.

## Índice

| ID | Título | Estado |
|---|---|---|
| [ADR-001](./0001-spa-react-vite.md) | SPA React/Vite separada del backend | Aceptado |
| [ADR-002](./0002-node-fastify-autoridad-escritura.md) | Node/Fastify como autoridad de escritura | Aceptado |
| [ADR-003](./0003-fastapi-privado-sin-postgres.md) | FastAPI privado y sin acceso directo a PostgreSQL | Aceptado |
| [ADR-004](./0004-postgres-minio-valkey-clamav-nginx.md) | PostgreSQL/pgvector, MinIO, Valkey/BullMQ, ClamAV y Nginx | Aceptado |
| [ADR-005](./0005-openrouter-zdr-allowlist.md) | OpenRouter con ZDR y allowlist | Aceptado |
| [ADR-006](./0006-rls-obligatorio-runtime-non-owner.md) | RLS obligatorio y runtime non-owner | Aceptado |
| [ADR-007](./0007-monolito-modular-node-workers.md) | Monolito modular Node más workers | Aceptado |
| [ADR-008](./0008-navegacion-foco-liquidacion-fiscal.md) | Navegación enfocada en la liquidación fiscal mensual | Aceptado |
