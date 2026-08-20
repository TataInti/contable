# Memoria técnica de Contable

> Diario de decisiones técnicas y estado real del repositorio, derivado de la
> memoria de trabajo del equipo. Se actualiza con cada cambio significativo.
> Fuente rectora: [`PLAN_DESARROLLO_CONTABLE.md`](../PLAN_DESARROLLO_CONTABLE.md)
> y [`plan-produccion-general.md`](./plan-produccion-general.md).

## Cómo usar este documento

- Es un **registro cronológico** de decisiones, bugs corregidos y patrones verificados.
- Cada sección tiene fecha y, cuando aplica, commit SHA.
- Si un patrón se repite (ej. filtros con 2 condiciones, races en tests), queda anotado para no repetir el error.

---

## Fases 6–9 — Núcleo contable, bancos, IVA, reportes (2026-08-13)

- Modelos contables ya existían en `schema.prisma` (Account, FiscalYear, AccountingPeriod, JournalEntry, JournalLine).
- Columnas Prisma usan camelCase SIN `@map` (ej. `firmId`, no `firm_id`). En SQL crudo usar `"firmId"` entre comillas.
- `fiscal_years` y `accounting_periods` NO tienen columna `updatedAt` (a diferencia de accounts).
- Posting serializable: `SELECT ... FOR UPDATE` sobre la fila del ejercicio antes de asignar secuencia.
- Maker-checker: preparador no puede aprobar su propio asiento.
- Asiento desbalanceado lanza `EntryError` (del motor puro), no `JournalError`.
- Tests de integración de asientos: limpiar datos del cliente en `beforeEach` (DELETE por clientId) para idempotencia; unique en fiscal_years es (clientId, startDate, endDate).
- **GAP histórico**: rutas de negocio sin auth guard que setee `req.userId`; usaban `req.userId ?? "system"` (no es usuario real → FK falla en HTTP). Resuelto en hardening.

## Fase 7 — Bancos, moneda, inflación

- 10 tablas nuevas: bank_accounts, bank_statements, bank_movements, bank_matches, bank_reconciliations, exchange_rate_sources, exchange_rates, exchange_difference_runs, inflation_indexes, inflation_observations, inflation_runs.
- El rol runtime NO tiene permisos en tablas nuevas → GRANT SELECT/INSERT/UPDATE/DELETE al final de la migración.
- Tests de integración corren en PARALELO (vitest multi-worker) → cada archivo de test usa un CLIENTE distinto para evitar races en unique constraints.
- `runtimePrisma.$transaction(async (tx) => ... return fn(tx))` infiere `unknown`; castear `return fn(tx) as Promise<T>`.

## Fase 11 — Asistente contable

- 5 tablas nuevas: assistant_conversations, assistant_turns, assistant_evidence, assistant_feedback, assistant_usage.
- FastAPI: endpoint `/internal/v1/assistant/runs` con abstención (NO_PERIOD_CONTEXT, INJECTION_DETECTED, FIGURE_UNVERIFIED), catálogo de tools read-only (A-003), verificación numérica (A-001).
- Node: AssistantService con HMAC a FastAPI (A-004: Node autoriza, FastAPI no decide permisos).
- Tests de integración mockean `callAssistant` (el servicio AI se testea por separado).

## Fase 12 — Copiloto BI

- 5 tablas nuevas: bi_metrics, bi_dimensions, bi_dashboards, bi_widgets, bi_snapshots.
- FastAPI: endpoint `/internal/v1/bi/plan` con planner Pydantic (A-006: plan inválido nunca ejecuta).
- Node: BiService con ejecutor canónico (A-008: cifras = motor contable). Neto invertido para cuentas normalBalance CREDIT.
- Widget cutoff = `new Date()` (fiscalPeriodId es UUID, no fecha).

---

## Puertas 0–6 — Contención y verticales fiscales (2026-08-19)

### Puerta 0 — Contención
- IVA legacy bloqueado por flag server-side (`requireTaxEnabled` → 410 TAX_LEGACY_DISABLED).
- Bandeja ya NO crea asientos automáticos desde el total extraído.
- Contabilidad/Reportes/Asistente ocultos de la navegación (G0-03).
- Enums tipados para pedidos/cierres (migración `20260814000000_g004_unify_request_cycle_enums`).
- Guard de portal distingue READONLY de COLLABORATOR.
- Outbox con lease/retry/reclaim/dead-letter (G0-07).
- **BUG zona horaria**: funciones outbox deben comparar con `(now() AT TIME ZONE 'UTC')`, NO con `CURRENT_TIMESTAMP` (local -03).

### Puerta 1 — Fundación fiscal
- Baseline consolidado en UNA migración `20260816000000_initial_baseline` (3396 líneas).
- 21 tablas nuevas de maestros fiscales + RLS + grants.
- `packages/tax-engine`: core (Decimal, taxHash, fmtMoney), vat.ts, calendar.ts.
- `packages/contracts`: enums fiscales + schemas Zod.
- Capabilities fiscales (tax.*) asignadas por rol.
- Calendario: feriados AR 2025-2026 seedeados.

### Puerta 2 — Ingestión y subledger
- 22 tablas nuevas (import_batches, fiscal_vouchers, withholding_certificates, etc.).
- `packages/tax-engine/src/importers.ts`: normalizeArcaVoucherRow/Batch, normalizeWithholdingRow/Batch.
- IngestionService: createBatch idempotente, validateBatch, commitBatch atómico, reconcileBatch, reviewVoucher.
- ManagementExpenseService: create, approveTreatment, reject.
- **exactOptionalPropertyTypes**: usar spreads condicionales `...(x ? {x} : {})`.

### Puerta 3 — Vertical IVA
- SettlementService: ciclo completo sobre motor puro SIN mayor contable.
- **Tasas de TaxRateRule en DB**: se guardan en puntos porcentuales (21.0000); el motor espera decimal (0.21). `calculate()` normaliza.
- V-003: recálculo sobre FINALIZED lanza SETTLEMENT_IMMUTABLE.
- Triggers de inmutabilidad SQL (trg_settlement_immutable, etc.).
- **Race conditions en test de DB (CRÍTICO)**: las suites tax corren en paralelo con la MISMA DB; cada cleanup borra SÓLO sus códigos (sufijo propio) y SIEMPRE por clientId.

### Puerta 4 — IIBB/TEM/CM03/Monotributo
- Motores nuevos: tem.ts, cm03.ts, monotributo.ts.
- Dispatch multi-régimen en settlement-service.calculate().
- Adaptadores DGR/SMT/CM03 en importers.ts.
- **Rebuild tax-engine**: al agregar exports nuevos, `npm run build -w @contable/tax-engine` antes de correr tests de apps/api.

### Puerta 5 — Rentabilidad y portal
- Motor profitability (devengado/caja separados).
- profitability-service/routes, StudyRentabilidad + PortalRentabilidad.
- **Caja no duplica IVA**: la liquidación IVA finalizada genera deuda (DEVENGADO); su pago efectivo ES el efecto de caja del IVA (CAJA).

### Puerta 6 — Piloto y endurecimiento
- Activación progresiva por régimen (flags TAX_RI, TAX_IIBB_LOCAL_TUC, etc.).
- settlement-piloto.test.ts (ciclo completo RI).
- seed-carga-piloto.ts (300 clientes).
- **Colisiones de tests (CRÍTICO)**: toda suite NUEVA debe usar firma y clientId 100% únicos.

---

## Fase 0–1 — Producción general (2026-08-19)

### Fase 0 — Bloqueos inmediatos
- F0.1 worklist fiscal explícito: `GET /firms/:firmId/portfolio/tax-worklist`.
- F0.4 dirección de comprobantes: `ArcaVoucherInput.direction` obligatorio; commitBatch estrictamente atómico.
- F0.5 alcance fiscal: certificados filtrados por status APPROVED y período.
- F0.8 tabla de política declarativa: `ROUTE_POLICY` en guard.ts (deny-by-default).
- F0.7 notificaciones internas: UserNotification en BD (sin webhook).
- F0.3 suite reproducible: SettlementService acepta ObjectStorage inyectable.
- F0.2 grants portal + F0.6 Compose producción + F0.9 CI con ClamAV y E2E.

### Fase 1 — Expediente mensual
- F1.1 MonthlyTaxWorkpaper: 10 tablas (expediente, vínculos, controles, libro de créditos).
- F1.2 registro de adaptadores + F931.
- F1.3 motor IVA RI por componente/alícuota (vat-ri.ts).
- F1.4 alcance fiscal de certificados + atribución por jurisdicción.
- F1.5 controles tipados + waiver maker-checker.
- F1.6 UI expediente mensual (StudyExpedienteMensual).
- F1.7 libro de créditos inmutable (TaxCreditLot/TaxCreditMovement).

---

## Fase 2 — Producto completo, seguridad y resiliencia (2026-08-20)

### F2.5 Seguridad IA
- **HMAC anti-replay** en FastAPI (`services/ai/app/auth.py`): `NonceStore` en memoria thread-safe (TTL = window_seconds, key `service_id:nonce`). Orden en verify: timestamp → firma → nonce (el nonce se consume DESPUÉS de validar firma para que un atacante sin secreto no queme nonces legítimos).
- **Timeouts** en llamadas a IA: assistant (15s), bi (15s), worker (30s) con `AbortSignal.timeout`.
- **Separación transaccional**: `sendTurn` ya NO mantiene la transacción de BD durante la llamada remota (3 pasos: transacción corta usuario+tools → llamada remota → transacción corta assistant turn+usage).

### F2.2 Workflows
- Vouchers: `submit-review`/`approve`/`reject` separados (maker-checker).
- Gastos: rutas `submit-review`/`reject` expuestas.
- Guards: `/vouchers/*/approve|reject` → tax.vouchers.review, `/submit-review` → tax.vouchers.prepare.

### A-7 Deny-by-default
- `guard.ts` lanza 404 `RESOURCE_NOT_FOUND` cuando `requiredCapability` devuelve null en rutas con sesión+firma.
- 6 rutas con escape real mapeadas (activities, adjustments, portal-invitations, preview).
- Test `policy-coverage.test.ts` audita TODAS las rutas registradas contra ROUTE_POLICY.

### C-4/A-4 Filtros período
- `listVouchers`/`listWithholdings`/`listPerceptions`/`expenses.list` aceptan from/to.
- **BUG fix**: spread `...(from ? {issuedOn:{gte}} : {})` + `...(to ? {issuedOn:{lte}} : {})` SOBREESCRIBE el primer `issuedOn` → combinar en un objeto `issuedOn: {...gte, ...lte}`.

### D-3 Filing con acuse
- Migración `20260820010000_f2_tax_filing_status`: `tax_filings.status` String → enum `TaxFilingStatus` (PENDING/FILED/REJECTED/VOIDED).
- `recordFiling` exige `evidenceDocumentId` de acuse validado del cliente.
- `recordFilingPending` registra intentos PENDING.
- **Toda presentación de test debe crear acuse antes de recordFiling** (helper `createEvidenceDocument()`).

### B-1 Lecturas de reglas
- `GET /tax/rule-packs/:packId/versions`, `GET /tax/rule-versions/:id/sources`, `GET /tax/rule-versions/:id/golden-results`.

### B-6 Matriz de permisos
- `docs/matriz-permisos.md` alineada con resolver.ts (secciones fiscales).

---

## ADR-008 — Foco en liquidación fiscal (2026-08-20)

- La navegación del estudio se enfoca en el proceso de liquidación mensual.
- `contabilidad` y `reportes` pasan a `status: "not_released"` en `moduleRegistry.tsx` → ocultos de la nav.
- Código conservado como legado (evidencia/conciliación), NO eliminado.
- Portal conserva "Estados y reportes" y Rentabilidad.
- Test `moduleRegistry.test.ts` fija la ausencia de esos módulos en la nav.

---

## Patrones verificados (evitar repetir errores)

1. **Race de tests en paralelo**: cada suite de test debe usar firma/clientId/maestros 100% únicos (sufijo propio). Los cleanups borran SÓLO sus códigos y SIEMPRE por clientId.
2. **Filtro con 2+ condiciones sobre el mismo campo**: combinar en un solo objeto `{...gte, ...lte}`, no spreads separados (sobreescriben).
3. **exactOptionalPropertyTypes**: usar spreads condicionales `...(x ? {x} : {})`; nunca pasar `undefined` explícito.
4. **Tasas en DB**: puntos porcentuales (21.0000); el motor espera decimal (0.21). Normalizar en `calculate()`.
5. **Rebuild de paquetes**: al agregar exports nuevos a packages, rebuild antes de correr tests de apps/api.
6. **Zona horaria**: funciones outbox comparan con `(now() AT TIME ZONE 'UTC')`, no con `CURRENT_TIMESTAMP`.
7. **Fechas/períodos**: usar `Date.UTC(y,m,1)` / `Date.UTC(y,m+1,0)`, no `new Date(y,m,1)` local (desfasa zona -03).

---

## Pendientes que requieren validación profesional (contador)

- Golden cases firmados por contador matriculado (por régimen: IVA/IIBB/TEM/CM03/MONO).
- Cálculos del Excel en el motor: Dto. 814, mora, prorrata, rubros, conciliación.
- Validación profesional de fixtures contables/fiscales.
- Revalidación normativa de rule packs.
- Sign-off de la Puerta 6 (G6-09/10).