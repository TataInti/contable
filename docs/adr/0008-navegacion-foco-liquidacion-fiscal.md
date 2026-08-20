# ADR-008 — La navegación de producto se enfoca en la liquidación fiscal mensual

- **Estado:** Aceptado
- **Fecha:** 2026-08-20
- **Decisión:** retirar de la navegación del estudio los módulos de contabilidad de asientos y de reportes/análisis BI; conservar su código como legado técnico.

## Contexto

El proceso documentado en [`docs/proceso-liquidacion-mensual.md`](../proceso-liquidacion-mensual.md) — liquidación mensual de IVA, IIBB, TEM y CM03 — es la razón de existencia del producto. La aplicación había acumulado características adicionales (asientos de doble partida, mayor, balance, reportes genéricos y copiloto BI) que se muestran en la navegación y desvían el foco del flujo esencial. El plan de desarrollo ya clasificaba estos módulos como legado oculto, pero el código se habían adelantado: `moduleRegistry.tsx` los registraba como `released` y las rutas `/contabilidad` y `/reportes` eran alcanzables.

## Decisión

- Los módulos `contabilidad` (asientos/mayor/balances) y `reportes` (reportes y análisis/BI) pasan a `status: "not_released"` en `apps/web/src/study/moduleRegistry.tsx`: se ocultan de la navegación del estudio y sus rutas quedan protegidas por el guard "no disponible".
- Se retira la sección "Asientos por revisar" de la pestaña `study/trabajo` (la mesa de trabajo queda enfocada en pedidos documentales, cierres y obligaciones).
- Se quita el acceso directo a `/contabilidad` desde `study/bandeja`.
- El portal del cliente conserva "Estados y reportes" (entrega de resultados publicados) y la rentabilidad gerencial, tal como quedó definido: son entrega de valor del flujo fiscal, no doble partida.

## Consecuencias

- La navegación del estudio refleja el proceso de liquidación mensual: captura/ingesta, bandeja documental, configuración fiscal, trabajo, liquidaciones, expediente mensual, rentabilidad, reglas fiscales y administración.
- `apps/web/src/study/StudyContabilidad.tsx`, `StudyReportes.tsx`, `packages/accounting-engine`, los servicios `journal/`, `reporting/`, `bi/` y sus contratos permanecen en el repositorio: son evidencia y conciliación interna posibles de reactivar, no rutas de producto.
- Un test (`moduleRegistry.test.ts`) fija que `contabilidad` y `reportes` no aparecen en la navegación aunque el rol tenga todas las capacidades.
- El E2E `e2e/integrated-flow.spec.ts` verifica la ausencia de esos enlaces en la navegación real.

## Alternativas consideradas

- **Eliminar el código por completo:** descartado: el mayor contable es base técnica aprovechable como evidencia/conciliación (decisión de alcance en [PLAN_DESARROLLO_CONTABLE.md](../../PLAN_DESARROLLO_CONTABLE.md) §2.2 y §3) y su remoción implicaría migraciones y riesgos innecesarios.
- **Mantener los módulos en la navegación pero ocultos por feature flag:** descartado porque la flag `LEDGER`/`REPORTING` no era suficiente (el `status` del módulo gobernaba la navegación real) y la expectativa de producto es foco único en el flujo fiscal.