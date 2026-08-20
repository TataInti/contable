# Checklist de sign-off — Puerta 6 (Piloto y endurecimiento)

> Fuente: PLAN_DESARROLLO_CONTABLE.md §12 (Puerta 6) y §17 (Definición de terminado).
> La Puerta 6 es binaria: PASS o FAIL. Cada ítem exige evidencia (commit SHA,
> CI, migración, dataset, comandos, reportes, aprobaciones).
> Un contador matriculado debe firmar el resultado de validación fiscal.
> Estado: actualizado 2026-08-19. Los gaps que bloquean el cierre están en
> [`plan-cierre-gaps.md`](./plan-cierre-gaps.md).

## G6-01 — Selección de clientes piloto

- [x] Al menos un cliente RI (responsable inscripto).
- [ ] Al menos un cliente monotributista.
- [ ] Al menos un cliente IIBB local Tucumán.
- [ ] Al menos un cliente Convenio Multilateral CM03 art. 2.
- [x] Cada cliente tiene perfil fiscal ACTIVE y obligaciones materializadas
      (el script `seed:corrida` asegura el perfil ACTIVE de forma idempotente).

## G6-02 — Períodos históricos en paralelo

- [x] Se ejecutaron períodos históricos con liquidaciones manuales de control.
      Evidencia: `seed:corrida` genera `docs/piloto/g6-corrida-historica.md`
      con 3 períodos consecutivos (Oct–Dic 2025) por cliente RI, cada uno
      FINALIZED con su hash (V-003/V-004).
- [ ] Tres períodos consecutivos por régimen coinciden con el control profesional
      o tienen diferencias explicadas y aceptadas.
      (Pendiente: validación del contador matriculado sobre el reporte.)
- [ ] Cada diferencia tiene actor, fecha, decisión, comentario y evidencia.

## G6-03 — Registro de diferencias y corrección

- [ ] Las diferencias se registraron por causa (regla, dato, operación).
- [ ] Las reglas/importadores corregidos crearon versiones nuevas (nunca editar
      APPROVED/ACTIVE).
- [ ] Los golden tests se actualizaron y pasan.

## G6-04 — Ensayo de rectificativa, pago parcial y saldo a favor

- [x] Rectificativa crea versión nueva e inmutable la anterior (V-003).
      Cubierto por `settlement.test.ts` y `settlement-*.test.ts` (rectify).
- [x] Pago parcial deja la obligación PARTIALLY_PAID.
      Cubierto por `settlement.test.ts` (recordPayment).
- [x] Saldo a favor se registra y asigna sin alterar el cálculo.
      Cubierto por `settlement.test.ts` (allocateCredit).
- [x] Test de integración del ciclo piloto completo pasa (settlement-piloto.test.ts).

## G6-05 — Restore drill y continuidad

- [ ] Backup cifrado verificado.
- [ ] Restauración ensayada desde base vacía.
- [x] Migraciones aplican limpias (migrate deploy).
- [x] Roles owner, migrator, runtime, worker y readonly verificados.
      (G0-08/G1: CI aplica migrate:deploy + rls.sql + seed-fase2 con roles.)

## G6-06 — Prueba de carga

- [ ] Worklist p95 < 2s con 300 clientes.
- [ ] Apertura de liquidación p95 < 2s sin artifacts pesados.
- [ ] Importación de 10.000 filas como job con progreso.
- [ ] Cálculo de 10.000 hechos < 30s como job.
- [ ] Paginación obligatoria en colecciones; cero consultas sin límite.
- [x] Script `npm run seed:carga -w @contable/api` existe (G6-06, 300 clientes).
      Pendiente: ejecutarlo y medir los objetivos p95 (plan-cierre-gaps G-2).

## G6-07 — Revisión de seguridad y privacidad

- [x] RLS probada con dos firmas y dos clientes (rol runtime).
      Cubierto por `tenant.test.ts` y `fiscal-foundation.test.ts`.
- [x] Portal no accede a endpoints del estudio.
      Cubierto por guard de portal (READONLY/COLLABORATOR).
- [x] Sólo lectura no carga ni mensajea.
      Cubierto por guard de portal + `guard-capabilities.test.ts`.
- [x] Preparador no revisa ni finaliza su propio trabajo.
      Cubierto por maker-checker en settlement/ingestion.
- [x] Finalizada no admite UPDATE/DELETE ni con SQL runtime.
      Cubierto por triggers de inmutabilidad (G3-05).
- [ ] Sin incidentes P0/P1 abiertos.

## G6-08 — Capacitación y runbooks

- [x] Runbooks operativos documentados (docs/runbooks-piloto.md).
- [ ] Equipo de soporte con dueño asignado.
- [ ] Observabilidad con dueño (métricas y alertas).
      Pendiente: endpoint `/metrics` + alertas por runbook (plan-cierre-gaps A-6).

## G6-09 — Sign-off fiscal, técnico y operativo

- [ ] Golden cases firmados por contador matriculado (por régimen).
      Pendiente: evidencia de validación profesional (plan-cierre-gaps G-4).
- [ ] Aprobación técnica (arquitectura, tests, CI).
- [ ] Aprobación funcional (flujos de punta a punta).
- [ ] Aprobación de seguridad.
- [ ] Aprobación operativa (runbooks, soporte, observabilidad).

## G6-10 — Activación progresiva

- [ ] Flags por régimen implementados (TAX_RI, TAX_IIBB_LOCAL_TUC, TAX_TEM_SMT,
      TAX_CM_ART2, TAX_MONOTRIBUTO).
- [ ] El backend es autoridad: la UI sólo refleja la decisión.
- [ ] Rollback de feature flag ensayado (apagar sin perder lectura histórica).
- [ ] Activación por firma/cliente/impuesto verificada.
- [ ] Un impuesto puede apagarse sin ocultar resultados finalizados ni evidencia.

## Definición de terminado (PLAN §17)

- [ ] Dominio persistente, API, UI y autorización por capacidad.
- [ ] Flujo comienza en necesidad real y termina en resultado persistido.
- [ ] Sin planilla paralela para completar el cálculo.
- [ ] Reglas con fuente, vigencia, hash y aprobación profesional.
- [ ] Motor con golden tests.
- [ ] Períodos y cutoff probados.
- [ ] Cálculo reproducible (V-004).
- [ ] Maker-checker impuesto por servicio y base.
- [ ] Loading, vacío, error, conflicto, progreso y recibo.
- [ ] Cada importe con drill-down.
- [ ] Finalizados inmutables (V-003).
- [ ] Rectificación conserva historia.
- [ ] Presentación y pago con evidencia.
- [ ] RLS probada con runtime.
- [ ] E2E desktop y móvil pasa.
- [ ] Accesibilidad crítica pasa.
- [ ] Observabilidad y runbook existen.
- [ ] La función puede desactivarse sin perder lectura histórica.
- [ ] Sin P0/P1 abiertos.
- [ ] Un contador matriculado firma el resultado de validación.
