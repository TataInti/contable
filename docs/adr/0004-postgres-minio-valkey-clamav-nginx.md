# ADR-004 — PostgreSQL/pgvector, MinIO, Valkey/BullMQ, ClamAV y Nginx

- **Estado:** Aceptado
- **Fecha:** 2026-08-12
- **Decisión:** [Sección 5.6 del plan](../../PLAN_DESARROLLO_CONTABLE.md)

## Contexto

El plan define la infraestructura de datos y servicios. Se prioriza simplicidad operacional: no agregar una base o servicio si PostgreSQL resuelve el problema a la escala prevista.

## Decisión

- **PostgreSQL 18** como fuente de verdad, con pgvector únicamente para recuperación semántica.
- **MinIO** privado con buckets separados: `quarantine`, `originals`, `derived`, `exports`.
- **Valkey** para BullMQ, rate limiting, locks cortos y pub/sub de progreso.
- **ClamAV** antes de mover un objeto de cuarentena a originales.
- **SMTP** para emails salientes.
- **Nginx** es el único servicio expuesto a Internet.
- **OpenTelemetry** para trazas, métricas y correlación entre web, API, worker y FastAPI.

## Consecuencias

- PostgreSQL, Valkey, MinIO, ClamAV y FastAPI quedan en red privada.
- Valkey no es fuente de verdad; los jobs persistentes se reconstruyen desde PostgreSQL/outbox.
- No se usan ClickHouse, Neo4j ni LanceDB en el primer despliegue.
- Los exports no consultan tablas fuera del contexto de firma/cliente.

## Alternativas consideradas

- **ClickHouse/Neo4j/LanceDB:** descartados en v1; PostgreSQL/pgvector y un solo pipeline BI cubren la escala definida (hasta 5 estudios, 300 clientes, 10.000 documentos/mes).
