# ADR-010 — Asistente contable sobre OpenRouter con retención cero

- **Estado:** Aceptado para desarrollo y pruebas con datos sintéticos
- **Fecha:** 2026-11-11
- **Decisión:** Aprobación escrita de Inti (2026-11-11) del corte de retención cero del asistente y del modelo `anthropic/claude-haiku-5.5` como candidato
- **Relacionados:** [ADR-005 — OpenRouter con ZDR y allowlist](./0005-openrouter-zdr-allowlist.md), [ADR-009 — Modelo de extracción multimodal Claude Haiku 5.5](./0009-modelo-extraccion-claude-haiku-5-5.md)

## Contexto

El asistente redacta sobre resultados canónicos del ledger. Hasta este ADR, si `OPENROUTER_MODEL` tenía valor, el request no enviaba `provider`, dejaba `allow_fallbacks` y `data_collection` en los valores por defecto de OpenRouter, enviaba `temperature: 0` y registraba `provider="openrouter"` literal con `inputTokens=0`, `outputTokens=0` y `costUsd="0"`. Además, `assistant.py` propagaba el texto del error HTTP y `assistant-service.ts` lo incorporaba al mensaje `AI_UNAVAILABLE`, que `routes.ts` devolvía al cliente.

La política de modelos y proveedores ya está centralizada en `services/ai/app/openrouter_policy.py` (creada en ADR-009). Este ADR la reutiliza sin duplicar el ID del modelo ni la lista de proveedores.

## Decisión

### Modelo y proveedores aprobados

- Modelo aprobado: `anthropic/claude-haiku-5.5` (ID exacto de OpenRouter), único valor de `ALLOWED_OPENROUTER_MODELS`.
- Proveedores aprobados para `provider.only`: `google-vertex` y `amazon-bedrock`.
- `OPENROUTER_MODEL` se valida contra la allowlist antes de cualquier llamada. Vacío o fuera de la allowlist: respuesta determinista, sin egreso de red.

### Bloque provider

Cada solicitud del asistente envía el bloque construido por `build_provider_payload()`:

```json
{
  "zdr": true,
  "data_collection": "deny",
  "require_parameters": true,
  "allow_fallbacks": false,
  "only": ["google-vertex", "amazon-bedrock"]
}
```

### Exclusión de temperature

El request no envía `temperature`. Los 10 endpoints publicados de `anthropic/claude-haiku-5.5` no anuncian `temperature` en `supported_parameters`; con `require_parameters=true` y `only=[google-vertex, amazon-bedrock]` ningún endpoint quedaría elegible si se enviara, y la llamada fallaría. La exclusión preserva el routing compatible y se aplica en el mismo cambio que el bloque `provider`.

### Datos que salen del sistema

- La consulta del usuario.
- El contexto de firma, cliente y período (UUID), sin nombres ni datos personales del cliente.
- Los resultados de herramientas permitidas: cuentas (código, nombre), saldos y etiquetas de evidencia.
- No salen documentos, adjuntos, imágenes, comprobantes ni el historial completo (hoy `history` va vacío).

### Compuerta y modo determinista por defecto

- `ASSISTANT_OPENROUTER_ENABLED` (default `false` en el servicio AI, dev y prod) es la compuerta exclusiva. Si es `false`, no se llama a OpenRouter aunque existan clave y modelo.
- La compuerta no depende de `NODE_ENV`.
- Sin clave o sin modelo el asistente responde con `_fallback_answer` y `provider="deterministic"`.

### Degradación local

- Una sola llamada; sin reintentos y sin fallback a otro proveedor.
- Errores HTTP, timeout, respuesta inválida, respuesta vacía o modelo devuelto distinto del solicitado degradan a la respuesta determinista y se registran con un código interno seguro (`ASSISTANT_MODEL_HTTP_<status>`, `ASSISTANT_MODEL_TIMEOUT`, `ASSISTANT_MODEL_RESPONSE_*`). El texto remoto nunca se registra ni se propaga.
- `AssistantService` mapea `AI_UNAVAILABLE` con el estado HTTP, sin el cuerpo remoto.
- Timeout del modelo: 10 s, menor que los 15 s de Node, para que la degradación ocurra antes del abort del cliente.
- `max_tokens` acotado a 512.

### Registro del proveedor real y del uso

- El servicio AI lee `provider` y `usage` (`prompt_tokens`, `completion_tokens`, `cost`, o `cost_details.upstream_inference_cost`) de la respuesta y los devuelve en campos opcionales de `AssistantRunResponse`: `inputTokens`, `outputTokens`, `costUsd`. Los campos son aditivos y no rompen el contrato existente.
- Node persiste `assistant_usage` con el proveedor y modelo reales y con los contadores informados. Si el servicio AI no informa uso, los contadores quedan en 0 como antes.
- Si la respuesta no informa proveedor, se conserva la etiqueta de transporte `openrouter`; el proveedor real siempre tiene prioridad.

## Aprobación y alcance

Inti aprobó por escrito el 2026-11-11 el corte de retención cero y `anthropic/claude-haiku-5.5` como modelo candidato. La aprobación cubre desarrollo y pruebas con datos sintéticos. **No** autoriza el procesamiento de datos reales de clientes, ni la activación de `OPENROUTER_MODEL` o de la compuerta en producción, ni el despliegue. Todo queda apagado por defecto en este cambio.

## Evidencia OpenRouter — consulta 2026-11-11

- `anthropic/claude-haiku-5.5` tiene 6 endpoints elegibles bajo ZDR, todos con `safety_retention=false`: `google-vertex/global`, `google-vertex/europe`, `google-vertex/us`, `amazon-bedrock`, `amazon-bedrock/us-east-1` y `amazon-bedrock/eu-west-1`.
- Los 10 endpoints del modelo no anuncian `temperature` en `supported_parameters`.
- El request vigente enviaba `temperature: 0` sin `provider`; con `require_parameters=true` y la allowlist de proveedores, la temperatura debe excluirse para que quede un endpoint elegible.

## Prueba de humo con datos sintéticos — 2026-11-11

Llamada real a OpenRouter desde el proceso local de prueba (`ASSISTANT_OPENROUTER_ENABLED=true` y `OPENROUTER_MODEL=anthropic/claude-haiku-5.5` sólo en ese proceso; compose y producción sin cambios). Entrada: ledger ficticio con una cuenta (`CAJA`, saldo `1254300.50`) y la consulta «¿Cuál es el saldo de la cuenta Caja del ledger de prueba?».

| Caso | HTTP | Proveedor | Tokens entrada/salida | Latencia | Costo informado | `_verified` |
|---|---|---|---|---|---|---|
| Modelo + compuerta activos | 200 | `Google` (= `google-vertex/global`, tag del catálogo de OpenRouter) | 251 / 80 | 1021 ms | USD 0,0000651 | Sí (`abstained=false`) |
| Modelo vacío | — | `deterministic` | — | — | — | Sin llamada de red (0 intentos) |
| Compuerta `false` con clave y modelo | — | `deterministic` | — | — | — | Sin llamada de red (0 intentos) |

- La respuesta del modelo fue «El saldo de la cuenta **Caja** ... es **$1.254.300,50**»; la verificación de cifras del servicio la aceptó contra la evidencia canónica.
- El catálogo de OpenRouter expone el endpoint con `provider_name: "Google"` y `tag: "google-vertex/global"`; el bloque `provider.only` restringe el routing a `google-vertex` y `amazon-bedrock`, sin fallbacks.
- Dos llamadas de completion en total (se repitió una vez para capturar el identificador de generación), gasto acumulado USD 0,0001267, tope USD 0,05. Sin reintentos ante fallo ni cambio de proveedor.

## Pendientes antes de producción

1. Evaluación de calidad y costo del asistente (cobertura, errores, latencia, tokens y costo por turno) con datos sintéticos.
2. Confirmación contractual de retención, transferencias y subencargados de los proveedores aprobados.
3. OK escrito explícito de Inti para procesar datos reales.
4. Aprobación de despliegue por separado; activación de `OPENROUTER_MODEL` y de `ASSISTANT_OPENROUTER_ENABLED` en producción.
5. Consultar el flag `ASSISTANT` en las rutas Node (hoy las rutas no lo leen; no se modificó en este cambio para no alterar el comportamiento existente).
