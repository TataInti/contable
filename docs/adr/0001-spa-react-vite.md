# ADR-001 — SPA React/Vite separada del backend

- **Estado:** Aceptado
- **Fecha:** 2026-08-12
- **Decisión:** [Sección 2.5 del plan](../../PLAN_DESARROLLO_CONTABLE.md)

## Contexto

`example-platform` es una app Next.js 16 con App Router. El plan define que Contable será una SPA React 19 + Vite + TypeScript servida por Nginx, con contratos generados desde OpenAPI. Se necesita una separación clara entre frontend y backend para no arrastrar el acoplamiento de Next.

## Decisión

- Frontend: React 19 + Vite + TypeScript estricto, empaquetado estático servido por Nginx.
- TanStack Router (rutas tipadas), TanStack Query (estado servidor), TanStack Table (tablas densas), React Hook Form + Zod (formularios), PDF.js (revisión documental), Recharts (visualizaciones allowlisted).
- CSS Modules + variables CSS; sin librería visual pesada.
- Cliente API generado desde OpenAPI; no duplicar DTOs manualmente.
- SSE para chat y progreso de jobs.

## Consecuencias

- No se usa Next.js App Router ni sus API Routes en Contable.
- El frontend nunca llama a FastAPI, MinIO interno ni PostgreSQL directamente.
- El SDK frontend se regenera desde OpenAPI 3.1 (fuente de verdad de contratos).
- `example-platform` queda como referencia de patrones, no como dependencia de runtime.

## Alternativas consideradas

- **Next.js:** descartado por acoplamiento de App Router y API Routes, y por la necesidad de una SPA servida por Nginx con contratos generados.
