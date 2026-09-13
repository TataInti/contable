# Documentación de Contable

> Especificación ejecutable y validación del dominio fiscal. El plan maestro
> ([`PLAN_DESARROLLO_CONTABLE.md`](../PLAN_DESARROLLO_CONTABLE.md)) es la fuente
> rectora; esta carpeta documenta el estado actual, la transición y los desafíos pendientes.

## Índice

| Documento | Contenido |
|---|---|
| [Arquitectura viva](./dev/architecture-overview.md) | Diagrama Mermaid de contenedores, transición de módulos y flujo target |
| [ADR](./adr/README.md) | Decisiones de arquitectura (8 ADRs aceptados) |
| [Glosario](./dev/glosario.md) | Terminología de dominio congelada |
| [Invariantes](./dev/invariantes.md) | Escenarios Given/When/Then como tests pendientes |
| [Matriz de permisos](./dev/matriz-permisos.md) | Rol × capacidad × cliente asignado |
| [Threat model](./dev/threat-model.md) | Amenazas por frontera y mitigaciones |
| [Fixtures contables](./fixtures/fixtures-contables.md) | Dataset dorado contable/fiscal (borrador) |
| [Fixtures documentales](./fixtures/fixtures-documentales.md) | Dataset dorado OCR/extracción (borrador) |
| [Checklist normativo](./dev/checklist-normativo.md) | Fuentes normativas y responsables |
| [Contratos Node–FastAPI](./dev/contratos-node-fastapi.md) | Contratos internos y autenticación HMAC |
| [Schemas de extracción](./dev/schemas-extraccion.md) | Campos por tipo documental (`voucher-ar-v1`) |
| [Catálogo de tools IA](./dev/catalogo-tools-ia.md) | Herramientas del asistente (lectura/propuesta) |
| [Catálogo semántico BI](./dev/catalogo-bi.md) | Métricas, dimensiones y filtros allowlisted |
| [Manual Prisma y PostgreSQL](./dev/manual-prisma-postgres.md) | Migraciones, RLS, roles y troubleshooting |
| [Especificación liquidación manual (Excel)](./especificacion-liquidacion-manual-excel.md) | Lógica completa del workbook `demo-liquidacion-manual.xlsx` como especificación técnica del flujo a replicar (IVA, IIBB, TEM) |
| [Proceso de liquidación mensual](./proceso-liquidacion-mensual.md) | Vista de procesos: actores, cadena de valor, flujo de trabajo con diagrama Mermaid |
| [Guía UI de formularios y paneles emergentes](./dev/guia-ui-formularios-paneles.md) | Estándar de uso de `ActionDrawer`, formularios inline, modales, navegación de procesos y accesibilidad |
| [Runbooks del piloto](./dev/runbooks-piloto.md) | Operación y recuperación del piloto (11 runbooks) |
| [Evidencia corrida histórica](./dev/piloto/g6-corrida-historica.md) | 3 períodos históricos FINALIZED con hashes (G6-02) |
| [Uso gradual del piloto](./piloto/plan-uso-gradual-10-pasos.md) | Secuencia operativa de diez pasos y criterios de cierre |
| [Plan de pruebas piloto fiscal](../Plan-de-pruebas-piloto-fiscal.md) | Criterios de aceptación, matriz E2E y pasos de cierre |

## Estado del proyecto (2026-09-05)

- **Puerta 0 — Contención:** ✅ completada. IVA legacy bloqueado por flag, asientos automáticos retirados, enums unificados, outbox con lease/retry/dead-letter, CI con PostgreSQL/Valkey/MinIO, datos demo aislados, Git restaurado.
- **Puerta 1 — Fundación fiscal:** ✅ completada. Baseline fiscal + RLS, maestros, perfil fiscal versionado, reglas con fuente/vigencia/hash/aprobación, `packages/tax-engine`, contratos Zod, capabilities fiscales, onboarding fiscal UI, calendario determinista.
- **Puerta 2 — Ingestión y subledger:** ✅ completada. ImportBatch/ImportRow + adaptadores ARCA/DGR/SMT/CM03, FiscalVoucher con componentes, deduplicación, ManagementExpense, revisión independiente, importación atómica e idempotente.
- **Puerta 3 — Vertical IVA:** ✅ completada. Motor puro, cobertura/cálculo/diferencias, maker-checker, inmutabilidad SQL (triggers), papel de trabajo/export, presentación/pago con acuse, rectificativa con delta, worklist, portal de resultado publicado, E2E RI.
- **Puerta 4 — IIBB/TEM/CM03/Monotributo:** ✅ completada (motores + adaptadores + E2E). La matriz fiscal y responsive queda en 16/16; pendiente: revalidación normativa y golden cases firmados por contador.
- **Puerta 5 — Rentabilidad y portal:** ✅ completada. Devengado/caja separados, publicación versionada, dashboard de cartera por riesgo, portal con pendientes/impuestos/pagos/rentabilidad, timeline por obligación, recibos persistentes.
- **Puerta 6 — Piloto y endurecimiento:** 🔄 en curso. Avance: flags `TAX_*`, seed reproducible, roles portal, ciclo mensual con publicación/pago, API 332/332, web 18/18 y E2E 16/16. Pendiente: clientes piloto reales, aceptación histórica con contador, restore drill, benchmark medido, auditoría de seguridad, golden cases firmados y sign-off.
- **Fase 2 — Producto completo, seguridad y resiliencia:** ✅ completada (2026-08-20). HMAC anti-replay en FastAPI, timeouts en llamadas a IA, separación transaccional, workflows de vouchers/gastos separados, guard deny-by-default, filtros período/cutoff en lecturas, filing con acuse, lecturas de reglas, matriz de permisos alineada.
- **ADR-008 — Navegación enfocada en liquidación fiscal:** ✅ aceptado (2026-08-20). Contabilidad y reportes/BI ocultos de la navegación del estudio (`not_released`); el código permanece como legado técnico.

## Desafíos pendientes (resumen)

- **🔴 Críticos:** aceptación profesional de resultados históricos, clientes piloto reales, decisión sobre el volumen `contable` con migración fallida y sign-off de Puerta 6.
- **🟠 Altos:** restore drill, benchmark medido, auditoría de seguridad y golden cases firmados por régimen.
- **🟡 Medios:** upload de lote, cálculos largos con `202 + jobId`, idempotency/ETag, observabilidad `/metrics`, descarga adicional de papeles en portal y selector de período en rentabilidad.
- **🔵 Bajos:** scripts canónicos `ci:*`, ejecución E2E del worker dentro de CI, property tests, OpenAPI 3.1 + cliente TS y cierre de documentación histórica sin reemplazo.

## Estado de documentos

- **ADRs:** 8 aceptados (incluye ADR-008 navegación fiscal).
- **Glosario:** congelado.
- **Invariantes:** 60+ escenarios Given/When/Then en 10 áreas.
- **Matriz de permisos:** 5 roles × 30+ capacidades, alineada con `capabilities.ts` (2026-08-20).
- **Threat model:** 12 escenarios de mayor impacto + por frontera.
- **Fixtures:** borradores pendientes de validación profesional.
- **Checklist normativo:** pendiente de responsables.
- **Contratos Node–FastAPI:** definidos.
- **Schemas de extracción:** `voucher-ar-v1` y `bank-statement-ar-v1` (borrador técnico).
- **Catálogo de tools IA:** lectura/propuesta, sin tools prohibidas.
- **Catálogo semántico BI:** métricas, dimensiones y filtros allowlisted.
- **Runbooks del piloto:** 11 runbooks operativos.
- **Checklist de sign-off Puerta 6:** en forma, mayoría de ítems pendientes de evidencia.
- **Plan de pruebas piloto fiscal:** gate técnico/API/E2E verde; aceptación funcional e histórica pendiente.
- **Documentación histórica:** se conserva temporalmente en `docs/` y `docs/dev/`; no se eliminarán duplicados hasta una decisión posterior.

## Pendientes transversales

- [ ] Validación profesional de fixtures contables/fiscales (contador).
- [ ] Validación profesional de fixtures documentales (contador).
- [ ] Asignación de responsables en el checklist normativo.
- [ ] Aprobación jurídica de la política de retención.
- [ ] Golden cases firmados por contador matriculado (por régimen).
- [ ] Revisar el seed normativo inicial contra fuentes vigentes.
- [ ] Resolver o aislar el volumen PostgreSQL histórico `contable` sin eliminar datos.
- [ ] Ejecutar restore drill y registrar tiempos de recuperación.
- [ ] Medir benchmark de cálculo, worker documental y consultas de portal.
- [ ] Ejecutar auditoría de seguridad y revisar los archivos fuera de alcance antes del commit.
- npm workspaces, TypeScript estricto, ESLint, Vitest, Playwright.
- Entorno Python con lockfile, lint, type checking y pytest.
- Docker Compose con PostgreSQL, MinIO, Valkey, ClamAV, API, worker, FastAPI y Nginx.
- CI bloqueante.
- Design system, tokens y primitives.
- Shell del estudio y shell del portal.
- OpenAPI y SDK frontend generado.
