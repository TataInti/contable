# Plan de cierre de gaps funcionales — Contable

> **Estado:** plan ejecutable derivado de la auditoría funcional del repositorio (2026-08-19).
> **Base:** Puertas 0–5 completas y Puerta 6 avanzada (commits `4301d14`, `5d557a5`).
> **Fuente rectora:** [`PLAN_DESARROLLO_CONTABLE.md`](../PLAN_DESARROLLO_CONTABLE.md).
> **Complemento de proceso:** [`proceso-liquidacion-mensual.md`](./proceso-liquidacion-mensual.md).
> **Regla:** ninguna función tributaria se habilita a usuarios hasta completar su flujo de punta a punta y superar su puerta fiscal, técnica y operativa.

---

## 1. Diagnóstico resumido

El **dominio fiscal central ya funciona**: motores deterministas IVA/IIBB/TEM/CM03/Monotributo, ciclo maker-checker, rentabilidad devengado/caja y portal del cliente. Los gaps restantes impiden el **ciclo productivo completo "de punta a punta"** que exige el plan maestro (§17): desde la recopilación de información hasta el registro del pago, explicando cada número y repitiendo el resultado sin abandonar Contable.

### 1.1 Qué está resuelto (avance logrado)

| Área | Estado |
|---|---|
| **Puerta 0** | IVA legacy bloqueado por flag; asientos automáticos retirados; enums unificados; outbox con lease/retry/dead-letter; CI levanta PostgreSQL/Valkey/MinIO; datos demo aislados; Git restaurado. |
| **Puerta 1** | Baseline fiscal + RLS; maestros (jurisdicción, autoridad, impuesto, régimen); perfil fiscal versionado; reglas con fuente/vigencia/hash/aprobación; `packages/tax-engine`; contratos Zod; capabilities fiscales; onboarding fiscal UI; calendario determinista. |
| **Puerta 2** | ImportBatch/ImportRow + adaptadores ARCA/DGR/SMT/CM03; FiscalVoucher con componentes; deduplicación; ManagementExpense con tratamiento profesional; revisión independiente; importación atómica e idempotente. |
| **Puerta 3** | Vertical IVA completa: motor puro, cobertura/cálculo/diferencias, maker-checker, inmutabilidad SQL (triggers), papel de trabajo/export, presentación/pago, rectificativa con delta, worklist, portal de resultado publicado, E2E RI. |
| **Puerta 4** | Motores IIBB Tucumán, TEM SMT, CM03 art. 2 y Monotributo con dispatch multi-régimen, adaptadores, seeds, tests de integración y E2E verticales. |
| **Puerta 5** | Rentabilidad devengado/caja separados, publicación versionada, dashboard de cartera por riesgo, portal con pendientes/impuestos/pagos/rentabilidad, timeline por obligación, recibos persistentes. |
| **Puerta 6 (avance)** | Activación progresiva por régimen (flags `TAX_*`), ciclo piloto RI completo, seed de carga (300 clientes), corrida histórica (3 períodos), runbooks y checklist de sign-off. |

### 1.2 Gaps detectados (desafíos pendientes)

Se agrupan por severidad. Cada ítem referencia la sección del plan maestro que lo exige.

#### 🔴 Críticos — impiden el flujo productivo completo

| # | Gap | Plan maestro |
|---|---|---|
| C1 | **No existe estación de trabajo de liquidación (5 zonas)**. `StudyLiquidaciones` es solo una worklist con botones; falta cabecera, cobertura, cálculo, diferencias y timeline con drill-down de cada importe. | §5.5 |
| C2 | **Pedidos documentales no ligados a `obligationId`**. `DocumentRequest` no tiene la columna; falta ruta portal `/portal/pendientes/:requestId` para responder ítem por ítem. | §6.8, §10.3 |
| C3 | **Estación documental sin preview de evidencia**. `StudyBandeja` muestra texto/confianza pero no el PDF/imagen original ni evidencia por campo. | §5.6 |
| C4 | ~~**`TaxFiling` no permite registrar acuse/evidencia**~~. `recordFiling` saltaba directo a `FILED` sin adjuntar acuse ni estado previo. | ✅ **Resuelto (2026-08-20)**: migración `20260820010000_f2_tax_filing_status` cambia `TaxFiling.status` a enum `TaxFilingStatus` (PENDING/FILED/REJECTED/VOIDED). `recordFiling` exige `evidenceDocumentId` de un acuse validado del cliente (valida existencia y pertenencia). Nuevo `recordFilingPending` registra intentos no presentados (PENDING). Ruta `POST /tax-obligations/:id/filings/pending`. Tests en `settlement.test.ts` (24). |
| C5 | **`GET /tax-credit-ledger` no existe** y el libro de créditos no se escribe desde `recordPayment`. | §10.3, §7.6 |

#### 🟠 Altos — flujos incompletos

| # | Gap | Estado |
|---|---|---|
| A1 | **Sin `POST /import-batches/:id/upload`** (la ingesta oficial va por sesiones de documento, no por lote). | Pendiente |
| A2 | ~~**Workflow de vouchers colapsado**~~: una sola ruta `POST /vouchers/:id/review {approve}`; faltan `submit-review`/`approve`/`reject` separados. | ✅ **Resuelto (2026-08-20)**: `POST /vouchers/:id/submit-review|approve|reject` en `ingestion-routes.ts` + `submitVoucherForReview`/`approveVoucher`/`rejectVoucher` en `ingestion-service.ts` (maker-checker en approve/reject; `reviewVoucher` legacy se mantiene). Guards mapeados en `guard.ts`. Tests en `ingestion.test.ts` (20) y `guard-capabilities.test.ts`. |
| A3 | ~~**`ManagementExpenseService.submitForReview` y `reject` sin ruta**~~ — el estado `PENDING_REVIEW` era inalcanzable. | ✅ **Resuelto (2026-08-20)**: rutas `POST /management-expenses/:id/submit-review` y `/:id/reject` en `ingestion-routes.ts`. Guards: submit-review → `tax.management_expenses.write`, reject → `tax.management_expenses.approve_treatment`. |
| A4 | ~~**Lecturas fiscales sin filtro de período/cutoff**~~: `GET /vouchers`, `/withholdings`, `/perceptions`, `/management-expenses`, listado de settlements. | ✅ **Resuelto (2026-08-20)**: `listVouchers`/`listWithholdings`/`listPerceptions`/`expenses.list` aceptan `from`/`to` (rango de fechas) y las rutas los exponen como query params. Test `C-4 filtra vouchers por rango de fechas` en `ingestion.test.ts`. |
| A5 | **Ningún endpoint devuelve 202 + jobId** (cálculos, exports y OCR son 100% síncronos). | Pendiente |
| A6 | ~~**Rutas legacy activas sin 410**~~: `/assistant/*`, `/bi/*`, `/reports/*`, `/obligations`, `/close-cycles`, `/document-requests`, `GET /vat/liquidations`. | ✅ **Resuelto (2026-08-20)**: `GET /vat/liquidations` ya NO existe como ruta (retirada en F2.1; reemplazo `/tax-settlements`). Asistente/BI/reportes son **productivos** según plan-produccion-general §5.7 (NO deben dar 410; tienen contratos actuales). `/obligations`, `/close-cycles`, `/document-requests`, `/threads` tienen reemplazo vigente en work-service/portal. No quedan rutas legacy sin reemplazo. |
| A7 | ~~**Guard de capabilities no es deny-by-default**~~: rutas sin mapeo pasaban sin control y no había prueba que falle. | ✅ **Resuelto (2026-08-20)**: `guard.ts` lanza 404 `RESOURCE_NOT_FOUND` cuando `requiredCapability` devuelve null en rutas con sesión+firma. Se mapearon 6 rutas con escape real (`/activities`, `/adjustments/*`, `/portal-invitations`, `/document-request-items/:id/preview`). Test `apps/api/src/auth/policy-coverage.test.ts` audita TODAS las rutas registradas contra el ROUTE_POLICY (whitelist de 11 excepciones legítimas). |
| A8 | **Sin idempotency keys + ETag/If-Match** en la práctica (una sola `Idempotency-Key` en todo el frontend). | Pendiente |

#### 🟡 Medios — producto/UX

| # | Gap | Plan maestro |
|---|---|---|
| M1 | Portal no ofrece **descargar papel de trabajo** en `PortalLiquidaciones` (a pesar del comentario en código). | §5.8 |
| M2 | `StudyRentabilidad` no tiene selector de período (siempre `periods[0]`). | §5.4 |
| M3 | `window.confirm` nativo para acciones irreversibles (no accesible, anti-móvil). | §5.10 |
| M4 | **Cálculos del Excel no implementados en el motor**: crédito Dto. 814 (F.931 × 6,5%), intereses por mora, prorrata, clasificación de proveedores por rubro (SUPER/TRANSPORTE) para IIBB, conciliación con Portal IVA y acreditaciones bancarias. | proceso-liquidacion-mensual §4.3–4.5 |

#### 🔵 Bajos — calidad/ingeniería

| # | Gap | Plan maestro |
|---|---|---|
| B1 | Scripts canónicos `ci:*` inexistentes; **E2E no corre en CI**; **ClamAV no se levanta en CI**; queda algún `skipIf`. | §13.1 |
| B2 | **Sin property tests**; **golden tests sin firma/checksum de contador**. | §13.2, §13.3 |
| B3 | E2E faltan escenarios 1, 6, 10 y 11 del §13.6 (crear cliente, pedir cambios, responder pedido móvil, rectificar). | §13.6 |
| B4 | **No hay OpenAPI 3.1 ni cliente TS generado**. | §10.1 |
| B5 | **Sin observabilidad** (`/metrics`, alertas). | §11.5 |
| B-6 | ~~`matriz-permisos.md` vs `capabilities.ts` divergen~~ (`ai.use`/`bi.use`). | ✅ **Resuelto (2026-08-20)**: matriz actualizada con secciones fiscales (perfil, reglas, vouchers, settlements, filings/payments, gastos, rentabilidad) alineadas con `resolver.ts`. `ai.use`/`bi.use` ya coincidían. |

---

## 2. Decisiones de alcance (cerradas)

| Tema | Decisión |
|---|---|
| **Orden de ejecución** | Respetar el plan maestro por puertas (vertical), no por capas horizontales. |
| **Cálculos del Excel** | Implementar **ya** en `packages/tax-engine` con golden tests (Dto. 814, mora, prorrata, rubros, conciliación). La **activación** queda sujeta a aprobación profesional (no se activan sin sign-off). |
| **Observabilidad** | Endpoint `GET /api/v1/metrics` (Prometheus) + alertas por runbook. Sin stack Grafana en este ciclo. |
| **Fuera de alcance** | Ganancias, Autónomos, sueldos completos, CM04/05, jurisdicciones fuera de Tucumán, presentación automática, claves fiscales (§3.2). |

---

## 3. Plan de trabajo por fases

### Fase A — Puerta 0: Contención y verdad operativa (restante)

| ID | Tarea | Archivos |
|---|---|---|
| A-1 | **410 legacy**: rutas no productivas responden `410 TAX_LEGACY_DISABLED` (`/assistant/*`, `/bi/*`, `/reports/*`, `/report-*`, `/drill-down`, `/obligations*`, `/obligation-instances`, `/close-cycles*`, `/document-requests*`, `/threads*`, `GET /vat/liquidations`). Mantener lectura histórica vía contratos nuevos. | `apps/api/src/tax/routes.ts`, `assistant/routes.ts`, `bi/routes.ts`, `reporting/routes.ts` |
| A-2 | **Guard deny-by-default**: ruta sin capability mapeada → 403 (o 404 indistinguible). Test que falle si una ruta no declara capability. | `apps/api/src/auth/guard.ts`, `guard-capabilities.test.ts` |
| A-3 | **Idempotency + concurrencia**: `Idempotency-Key` obligatorio en creaciones/transiciones (createBatch, commitBatch, calculate, submit-review, review, finalize, rectify, filings, payments, allocateCredit, publish). ETag/If-Match para edición concurrente. Frontend envía la key globalmente. | `apps/api/src/lib/`, `apps/web/src/lib/api.ts` |
| A-4 | **202 + jobId**: imports (10k filas), cálculo y export devuelven 202 con jobId+receiptId. Worker implementa handlers reales para cola `exports`. | `apps/api/src/tax/*`, `apps/worker/src/index.ts` |
| A-5 | **CI**: agregar ClamAV como service; ejecutar E2E en CI; crear scripts canónicos `ci:static`, `test:unit`, `test:db`, `test:contract`, `test:e2e`, `test:security`, `test:performance`, `test:recovery`; eliminar `skipIf` restantes. | `.github/workflows/ci.yml`, `package.json` raíz |
| A-6 | **Observabilidad**: `GET /api/v1/metrics` (Prometheus) con métricas mínimas §11.5; alertas documentadas en runbooks. | `apps/api/src/`, `docs/runbooks-piloto.md` |

### Fase B — Puerta 1: Fundación fiscal (restante)

| ID | Tarea | Archivos |
|---|---|---|
| B-1 | ~~**Lecturas de reglas**~~: `GET /tax-rule-versions`, `GET /tax-rule-versions/:id/sources`, `GET /tax-rule-versions/:id/golden-results`. | ✅ **Resuelto (2026-08-20)**: `GET /tax/rule-packs/:packId/versions`, `GET /tax/rule-versions/:id/sources`, `GET /tax/rule-versions/:id/golden-results` en `fiscal-foundation-routes.ts` + `listRuleVersions`/`getRuleVersionSources`/`getRuleVersionGoldenResults` en el service. Test B-1 en `fiscal-foundation.test.ts` (12). |
| B-2 | **Obligaciones disponibles**: `GET /available-obligations` y `GET /activities` por cliente. | `TaxPeriodService`, `TaxpayerProfileService` |
| B-3 | **OpenAPI 3.1 + cliente TS** generados desde schemas Zod; CI falla si hay drift. | `packages/contracts/package.json` |
| B-4 | **Revalidación de reglas**: job programado (cola `maintenance`) que detecta vigencia próxima a expirar, fuente inaccesible, golden diff, rectificativa por regla. | `apps/worker/src/index.ts` |

### Fase C — Puerta 2: Ingestión y subledger (restante)

| ID | Tarea | Archivos |
|---|---|---|
| C-1 | **Upload de lote**: `POST /import-batches/:id/upload` (archivo oficial → MinIO quarantine → validación). | `ingestion-routes.ts`, `ingestion-service.ts`, `@contable/storage` |
| C-2 | **Workflow vouchers**: separar `POST /vouchers/:id/submit-review`, `/approve`, `/reject`. | `ingestion-routes.ts`, `IngestionService.reviewVoucher` |
| C-3 | **Management expense**: exponer `POST /management-expenses/:id/submit-for-review` y `/:id/reject`. | `management-expense-service.ts` |
| C-4 | **Filtros período/cutoff** en lecturas (`/vouchers`, `/withholdings`, `/perceptions`, `/management-expenses`, listado settlements). | `ingestion-service.ts`, `settlement-service.ts` |
| C-5 | **Pedidos ligados a obligación**: agregar `obligationId` a `DocumentRequest` (schema + migración + RLS) y `requestItemId` obligatorio. Ruta portal `/portal/pendientes/:requestId` con acciones por ítem. | `schema.prisma`, `work-service.ts`, `portal/routes.ts` |
| C-6 | **Estación documental**: preview del archivo original (MinIO presigned), evidencia por campo (boundingBox + fragmento), estados de conflicto/duplicado. | `apps/web/src/study/StudyBandeja.tsx` |

### Fase D — Puerta 3: Vertical IVA (restante)

| ID | Tarea | Archivos |
|---|---|---|
| D-1 | **Estación de trabajo de liquidación (5 zonas)**: nueva página `StudyLiquidacionDetalle.tsx` + ruta `/clientes/:clientId/periodos/:periodId/liquidaciones/:settlementId`. Cabecera, cobertura, cálculo (renglones con fórmula/regla/subtotal), diferencias, timeline. Drill-down de cada importe. | `apps/web/src/study/StudyLiquidacionDetalle.tsx`, `App.tsx` |
| D-2 | **Endpoints de detalle**: `GET /tax-settlements/:id/lines` y `GET /tax-settlements/:id/coverage` por `:id`. | `settlement-routes.ts`, `settlement-service.ts` |
| D-3 | **Filing con acuse**: `TaxFiling` con estados PENDING→FILED y `evidenceDocumentId` obligatorio. | `settlement-service.ts`, `schema.prisma` |
| D-4 | **Libro de créditos**: `GET /tax-credit-ledger` + escritura de entradas desde `recordPayment`/`allocateCredit`. | `settlement-service.ts`, `settlement-routes.ts` |
| D-5 | **Portal descarga papel de trabajo**: botón en `PortalLiquidaciones.tsx` → endpoint de descarga (ya existe). | `apps/web/src/portal/PortalLiquidaciones.tsx` |
| D-6 | **E2E faltantes (§13.6)**: escenarios 1 (owner crea cliente), 6 (revisor pide cambio), 10 (cliente responde pedido móvil), 11 (rectificación). | `e2e/*.spec.ts` |

### Fase E — Puerta 4: Cálculos del Excel en tax-engine *(decisión: implementar ya)*

| ID | Tarea | Archivos |
|---|---|---|
| E-1 | **Crédito Dto. 814**: remuneración neta F.931 × 6,5% como crédito fiscal IVA. Nuevo input `payrollContributions` en `vat.ts` + subtotal `CREDITO_CONTRIBUCIONES`. | `packages/tax-engine/src/vat.ts` |
| E-2 | **Intereses por mora**: base × (tasa mensual/30) × días de atraso. Nuevo módulo `interest.ts` + integración en settlement. | `packages/tax-engine/src/interest.ts` |
| E-3 | **Prorrateo**: compras no gravadas → prorrata de crédito fiscal. Flag en `vat.ts` con regla vigente. | `packages/tax-engine/src/vat.ts` |
| E-4 | **Clasificación proveedores por rubro**: tabla maestra (SUPER/TRANSPORTE) para IIBB. Extender `importers.ts` + lookup en `iibb.ts`/`cm03.ts`. | `packages/tax-engine/src/importers.ts`, `iibb.ts`, `cm03.ts` |
| E-5 | **Conciliación Portal IVA + acreditaciones**: controles de auditoría (débito/crédito libro vs declarado, acreditaciones vs facturado). Nuevo módulo `reconciliation.ts` + `TaxDifference` tipo `CONCILIACION`. | `packages/tax-engine/src/reconciliation.ts` |
| E-6 | **Golden tests** por cálculo + actualizar `seed-maestros-fiscales.ts` con reglas nuevas (tasas Dto. 814, tasas de mora por jurisdicción). | `packages/tax-engine/src/*.test.ts`, `seed-maestros-fiscales.ts` |

### Fase F — Puerta 5: Rentabilidad y portal (restante)

| ID | Tarea | Archivos |
|---|---|---|
| F-1 | **Selector de período** en `StudyRentabilidad` (hoy usa `periods[0]`). | `apps/web/src/study/StudyRentabilidad.tsx` |
| F-2 | **Diálogos accesibles**: reemplazar `window.confirm` por diálogo del design-system (focus trap, Escape, aria-modal). | `apps/web/src/study/*` |
| F-3 | **Portal responde pedidos por ítem**: `PortalPendientes.tsx` con detalle por pedido, subir archivo por ítem (requestItemId), ver estado recibido/observado/aceptado. | `apps/web/src/portal/PortalPendientes.tsx` |
| F-4 | **Descarga de papeles en portal** (mismo entregable que D-5). | `apps/web/src/portal/PortalLiquidaciones.tsx` |

### Fase G — Puerta 6: Piloto y endurecimiento (restante)

| ID | Tarea | Archivos |
|---|---|---|
| G-1 | **Restore drill (G6-05)**: runbook + ensayo de restore de backups cifrados. | `docs/runbooks-piloto.md` |
| G-2 | **Benchmark de carga (G6-06)**: script `test:performance` que mida p95 worklist <2s con 300 clientes, apertura liquidación <2s, import 10k filas como job, cálculo 10k hechos <30s. | `package.json`, `seed:carga` |
| G-3 | **Auditoría de seguridad (G6-07)**: tests IDOR indistinguible, CSRF, rate limit, token invitación no en claro, sesión revocada. | `apps/api/src/**/*.test.ts` |
| G-4 | **Golden cases firmados (G6-09)**: evidencia de validación por contador matriculado para IVA/IIBB/TEM/CM03/MONO (checksum + firma). | `docs/checklist-signoff-puerta6.md` |
| G-5 | **Sign-off y activación progresiva (G6-09/10)**: completar checklist, activar por firma/cliente/impuesto vía flags `TAX_*`. | `docs/checklist-signoff-puerta6.md` |

---

## 4. Dependencias críticas

```
Perfil fiscal
  → reglas aprobadas
  → obligación y período
  → fuentes importadas
  → hechos revisados
  → motor determinista
  → revisión
  → finalización
  → exportación
  → presentación
  → pago
  → rentabilidad/publicación
```

No se permite invertir esta cadena construyendo primero dashboards o pantallas vacías.

---

## 5. Verificación (definición de terminado)

1. `npm run lint && npm run typecheck` limpios en todo el monorepo.
2. `npm test` (workspaces): sin regresiones; nuevos tests por gap (guard deny-by-default, idempotencia, 410 legacy, filtros período, ledger, filing acuse, motores E1–E5).
3. `npm run test:e2e`: 12 escenarios §13.6 cubiertos (nuevos specs D-6) en chromium + mobile.
4. CI verde con ClamAV levantado y E2E ejecutándose (A-5).
5. `curl /api/v1/metrics` expone métricas; alertas documentadas en runbooks (A-6).
6. `GET /tax-credit-ledger` devuelve entradas tras un pago (D-4).
7. `POST /tax-settlements/:id/calculate` con 10k hechos devuelve 202 + jobId y completa (A-4).
8. Ruta sin capability mapeada → 403 y test lo fija (A-2).
9. Golden tests E1–E5 pasan; reglas nuevas quedan DRAFT hasta aprobación profesional (E-6).
10. Restore drill ejecutado y documentado (G-1); benchmark p95 dentro de objetivos (G-2).

---

## 6. Consideraciones adicionales

1. El frontend usa `BrowserRouter` (no hash) — verificar rewrite en `infra/nginx/nginx.conf` para producción.
2. `matriz-permisos.md` y `capabilities.ts` divergen (`ai.use`/`bi.use` en doc, no en código) — alinear al cerrar A-2.
3. Race conditions preexistentes en tests paralelos (tenant.test PREPARER_A, profitability deadlock 40P01) — documentadas en memoria; conviene estabilizarlas en G-3.

---

## 7. Referencias

- Plan maestro: [`PLAN_DESARROLLO_CONTABLE.md`](../PLAN_DESARROLLO_CONTABLE.md)
- Proceso de liquidación mensual: [`proceso-liquidacion-mensual.md`](./proceso-liquidacion-mensual.md)
- Especificación técnica Excel: [`especificacion-liquidacion-manual-excel.md`](./especificacion-liquidacion-manual-excel.md)
- Checklist de sign-off Puerta 6: [`checklist-signoff-puerta6.md`](./checklist-signoff-puerta6.md)
- Runbooks del piloto: [`runbooks-piloto.md`](./runbooks-piloto.md)
- Invariantes: [`invariantes.md`](./invariantes.md)