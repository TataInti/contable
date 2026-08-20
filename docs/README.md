# Documentación de Contable

> Especificación ejecutable y validación del dominio fiscal. El plan maestro
> ([`PLAN_DESARROLLO_CONTABLE.md`](../PLAN_DESARROLLO_CONTABLE.md)) es la fuente
> rectora; esta carpeta documenta el estado actual, la transición y los desafíos pendientes.

## Índice

| Documento | Contenido |
|---|---|
| [Plan de cierre de gaps](./plan-cierre-gaps.md) | **Plan ejecutable** de los gaps funcionales detectados (2026-08-19), por fases y con verificación |
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
| [Especificación liquidación manual (Excel)](./especificacion-liquidacion-manual-excel.md) | Lógica completa del workbook `demo-liquidacion-manual.xlsx` como especificación técnica del flujo a replicar (IVA, IIBB, TEM) |
| [Proceso de liquidación mensual](./proceso-liquidacion-mensual.md) | Vista de procesos: actores, cadena de valor, flujo de trabajo con diagrama Mermaid |
| [Runbooks del piloto](./runbooks-piloto.md) | Operación y recuperación del piloto (11 runbooks) |
| [Checklist de sign-off Puerta 6](./checklist-signoff-puerta6.md) | Evidencia binaria PASS/FAIL de la Puerta 6 |
| [Evidencia corrida histórica](./piloto/g6-corrida-historica.md) | 3 períodos históricos FINALIZED con hashes (G6-02) |

## Estado del proyecto (2026-08-19)

- **Puerta 0 — Contención:** ✅ completada. IVA legacy bloqueado por flag, asientos automáticos retirados, enums unificados, outbox con lease/retry/dead-letter, CI con PostgreSQL/Valkey/MinIO, datos demo aislados, Git restaurado.
- **Puerta 1 — Fundación fiscal:** ✅ completada. Baseline fiscal + RLS, maestros, perfil fiscal versionado, reglas con fuente/vigencia/hash/aprobación, `packages/tax-engine`, contratos Zod, capabilities fiscales, onboarding fiscal UI, calendario determinista.
- **Puerta 2 — Ingestión y subledger:** ✅ completada. ImportBatch/ImportRow + adaptadores ARCA/DGR/SMT/CM03, FiscalVoucher con componentes, deduplicación, ManagementExpense, revisión independiente, importación atómica e idempotente.
- **Puerta 3 — Vertical IVA:** ✅ completada. Motor puro, cobertura/cálculo/diferencias, maker-checker, inmutabilidad SQL (triggers), papel de trabajo/export, presentación/pago, rectificativa con delta, worklist, portal de resultado publicado, E2E RI.
- **Puerta 4 — IIBB/TEM/CM03/Monotributo:** ✅ completada (motores + adaptadores + E2E). Pendiente: revalidación normativa y golden cases firmados por contador.
- **Puerta 5 — Rentabilidad y portal:** ✅ completada. Devengado/caja separados, publicación versionada, dashboard de cartera por riesgo, portal con pendientes/impuestos/pagos/rentabilidad, timeline por obligación, recibos persistentes.
- **Puerta 6 — Piloto y endurecimiento:** 🔄 en curso. Avance: activación progresiva por régimen (flags `TAX_*`), ciclo piloto RI completo, seed de carga (300 clientes), corrida histórica (3 períodos), runbooks y checklist de sign-off. Pendiente: clientes piloto reales, restore drill, benchmark medido, auditoría de seguridad, golden cases firmados, sign-off.

## Desafíos pendientes (resumen)

El detalle completo está en [`plan-cierre-gaps.md`](./plan-cierre-gaps.md). Resumen por severidad:

- **🔴 Críticos:** estación de trabajo de liquidación (5 zonas), pedidos documentales ligados a `obligationId`, estación documental con preview de evidencia, filing con acuse, libro de créditos (`GET /tax-credit-ledger`).
- **🟠 Altos:** upload de lote, workflow de vouchers separado, rutas de management expense, filtros período/cutoff en lecturas, 202+jobId, 410 legacy, guard deny-by-default, idempotency/ETag.
- **🟡 Medios:** descarga de papeles en portal, selector de período en rentabilidad, diálogos accesibles, cálculos del Excel en el motor (Dto. 814, mora, prorrata, rubros, conciliación).
- **🔵 Bajos:** scripts canónicos `ci:*`, E2E en CI, ClamAV, property tests, golden tests firmados, OpenAPI 3.1 + cliente TS, observabilidad `/metrics`, alineación matriz-permisos.

## Estado de documentos

- **ADRs:** 7 aceptados.
- **Glosario:** congelado.
- **Invariantes:** 60+ escenarios Given/When/Then en 10 áreas.
- **Matriz de permisos:** 5 roles × 30+ capacidades (⚠️ divergencia menor con `capabilities.ts`: `ai.use`/`bi.use`).
- **Threat model:** 12 escenarios de mayor impacto + por frontera.
- **Fixtures:** borradores pendientes de validación profesional.
- **Checklist normativo:** pendiente de responsables.
- **Contratos Node–FastAPI:** definidos.
- **Schemas de extracción:** `voucher-ar-v1` y `bank-statement-ar-v1` (borrador técnico).
- **Catálogo de tools IA:** lectura/propuesta, sin tools prohibidas.
- **Catálogo semántico BI:** métricas, dimensiones y filtros allowlisted.
- **Runbooks del piloto:** 11 runbooks operativos.
- **Checklist de sign-off Puerta 6:** en forma, mayoría de ítems pendientes de evidencia.

## Pendientes transversales

- [ ] Validación profesional de fixtures contables/fiscales (contador).
- [ ] Validación profesional de fixtures documentales (contador).
- [ ] Asignación de responsables en el checklist normativo.
- [ ] Aprobación jurídica de la política de retención.
- [ ] Golden cases firmados por contador matriculado (por régimen).
- [ ] Revisar el seed normativo inicial contra fuentes vigentes.
- [ ] Ejecutar el plan de cierre de gaps ([`plan-cierre-gaps.md`](./plan-cierre-gaps.md)).
- npm workspaces, TypeScript estricto, ESLint, Vitest, Playwright.
- Entorno Python con lockfile, lint, type checking y pytest.
- Docker Compose con PostgreSQL, MinIO, Valkey, ClamAV, API, worker, FastAPI y Nginx.
- CI bloqueante.
- Design system, tokens y primitives.
- Shell del estudio y shell del portal.
- OpenAPI y SDK frontend generado.