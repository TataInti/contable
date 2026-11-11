# ADR-009 — Modelo de extracción multimodal Claude Haiku 5.5

- **Estado:** Aceptado para desarrollo y pruebas con documentos sintéticos
- **Fecha:** 2026-11-11
- **Decisión:** Aprobación escrita de Inti; configuración de extracción multimodal voucher-ar-v2
- **Relacionados:** [ADR-0005 — OpenRouter con ZDR y allowlist](./0005-openrouter-zdr-allowlist.md)

## Contexto

ADR-0005 requiere Zero Data Retention, `data_collection: deny`, parámetros requeridos, proveedores allowlisted y fallo cerrado. La extracción documental usa OpenRouter y requiere una identidad de modelo y endpoints que respeten esas políticas. La aprobación recibida autoriza desarrollo y pruebas exclusivamente con documentos sintéticos.

## Decisión

- Modelo aprobado: `anthropic/claude-haiku-5.5` (ID exacto de OpenRouter).
- Proveedores aprobados para `provider.only`: `google-vertex` y `amazon-bedrock`.
- Cada solicitud de extracción configura `provider` con:

  ```json
  {
    "zdr": true,
    "data_collection": "deny",
    "require_parameters": true,
    "allow_fallbacks": false,
    "only": ["google-vertex", "amazon-bedrock"]
  }
  ```

- La política y la construcción del bloque están centralizadas en `services/ai/app/openrouter_policy.py`. Si falta la configuración o el modelo/proveedores no coinciden con la allowlist, el motor devuelve revisión manual antes de rasterizar o llamar a OpenRouter.
- El request usa `response_format: {"type":"json_object"}` y el resultado se valida con `VoucherARV2`. No se envía `temperature`: los endpoints aprobados no lo anuncian en `supported_parameters`, y `require_parameters=true` conserva así el routing compatible.
- En producción, `EXTRACTION_CUSTOMER_DATA_ENABLED=false` impide descargar y procesar documentos de clientes hasta una activación explícita. El servicio de producción usa `NODE_ENV=production`; desarrollo y pruebas sintéticas siguen habilitados.

## Aprobación y alcance

Inti aprobó por escrito el 2026-11-11 el uso de `anthropic/claude-haiku-5.5` y los proveedores indicados para desarrollo y pruebas con documentos sintéticos. Esta decisión no autoriza procesamiento de datos reales ni despliegue productivo.

## Evidencia OpenRouter — consulta 2026-11-11

- `GET /api/v1/models?zdr=true&q=anthropic/claude-haiku-5.5` devolvió `anthropic/claude-haiku-5.5`, confirmando endpoints elegibles bajo el filtro ZDR.
- `GET /api/v1/models/anthropic/claude-haiku-5.5/endpoints` mostró `provider_name=Google` (display name Google Vertex), con tags `google-vertex/global`, `google-vertex/europe` y `google-vertex/us`; y `provider_name=Amazon Bedrock`, con tags `amazon-bedrock`, `amazon-bedrock/us-east-1` y `amazon-bedrock/eu-west-1`.
- El catálogo de políticas de proveedor reportó para Google Vertex y Amazon Bedrock `retainsPrompts=false` y `safetyRetention=false`.
- La documentación oficial de routing define `provider.only` como una lista de slugs y ejemplifica `google-vertex` como slug base que incluye sus variantes regionales. El endpoint API confirma los nombres/tag asociados a esos proveedores.
- Documentación: [Provider Routing](https://openrouter.ai/docs/guides/routing/provider-selection) y [List endpoints for a model](https://openrouter.ai/docs/api-reference/endpoints/list-endpoints).

## Pendientes antes de producción

1. Informe de evaluación de calidad, cobertura, errores, latencia y costo.
2. Confirmación contractual de retención, transferencias y subencargados.
3. OK escrito explícito de Inti para activar el procesamiento de datos reales.
4. Aprobación de despliegue por separado.

Hasta completar esos puntos, la compuerta productiva permanece en `false`.