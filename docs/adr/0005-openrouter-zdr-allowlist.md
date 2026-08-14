# ADR-005 — OpenRouter con ZDR y allowlist

- **Estado:** Aceptado
- **Fecha:** 2026-08-12
- **Decisión:** [Sección 2.3 del plan](../../PLAN_DESARROLLO_CONTABLE.md)

## Contexto

El plan define un intermediario multimodelo para IA. Se exige Zero Data Retention, allowlist de proveedores, no training/data collection y logging de contenido deshabilitado.

## Decisión

- OpenRouter se invoca sólo desde FastAPI.
- `provider.zdr = true` y `provider.data_collection = "deny"`.
- Allowlist de modelos con soporte estructurado/visión y políticas aprobadas.
- Logging de input/output deshabilitado.
- Prompts y respuestas completas no se guardan en logs técnicos.
- Timeouts, fallback y circuit breaker; nunca continuar con otro proveedor después de emitir respuesta parcial incompatible.
- Cuotas y budget por estudio, con degradación a procesamiento manual si se agota.

## Consecuencias

- El runtime exige `zdr: true`, `data_collection: "deny"`, `require_parameters: true` cuando corresponda y `only`/allowlist de proveedores aprobados.
- Estas opciones reducen riesgo pero no sustituyen el análisis contractual, de ubicación, transferencia y subencargados.
- La política efectiva se valida periódicamente y se falla cerrado si no existe endpoint elegible.

## Alternativas consideradas

- **Proveedores directos sin intermediario:** descartado por la necesidad de routing restringido, fallback controlado y política uniforme de privacidad.