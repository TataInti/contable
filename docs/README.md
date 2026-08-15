# Documentación de Fase 0 — Contable

> Especificación ejecutable y validación del dominio. Convertir el plan en contratos verificables y fixtures aprobados antes de crear estructuras difíciles de migrar.

## Índice

| Documento | Contenido |
|---|---|
| [Arquitectura viva](./architecture-overview.md) | Diagrama Mermaid de contenedores, transición de módulos y flujo target |
| [ADR](./adr/README.md) | Decisiones de arquitectura (7 ADRs aceptados) |
| [Glosario](./glosario.md) | Terminología de dominio congelada |
| [Invariantes](./invariantes.md) | Escenarios Given/When/Then como tests pendientes |
| [Matriz de permisos](./matriz-permisos.md) | Rol × capacidad × cliente asignado |
| [Threat model](./threat-model.md) | Amenazas por frontera y mitigaciones |
| [Fixtures contables](./fixtures/fixtures-contables.md) | Dataset dorado contable/fiscal (borrador) |
| [Fixtures documentales](./fixtures/fixtures-documentales.md) | Dataset dorado OCR/extracción (borrador) |
| [Checklist normativo](./checklist-normativo.md) | Fuentes normativas y responsables |
| [Contratos Node–FastAPI](./contratos-node-fastapi.md) | Contratos internos y autenticación HMAC |
| [Schemas de extracción](./schemas-extraccion.md) | Campos por tipo documental (`voucher-ar-v1`) |
| [Catálogo de tools IA](./catalogo-tools-ia.md) | Herramientas del asistente (lectura/propuesta) |
| [Catálogo semántico BI](./catalogo-bi.md) | Métricas, dimensiones y filtros allowlisted |
| [Manual Prisma y PostgreSQL](./manual-prisma-postgres.md) | Migraciones, RLS, roles y troubleshooting |

## Estado

- **ADRs:** 7 aceptados.
- **Glosario:** congelado.
- **Invariantes:** 60+ escenarios Given/When/Then en 10 áreas.
- **Matriz de permisos:** 5 roles × 30+ capacidades.
- **Threat model:** 12 escenarios de mayor impacto + por frontera.
- **Fixtures:** borradores pendientes de validación profesional.
- **Checklist normativo:** pendiente de responsables.
- **Contratos Node–FastAPI:** definidos.
- **Schemas de extracción:** `voucher-ar-v1` y `bank-statement-ar-v1` (borrador técnico).
- **Catálogo de tools IA:** lectura/propuesta, sin tools prohibidas.
- **Catálogo semántico BI:** métricas, dimensiones y filtros allowlisted.

## Pendientes de Fase 0

- [ ] Validación profesional de fixtures contables/fiscales (contador).
- [ ] Validación profesional de fixtures documentales (contador).
- [ ] Asignación de responsables en el checklist normativo.
- [ ] Aprobación jurídica de la política de retención.
- [ ] Definir schemas de extracción por tipo documental (voucher-ar-v1). ✅
- [ ] Definir el catálogo inicial de roles/capacidades y tools IA. ✅
- [ ] Definir el catálogo semántico BI. ✅
- [ ] Revisar el seed normativo inicial contra fuentes vigentes.

## Puerta de salida de Fase 0

- [ ] Ningún implementador necesita elegir stack, frontera de servicio, regla de tenancy o fuente de verdad.
- [ ] Invariantes y transiciones expresadas como tests pendientes.
- [ ] Fixtures esperados validados por el responsable contable.
- [ ] Endpoints/contratos de corte entre Node y FastAPI aprobados.

## Siguiente paso (Fase 1)

- Monorepo y paquetes según sección 5 del plan.
- npm workspaces, TypeScript estricto, ESLint, Vitest, Playwright.
- Entorno Python con lockfile, lint, type checking y pytest.
- Docker Compose con PostgreSQL, MinIO, Valkey, ClamAV, API, worker, FastAPI y Nginx.
- CI bloqueante.
- Design system, tokens y primitives.
- Shell del estudio y shell del portal.
- OpenAPI y SDK frontend generado.