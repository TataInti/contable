# Extracción multimodal de comprobantes — voucher-ar-v2.1

## Flujo y contrato vigente

El endpoint normal usa exclusivamente `EXTRACTION_ENGINE=model` (default) y `services/ai/app/model_extraction.py`. El servicio rasteriza cada página de PDF o convierte la imagen directa y envía las imágenes al modelo multimodal. El texto embebido del PDF no participa en la extracción. El motor heredado permanece desconectado y el worker no crea filas de ítems.

El modelo devuelve JSON plano validado con `VoucherARV21` en `services/ai/app/voucher_v2.py` y `voucherARV21Schema` en `packages/contracts/src/documents.ts`. La versión de esquema vigente es `voucher-ar-v2.1`. Cada percepción tiene:

- `categoria`: `IIBB | IVA | Ganancias | SUSS | Impuestos internos | Municipal | Otras`.
- `tipo_texto`: `string | null`, transcripción literal del texto impreso.
- `importe`: `string | null`.

### Fuente del catálogo

La aplicación no tenía un catálogo canónico de tipos de percepción para extracción. El plan de cuentas define tipos contables generales (`ASSET`, `LIABILITY`, `EQUITY`, `REVENUE`, `EXPENSE`, `MEMO`) y el rol `PERCEPTION`; `PerceptionCertificate.concept` es texto libre y sus referencias `taxTypeId`/`regimeId` dan alcance fiscal, no un enum para clasificar el rótulo impreso. El importador Excel reconoce columnas de origen como IIBB, IVA, municipales, internos y otros tributos. Esas columnas de importación tampoco forman un catálogo único: son específicas del formato y no cubren, por ejemplo, Ganancias y SUSS.

Por eso se implementa el catálogo fijo aprobado por Inti, sin sumar categorías inferidas de esas otras listas. Si el modelo devuelve una categoría fuera del catálogo, `Otras`, o una percepción que no puede clasificar por falta de `tipo_texto`, el motor conserva el texto visible, fija `categoria: "Otras"`, asigna confianza 0 a esa categoría derivada y marca revisión con `percepción no reconocida`.

## Prompt y validaciones

El prompt `vision-ar-v5` instruye el catálogo y el formato `categoria` + `tipo_texto` + `importe`, con ejemplo. Conserva las reglas anteriores: valores ausentes o no legibles como null; CUIT de exactamente 11 dígitos consecutivos; transcripción literal completa de `condicion_iva`; no inventar datos ni anteponer `Percepcion` si no está impresa. `tipo_texto` se preserva como aparece, incluidos prefijos o calificadores realmente impresos.

La comprobación aritmética mantiene tolerancia absoluta 0,02 y suma neto + IVA + no gravado + exento + percepciones frente al total cuando los componentes están disponibles. `sin datos fiscales` y desvíos aritméticos son motivos a nivel documento.

## Rutas estables de revisión

El formato es `coleccion[indice].campo`, con índice de lista basado en cero. Ejemplos: `iva[1].importe` y `percepciones[0].categoria`. Para los campos de percepción también puede usarse `percepciones[0].tipo_texto` o `.importe`.

El motor expone `reviewIssues: Array<{ reason: string; sourcePath: string | null }>` en la respuesta AI y la API. Cada motivo asociado a una fila lleva su `sourcePath`; los motivos del documento, como `sin datos fiscales` o `COMPONENT_SUM_MISMATCH`, llevan `sourcePath: null`. `reviewReason` e `issues` se conservan en la respuesta AI por compatibilidad. La corrección y aprobación mantienen el flujo existente.

Los GET `/api/v1/firms/:firmId/clients/:clientId/documents/:documentId/extraction` y `/api/v1/firms/:firmId/clients/:clientId/extractions/:extractionId` exponen `reviewIssues`. Para el PR #30, la UI puede usar `sourcePath` para resolver la fila en `voucherData`; las propiedades de cada percepción nueva son `categoria: string` (enum anterior), `tipo_texto: string | null`, `importe: string | null`.

## Versionado y registros existentes

Se eleva el esquema a `voucher-ar-v2.1` porque cambia la forma de `percepciones`; no se reutiliza el nombre v2 con una estructura incompatible. Las nuevas extracciones guardan `schemaVersion: "voucher-ar-v2.1"` y `percepciones[].categoria/tipo_texto/importe`.

Los registros guardados antes de este cambio permanecen intactos como `schemaVersion: "voucher-ar-v2"` con `percepciones[].tipo/importe`. La API los devuelve con esa estructura y versión, sin reinterpretar ni reescribir su JSON. El contrato compartido acepta las dos versiones para que los clientes discriminen por `schemaVersion`. Las filas antiguas sin motivos estructurados se exponen con `reviewIssues: []`.

La única migración de base es aditiva: agrega `document_extractions.reviewIssues JSONB` nullable. No transforma ni borra `voucherData`, no requiere backfill, y no altera las tablas de campos ni el flujo de aprobación/corrección.

## Privacidad y configuración

ADR-0009 mantiene el modelo aprobado `anthropic/claude-haiku-5.5` y los proveedores `google-vertex` y `amazon-bedrock`. `services/ai/app/openrouter_policy.py`, la allowlist, el payload ZDR y la compuerta productiva no se modifican. En producción, `EXTRACTION_CUSTOMER_DATA_ENABLED=false` sigue bloqueando documentos de clientes hasta autorización separada. Sólo se usaron documentos sintéticos.

`OPENROUTER_API_KEY` se cargó en el proceso del benchmark desde el `.env` del servidor. No se escribió en el repositorio, artefactos, logs ni reporte.

## Benchmark sintético

El benchmark v3 usa los mismos 40 documentos y el mismo harness del benchmark v2, adaptado al esquema v2.1. La verdad se copió a `benchmark_v3/verdad/`; `tipo` se conservó literalmente en `tipo_texto` y el único rótulo legado, `IIBB - dato sintetico`, se derivó a `IIBB` por coincidencia de la sigla. No se modificaron `benchmark/`, `benchmark_v2/` ni `verdad/` originales.

| Métrica | v2 | v3 |
|---|---:|---:|
| Exactitud global | 773/800 (96,62%) | 800/800 (100,00%) |
| Categoría de percepciones | 40/40 | 40/40 |
| Importe de percepciones | 40/40 | 40/40 |
| `tipo_texto` literal exacto (informativo, no suma errores) | 1/28 (3,57%) | 3/28 (10,71%) |
| Errores de campo sin marca | 27 | 0 |
| Documentos marcados para revisión | 12 | 12 |
| Respuestas finales inválidas | 0 | 0 |
| Llamadas HTTP | 40 | 40 |
| Latencia media / p95 | 5936 / 8548 ms | 6308 / 8577 ms |
| Costo reportado por OpenRouter | USD 0,03737860 | USD 0,03819510 |

En v2, categoría e importe se calcularon desde el `tipo` legado con la misma derivación de etiquetas de la verdad adaptada; ambos coincidieron en los 40 documentos. `tipo_texto` se comparó por separado, sin contabilizarlo como error global. El benchmark v3 superó la meta de más de 98% global y logró cero errores sin marca, por lo que no se hizo otra iteración de prompt. Gasto nuevo acumulado en este encargo: USD 0,03819510 de USD 0,20; las 40 llamadas devolvieron costo informado.

Los artefactos completos están fuera del repositorio en `/root/.hermes/cache/eval/voucher-ar-sintetico-v1/benchmark_v3/`.

## Verificación

- Servicio AI: `pytest -q services/ai/tests`.
- Servicio AI: `ruff check app tests` y `mypy -p app` desde `services/ai`.
- Servicio AI: `ruff format --check` aplicado a los archivos modificados.
- Contrato/API/worker: lint, typecheck y tests de la aplicación; CI del PR.
- Benchmark: `benchmark_v3/benchmark.py --preflight` verificó 40 documentos y 46 páginas sin llamadas; la corrida real usó 40 llamadas en allowlist.

## Riesgos y alcance

La verdad sintética sólo contiene rótulos IIBB; no mide clasificación real de IVA, Ganancias, SUSS, Impuestos internos ni Municipal. `Otras` se revisa de forma conservadora para que ningún rótulo no reconocido pase sin revisión. La transcripción literal permanece como dato visible y métrica informativa separada; en v3 coincidió exactamente en 3/28 percepciones. El benchmark no autoriza documentos reales ni despliegue.
