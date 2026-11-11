# Extracción multimodal de comprobantes — voucher-ar-v2

## Flujo implementado

El endpoint normal usa exclusivamente `EXTRACTION_ENGINE=model` (default) y `services/ai/app/model_extraction.py`. El servicio rasteriza cada página del PDF o convierte la imagen directa y envía esas imágenes al modelo multimodal de OpenRouter. El texto embebido del PDF no se usa para extraer. `services/ai/app/extractor.py` permanece como código heredado, sin conexión con el endpoint normal; su eliminación queda para un PR posterior a la evaluación de Fase 0.

El modelo devuelve JSON en formato objeto, que el servicio valida contra `voucher-ar-v2` con `VoucherARV2`. El contrato canónico está definido en `services/ai/app/voucher_v2.py` y `packages/contracts/src/documents.ts`. La respuesta preserva nulls, y sólo adapta los datos fiscales visibles al formato persistido que consume la bandeja. El esquema no incluye ítems y el worker no crea filas de ítems. Las claves UI usadas por `StudyBandeja.tsx` incluyen `issuerTaxId`, `voucherNumber`, `voucherType`, `pointOfSale`, `issueDate`, `totalAmount`, `netAmount`, `vatAmount` y `currency`.

La única comprobación aritmética usa tolerancia absoluta de 0,02 unidades de la moneda informada: compara neto + IVA + no gravado + exento + percepciones con el total cuando todos los componentes están disponibles. Un desvío agrega un motivo de revisión y conserva sin cambios los valores devueltos por el modelo. Un comprobante clasificado como `ticket_no_fiscal`, o sin CUIT, CAE ni letra, pasa a revisión manual con motivo «sin datos fiscales» y omite la comprobación de suma. Los campos ausentes o no legibles permanecen null; no se estiman.

## Privacidad y estado de la allowlist

ADR-0005 exige ZDR, `data_collection: deny`, parámetros requeridos y proveedores/modelos allowlisted. ADR-0009 aprueba `anthropic/claude-haiku-5.5` con los slugs `google-vertex` y `amazon-bedrock`. La política en `services/ai/app/openrouter_policy.py` limita modelo y proveedores; el payload envía `zdr=true`, `data_collection="deny"`, `require_parameters=true`, `allow_fallbacks=false` y `only` con ambos proveedores aprobados. Si falta configuración o un ID no está allowlisted, el motor falla cerrado antes de rasterizar o llamar a OpenRouter.

La solicitud usa `response_format: {"type":"json_object"}` y valida el contenido con `VoucherARV2`. `temperature` no se envía porque los endpoints aprobados no lo anuncian entre sus parámetros soportados; así `require_parameters=true` conserva compatibilidad con el routing. La variable `EXTRACTION_MODEL` queda configurada con el ID aprobado en `.env.example` y Compose.

En producción, `NODE_ENV=production` y `EXTRACTION_CUSTOMER_DATA_ENABLED=false` bloquean la extracción antes de descargar el documento. El valor es `false` por defecto en configuración productiva. Desarrollo y pruebas con documentos sintéticos siguen permitidos; esta aprobación no habilita documentos de clientes.

La llamada reutiliza `OPENROUTER_API_KEY`, la variable que ya consume `services/ai/app/assistant.py`; no se introduce otra clave. Los prompts, imágenes y respuestas completas no se guardan en logs ni en la base. Cada extracción guarda el modelo solicitado, el proveedor informado por OpenRouter cuando está disponible, promptVersion, tokens de entrada/salida, latencia, costo estimado y motivo de revisión. Si OpenRouter no devuelve costo y no se configuran ambas tarifas, `estimatedCostUsd` queda null para evitar inventar un importe.

## Límites y costo/legibilidad

- Máximo: 3 páginas por PDF. Se rasterizan hasta 4 para detectar que el documento excede el límite; un PDF mayor pasa a revisión manual y no se envía parcialmente al modelo.
- PDF: 150 DPI, JPEG calidad 85, máximo de 2048 px en el lado mayor. Esta resolución conserva texto habitual de comprobantes A4 y acota píxeles, payload y consumo multimodal.
- Imagen directa: conserva tamaño legible hasta 2048 px por lado mayor; imágenes superiores se reducen, nunca se amplían.
- El tope de 3 páginas y 4096 tokens de salida limita costo y latencia; su calidad debe verificarse en el set sintético/validado de Fase 0.
- Timeout configurado: OpenRouter 55 s, worker 75 s; es un presupuesto provisional con 15 s para descarga y margen de coordinación. El humo sintético de una imagen midió 5948 ms; aún falta evaluar latencia con documentos de varias páginas. Si el benchmark multi-página excede el timeout, la alternativa es un PR aparte con ejecución asíncrona.

## Configuración

- `EXTRACTION_ENGINE=model`: motor por defecto. Otro valor se cierra en revisión manual; no existe ruta de reglas de fallback.
- `EXTRACTION_MODEL`: ID exacto del modelo; default `anthropic/claude-haiku-5.5`, sujeto a la allowlist de privacidad de ADR-0009.
- `EXTRACTION_CUSTOMER_DATA_ENABLED=false`: compuerta productiva; requiere activación explícita para procesar documentos de clientes.
- `OPENROUTER_API_KEY`: clave existente compartida con el asistente.
- `EXTRACTION_MODEL_TIMEOUT_SECONDS`: timeout del proveedor, default 55, máximo 60.
- `EXTRACTION_WORKER_TIMEOUT_MS`: timeout del worker, default 75000.
- `EXTRACTION_INPUT_USD_PER_MILLION_TOKENS` y `EXTRACTION_OUTPUT_USD_PER_MILLION_TOKENS`: tarifas opcionales para estimar costo cuando la respuesta no incluye costo. Configurar ambas.

Las fallas HTTP, timeout, JSON inválido o respuesta fuera de esquema reciben exactamente un reintento. Si persiste la falla, se guarda una extracción `NEEDS_REVIEW`, el documento queda `EXTRACTED` para la bandeja y `reviewReason` conserva un código sin almacenar payloads. No hay OCR, parsing de texto ni extracción alternativa.

## Datos y migración

La migración `20261111000000_extraction_v2_metrics` agrega tokens, latencia, costo estimado, motivo de revisión y `voucherData` JSONB a `document_extractions`. `voucherData` conserva el esquema voucher-ar-v2 íntegro, incluidos nulls y la confianza por campo; las tablas relacionales mantienen los campos adaptados a la bandeja. La tabla existente `extracted_line_items` se conserva y este flujo no agrega filas. `provider`, `model` y `promptVersion` ya existían. No se agregan seeds.

El alcance cubre los datos fiscales del comprobante; la lectura de QR queda fuera de esta extracción.

## Verificación

- Unit tests del servicio AI: `uv run --no-project --with-requirements services/ai/requirements.txt --with-requirements services/ai/requirements-dev.txt --with pytest pytest -q services/ai/tests` desde la raíz del repo.
- TypeScript: `npm run --workspace @contable/worker typecheck` y las pruebas focalizadas del workspace.
- Los tests usan respuestas/archivos sintéticos y clientes mockeados; CI no llama al modelo.
- Prueba de humo real con PNG sintético y CUIT ficticio válido `30000000007`: OpenRouter devolvió HTTP 200, modelo `anthropic/claude-haiku-5.5`, proveedor `Amazon Bedrock`. El resultado pasó validación `voucher-ar-v2`: 3295 tokens de entrada, 808 de salida, 5948 ms y costo estimado devuelto por OpenRouter de USD 0.0007335. La llamada se restringió al proveedor Bedrock, que forma parte de la allowlist aprobada.

## Bloqueos antes de producción

1. Informe de evaluación de calidad, cobertura, errores, latencia y costo.
2. Confirmación contractual de retención, transferencias y subencargados.
3. OK escrito explícito de Inti para activar el procesamiento de datos reales.
4. Aprobación de despliegue por separado.
