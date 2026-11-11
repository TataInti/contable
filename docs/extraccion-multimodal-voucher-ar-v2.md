# Extracción multimodal de comprobantes — voucher-ar-v2

## Flujo implementado

El endpoint normal usa exclusivamente `EXTRACTION_ENGINE=model` (default) y `services/ai/app/model_extraction.py`. El servicio rasteriza cada página del PDF o convierte la imagen directa y envía esas imágenes al modelo multimodal de OpenRouter. El texto embebido del PDF no se usa para extraer. `services/ai/app/extractor.py` permanece como código heredado, sin conexión con el endpoint normal; su eliminación queda para un PR posterior a la evaluación de Fase 0.

El modelo responde con el esquema `voucher-ar-v2`, versión de prompt `vision-ar-v2`, temperatura 0. El contrato canónico está definido en `services/ai/app/voucher_v2.py` y `packages/contracts/src/documents.ts`. La respuesta preserva nulls, y sólo adapta los datos fiscales visibles al formato persistido que consume la bandeja. El esquema no incluye ítems y el worker no crea filas de ítems. Las claves UI usadas por `StudyBandeja.tsx` incluyen `issuerTaxId`, `voucherNumber`, `voucherType`, `pointOfSale`, `issueDate`, `totalAmount`, `netAmount`, `vatAmount` y `currency`.

La única comprobación aritmética usa tolerancia absoluta de 0,02 unidades de la moneda informada: compara neto + IVA + no gravado + exento + percepciones con el total cuando todos los componentes están disponibles. Un desvío agrega un motivo de revisión y conserva sin cambios los valores devueltos por el modelo. Un comprobante clasificado como `ticket_no_fiscal`, o sin CUIT, CAE ni letra, pasa a revisión manual con motivo «sin datos fiscales» y omite la comprobación de suma. Los campos ausentes o no legibles permanecen null; no se estiman.

## Privacidad y estado de la allowlist

ADR-0005 exige ZDR, `data_collection: deny`, parámetros requeridos y proveedores/modelos allowlisted, pero el ADR y el checkout `origin/main` no enumeran IDs de modelo ni proveedores aprobados. `qwen/qwen3.8-flash` no aparece en esa allowlist verificable. Por eso el código mantiene las allowlists de extracción vacías y falla cerrado: configurar un modelo no aprobado devuelve revisión manual con motivo y no contacta OpenRouter. `EXTRACTION_MODEL` queda vacío en `.env.example`; el Qwen solicitado no queda como default ni se activa en este PR.

La llamada reutiliza `OPENROUTER_API_KEY`, la variable que ya consume `services/ai/app/assistant.py`; no se introduce otra clave. Cuando un futuro cambio agregue IDs aprobados, el request enviará `provider.zdr=true`, `provider.data_collection="deny"`, `provider.require_parameters=true`, `provider.allow_fallbacks=false` y `provider.only` limitado a la allowlist revisada. Este PR no cambia configuración de producción.

Los prompts, imágenes y respuestas completas no se guardan en logs ni en la base. Cada extracción sí guarda proveedor, modelo, promptVersion, tokens de entrada/salida, latencia, costo estimado y motivo de revisión. Si OpenRouter no devuelve costo y no se configuran ambas tarifas, `estimatedCostUsd` queda null para evitar inventar un importe.

## Límites y costo/legibilidad

- Máximo: 3 páginas por PDF. Se rasterizan hasta 4 para detectar que el documento excede el límite; un PDF mayor pasa a revisión manual y no se envía parcialmente al modelo.
- PDF: 150 DPI, JPEG calidad 85, máximo de 2048 px en el lado mayor. Esta resolución conserva texto habitual de comprobantes A4 y acota píxeles, payload y consumo multimodal.
- Imagen directa: conserva tamaño legible hasta 2048 px por lado mayor; imágenes superiores se reducen, nunca se amplían.
- El tope de 3 páginas y 4096 tokens de salida limita costo y latencia; su calidad debe verificarse en el set sintético/validado de Fase 0.
- Timeout configurado: OpenRouter 55 s, worker 75 s; es un presupuesto provisional con 15 s para descarga y margen de coordinación. La prueba de humo de este PR no se ejecutó por el bloqueo de allowlist/credencial, por lo que estos valores no son una medición. Si el benchmark multi-página excede el timeout, la alternativa es un PR aparte con ejecución asíncrona.

## Configuración

- `EXTRACTION_ENGINE=model`: motor por defecto. Otro valor se cierra en revisión manual; no existe ruta de reglas de fallback.
- `EXTRACTION_MODEL`: ID exacto del modelo, requerido y sujeto a allowlist de privacidad. Permanece vacío hasta una aprobación versionada.
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
- Prueba de humo con imagen/documento sintético: NO EJECUTADA. Bloqueada: qwen no está en una allowlist verificable de ADR-0005 y `OPENROUTER_API_KEY` no está presente en este VPS. No se sustituyó por otra extracción.

## Bloqueos antes de producción

1. OK escrito de privacidad de Inti.
2. Confirmación contractual de retención y subencargados de OpenRouter para proveedor/modelo.
3. Decisión versionada que agregue a la allowlist los IDs exactos aprobados; incluye `qwen/qwen3.8-flash` sólo si privacidad lo aprueba.
4. Benchmark de calidad/confianza contra el set de Fase 0.
5. Medición de latencia por número de páginas y confirmación de timeout; PR asíncrono separado si corresponde.
6. Decisión posterior sobre eliminación del extractor de reglas.
