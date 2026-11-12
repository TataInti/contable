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

El prompt `vision-ar-v7` instruye el catálogo, las equivalencias respaldadas por rótulos visibles y el formato `categoria` + `tipo_texto` + `importe`. Usa el formato numérico argentino: punto para miles, coma para decimales; por ejemplo, `$100.000` → `100000.00`, `$121.000` → `121000.00`, `$1.234,56` → `1234.56` y `$121.000,00` → `121000.00`. Un punto seguido de exactamente tres dígitos no se interpreta como decimal; ante ambigüedad se elige la lectura argentina. Los rótulos `Percep. IVA-RG2408` y `Percep. RG 2408 - DGI` se clasifican como `IVA`; el resto de equivalencias se limita a los rótulos claros presentes en los comprobantes evaluados y las categorías aprobadas. Conserva las reglas anteriores: valores ausentes o no legibles como null; CUIT de exactamente 11 dígitos consecutivos; transcripción literal completa de `condicion_iva`; no inventar datos ni anteponer `Percepcion` si no está impresa. `tipo_texto` se preserva como aparece, incluidos prefijos o calificadores realmente impresos.

### Lectura tolerante de fechas

`vision-ar-v7` agrega una regla explícita para tickets con fecha y hora: si la fecha impresa es `dd/mm/aa` o `dd/mm/aaaa`, con o sin hora, se devuelve `fecha` en `AAAA-MM-DD` y la hora en `hora` como `HH:MM:SS`; nunca otro formato. La fecha argentina se interpreta siempre como día/mes (nunca mes/día) y un año de dos dígitos se completa como `20AA`. El prompt incluye un ejemplo mínimo de ticket con fecha, hora y total.

Antes de `VoucherARV21.model_validate`, `services/ai/app/model_extraction.py` normaliza `fecha`, `hora` y `cae_vencimiento`. Acepta `AAAA-MM-DD`, `DD/MM/AAAA`, `DD/MM/AA`, `DD-MM-AAAA` y una hora opcional separada por espacio o `T`. Si un valor no se puede parsear o la fecha no existe (por ejemplo `31/02/2025`), se descarta sólo ese campo (queda null), se elimina su entrada de `confianza` y se agrega un `ReviewIssue` con `reason: "fecha ilegible"` y `sourcePath` igual al campo (`fecha` o `cae_vencimiento`). Una hora ilegible se descarta igual con `reason: "hora ilegible"` y `sourcePath: "hora"`. El resto del comprobante, incluido el total, se conserva y no se repite la llamada al modelo por este motivo. El esquema sigue aceptando `AAAA-MM-DD` estricto.

Por aprobación escrita de Inti del 11-11-2026, la decisión previa de aplicar una única validación aritmética se reemplaza por reglas de integridad simples y deterministas. El 12-11-2026 Inti decidió sacar la regla del vencimiento del CAE por el ruido de revisión que generaba, así que quedan dos reglas: (1) neto + IVA + no gravado + exento + percepciones vs. total, con tolerancia absoluta 0,02 cuando los componentes están disponibles; (2) dígito verificador de `cuit_emisor` y `cuit_receptor`, validados por separado con los pesos 5,4,3,2,7,6,5,4,3,2. El motivo de la regla de CUIT es `CUIT con dígito verificador inválido`; se emite en `reviewIssues` con `sourcePath` igual a `cuit_emisor` o `cuit_receptor`. El CAE y su vencimiento siguen siendo campos opcionales: el modelo los lee cuando están visibles, pero ninguna regla manda un documento a revisión por ellos. Los valores extraídos se conservan sin corregir ni descartar. Estas comprobaciones no cambian el esquema voucher-ar-v2.1, los contratos ni la API y no requieren migraciones. `sin datos fiscales` y desvíos aritméticos siguen siendo motivos a nivel documento.

## Rutas estables de revisión

El formato es `coleccion[indice].campo`, con índice de lista basado en cero. Ejemplos: `iva[1].importe` y `percepciones[0].categoria`. Las rutas de campos simples son el nombre exacto del campo: `cuit_emisor`, `cuit_receptor` y `fecha`, entre otros. Para los campos de percepción también puede usarse `percepciones[0].tipo_texto` o `.importe`.

El motor expone `reviewIssues: Array<{ reason: string; sourcePath: string | null }>` en la respuesta AI y la API. Cada motivo asociado a una fila lleva su `sourcePath`; los motivos del documento, como `sin datos fiscales` o `COMPONENT_SUM_MISMATCH`, llevan `sourcePath: null`. `reviewReason` e `issues` se conservan en la respuesta AI por compatibilidad. La corrección y aprobación mantienen el flujo existente.

Los GET `/api/v1/firms/:firmId/clients/:clientId/documents/:documentId/extraction` y `/api/v1/firms/:firmId/clients/:clientId/extractions/:extractionId` exponen `reviewIssues`. La UI resuelve `sourcePath` contra la fila correspondiente de `voucherData`, incluidos `cuit_emisor` y `cuit_receptor`. Para el PR #30, las propiedades de cada percepción nueva son `categoria: string` (enum anterior), `tipo_texto: string | null`, `importe: string | null`.

## Versionado y registros existentes

Se eleva el esquema a `voucher-ar-v2.1` porque cambia la forma de `percepciones`; no se reutiliza el nombre v2 con una estructura incompatible. Las nuevas extracciones guardan `schemaVersion: "voucher-ar-v2.1"` y `percepciones[].categoria/tipo_texto/importe`.

Los registros guardados antes de este cambio permanecen intactos como `schemaVersion: "voucher-ar-v2"` con `percepciones[].tipo/importe`. La API los devuelve con esa estructura y versión, sin reinterpretar ni reescribir su JSON. El contrato compartido acepta las dos versiones para que los clientes discriminen por `schemaVersion`. Las filas antiguas sin motivos estructurados se exponen con `reviewIssues: []`.

La única migración de base es aditiva: agrega `document_extractions.reviewIssues JSONB` nullable. No transforma ni borra `voucherData`, no requiere backfill, y no altera las tablas de campos ni el flujo de aprobación/corrección.

## Privacidad y configuración

ADR-0009 mantiene el modelo aprobado `anthropic/claude-haiku-5.5` y los proveedores `google-vertex` y `amazon-bedrock`. `services/ai/app/openrouter_policy.py`, la allowlist, el payload ZDR y la compuerta productiva no se modifican. En producción, `EXTRACTION_CUSTOMER_DATA_ENABLED=false` sigue bloqueando documentos de clientes hasta autorización separada. Los benchmarks de este cambio usan únicamente los comprobantes públicos indicados y el set sintético, sin datos de clientes.

`OPENROUTER_API_KEY` se cargó solo en el proceso del benchmark desde el archivo de credenciales de demo; no se escribió en el repositorio, artefactos, logs ni reporte.

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

En v2, categoría e importe se calcularon desde el `tipo` legado con la misma derivación de etiquetas de la verdad adaptada; ambos coincidieron en los 40 documentos. `tipo_texto` se comparó por separado, sin contabilizarlo como error global. El benchmark v3 superó la meta de más de 98% global y logró cero errores sin marca; ese resultado histórico no requirió una iteración de prompt. El costo de aquella corrida fue USD 0,03819510.

Los artefactos completos están fuera del repositorio en `/root/.hermes/cache/eval/voucher-ar-sintetico-v1/benchmark_v3/`.

## Evaluación del prompt v6 y las validaciones

El motor con `vision-ar-v6` se midió con el benchmark público `benchmark_v2/` (30 comprobantes, 30/30 respuestas) y el benchmark sintético `benchmark_v4/` (40 documentos, 40/40 respuestas). La tabla compara la línea base previa con el resultado final después de una única iteración de ajuste para no omitir subtotales legibles.

| Set | Antes | Final v6 |
|---|---|---|
| Público, 30 | RP027, RP028, RP029 y RP030 tenían hallazgos observables sin marca; RP028 devolvía neto `100.00` y total `121.00`; 4 documentos tenían `reviewReason`. | Los cuatro quedan marcados: RP027/RP028 por CUIT emisor; RP029 por CUIT emisor y receptor; RP030 por CAE vencido. RP028 devuelve neto `100000.00` y total `121000.00`; 8 documentos tienen `reviewReason`. |
| Sintético, 40 | v3: 800/800 campos, cero errores sin marca y 12 documentos marcados. | v4: 799/800 campos; PH002.CAE es un error sin marca; 12 documentos marcados y cero documentos sintéticos marcados por las dos reglas nuevas. |

La inspección visual confirmó que RP027 muestra subtotal `$100.000`, IVA `$21.000` y total `$121.000`; RP028 muestra subtotal `$100.000` y total `$121.000`; RP029 muestra subtotal y total `$100.000`. Los importes finales extraídos coinciden con la escala argentina en los tres comprobantes. El control visual reúne 121 campos; queda una diferencia en RP023: la segunda línea de IVA al 21% está impresa, pero su importe no se lee con esta resolución. El contraste incluye 188 valores de los 22 PDF con texto y no encontró valores contrastables ausentes de ese texto.

La clasificación de `Percep. RG 2408 - DGI` en RP007 y `Percep. IVA-RG2408` en RP013 y RP024 quedó en `IVA`. RP024 también quedó a revisión porque la respuesta del modelo leyó el CUIT receptor como `30715446950`; la imagen muestra `30-71544695-9` (`30715446959`). La revisión se asocia a `cuit_receptor` y conserva el valor extraído sin corregirlo. RP023 mantiene `COMPONENT_SUM_MISMATCH` y ahora registra además el CUIT emisor inválido.

| Regla comprobada en el set público | Antes: cumple / no cumple / no aplica | Final v6: cumple / no cumple / no aplica |
|---|---:|---:|
| Dígito verificador de `cuit_emisor` | 23 / 4 / 3 | 23 / 4 / 3 |
| Dígito verificador de `cuit_receptor` | 23 / 1 / 6 | 22 / 2 / 6 |
| Vencimiento del CAE posterior a la fecha | 25 / 1 / 4 | 25 / 1 / 4 |
| Suma de componentes vs. total | 1 / 1 / 28 | 1 / 1 / 28 |

El cambio de CUIT receptor corresponde a RP024: el modelo devolvió un dígito distinto al visible y la nueva regla lo envió a revisión. En RP007 la clasificación de RG 2408 quedó en IVA. La respuesta final incluyó dos percepciones frente a cinco en la primera corrida v6 y omitió tres rótulos que sí aparecieron en esa respuesta anterior y en el texto del PDF: `Fdo. Des. Ene. Prov. (10,00%)`, `Tasa de Regulac. ERSeP - Dto. 2298 (0,40%)` y `Tasa de Seguridad Eléct. - Ley 10281 (0,10%)`. La línea base v5 también había devuelto dos percepciones; la cobertura de esos rótulos queda pendiente, sin otra iteración de prompt.

El benchmark sintético v4 conserva los 12 motivos previos `sin datos fiscales` y no genera ningún motivo de CUIT ni de vencimiento de CAE. El error sin marca está en `PH002.cae`: verdad `75000000000022`, predicción `75500000000022`. Es el único desacierto entre 800 campos y no queda cubierto por las dos reglas de integridad actuales.

La regla del vencimiento del CAE se eliminó el 12-11-2026 por decisión de Inti; las menciones de RP030 y de la fila «Vencimiento del CAE posterior a la fecha» corresponden a la corrida v6 y quedan como registro histórico.

El costo real acumulado de las corridas de este encargo fue USD 0,10474170 en 100 llamadas, todas con costo informado, dentro del tope de USD 0,40. Los artefactos permanecen fuera del repositorio en `/root/.hermes/cache/eval/voucher-ar-real-publico-v1/benchmark_v2/` y `/root/.hermes/cache/eval/voucher-ar-sintetico-v1/benchmark_v4/`.

## Benchmark v7 (lectura tolerante de fechas)

La corrida v7 usó los mismos 40 documentos sintéticos de `benchmark_v4/` y el mismo harness, apuntado al worktree de este cambio y a la clave de demos fuera del repositorio. El set no incluye comprobantes reales ni datos de terceros.

| Métrica | v6 (v4) | v7 |
|---|---:|---:|
| Exactitud global | 799/800 (99,88%) | 800/800 (100,00%) |
| `fecha` | 40/40 | 40/40 |
| `hora` | 40/40 | 40/40 |
| `total` | 40/40 | 40/40 |
| `cae` | 39/40 | 40/40 |
| Documentos marcados para revisión | 12 | 12 |
| Respuestas finales inválidas | 0 | 0 |
| Llamadas HTTP | 40 | 41 |
| Costo reportado por OpenRouter | USD 0,03819510 (v4) | USD 0,04169060 (parcial; una llamada 429 no informa costo) |

No hubo empeoramiento en ningún campo. La única diferencia frente a v4 es `PH002.cae`, que pasó de error sin marca a acierto; no es atribuible a la regla de fechas y se reporta como variación de la corrida. La llamada extra fue un 429 transitorio de un proveedor, reintentado por el motor y resuelto en la segunda llamada; el harness se ajustó para no abortar la corrida completa ante un error de proveedor sin costo. Los artefactos completos quedan fuera del repositorio en `/root/.hermes/cache/eval/voucher-ar-sintetico-v1/benchmark_v7/`.

## Verificación

- Servicio AI: `pytest -q services/ai/tests`.
- Servicio AI: `ruff check app tests` y `mypy -p app` desde `services/ai`.
- Servicio AI: `ruff format --check` aplicado a los archivos modificados.
- Contrato/API/worker: lint, typecheck y tests de la aplicación; CI del PR.
- Benchmark: `benchmark_v3/benchmark.py --preflight` verificó 40 documentos y 46 páginas sin llamadas; la corrida real usó 40 llamadas en allowlist.

## Riesgos y alcance

La verdad sintética sólo contiene rótulos IIBB; no mide clasificación real de IVA, Ganancias, SUSS, Impuestos internos ni Municipal. `Otras` se revisa de forma conservadora para que ningún rótulo no reconocido pase sin revisión. La transcripción literal permanece como dato visible y métrica informativa separada; en v3 coincidió exactamente en 3/28 percepciones. El benchmark no autoriza documentos reales ni despliegue.
