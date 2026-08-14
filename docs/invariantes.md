# Invariantes de dominio — Contable

> Escenarios Given/When/Then que expresan los invariantes del plan como tests pendientes.
> Cada invariante se convertirá en tests de unidad/propiedad/integración en las fases correspondientes.
> Formato: `[ID] [Área] — [invariante]`.

## Ledger — partida doble

### L-001 Posting balancea
- **Given** un asiento `REVIEWED` con líneas de débito y crédito
- **When** se ejecuta `postJournalEntry`
- **Then** el asiento pasa a `POSTED` y la suma de débitos = suma de créditos en moneda funcional

### L-002 Posting rechaza desbalance
- **Given** un asiento `REVIEWED` con débitos ≠ créditos
- **When** se ejecuta `postJournalEntry`
- **Then** el asiento permanece `REVIEWED` y se devuelve error `UNBALANCED_ENTRY`

### L-003 Posting rechaza línea en cero
- **Given** un asiento con una línea donde débito = crédito = 0
- **When** se valida el asiento
- **Then** se devuelve error `ZERO_LINE`

### L-004 Posting rechaza débito y crédito simultáneos
- **Given** una línea con débito > 0 y crédito > 0
- **When** se valida el asiento
- **Then** se devuelve error `AMBIGUOUS_LINE`

### L-005 Posting rechaza importe negativo
- **Given** una línea con débito o crédito negativo
- **When** se valida el asiento
- **Then** se devuelve error `NEGATIVE_AMOUNT`

### L-006 Posting exige estado REVIEWED
- **Given** un asiento en estado `DRAFT`, `IN_REVIEW` o `REJECTED`
- **When** se ejecuta `postJournalEntry`
- **Then** se devuelve error `INVALID_STATE_TRANSITION`

### L-007 Posting exige preparador ≠ revisor
- **Given** un asiento `REVIEWED` donde `preparedByUserId = reviewedByUserId`
- **When** se ejecuta `postJournalEntry`
- **Then** se devuelve error `MAKER_CHECKER_VIOLATION`

### L-008 Posting es idempotente
- **Given** un asiento `REVIEWED`
- **When** se ejecuta `postJournalEntry` dos veces con la misma `Idempotency-Key` y body
- **Then** la segunda ejecución devuelve la respuesta previa sin crear un segundo asiento

### L-009 Posting con key distinta genera conflicto
- **Given** un asiento `REVIEWED`
- **When** se ejecuta `postJournalEntry` dos veces con la misma `Idempotency-Key` pero body distinto
- **Then** se devuelve `409 IDEMPOTENCY_CONFLICT`

### L-010 Posting concurrente asigna secuencia única
- **Given** dos postings concurrentes del mismo cliente/ejercicio
- **When** ambos ejecutan `postJournalEntry`
- **Then** cada asiento recibe un `sequenceNumber` distinto y consecutivo

### L-011 Posting es inmutable
- **Given** un asiento `POSTED`
- **When** se intenta editar, eliminar o cambiar su estado
- **Then** la operación falla; el asiento y sus líneas permanecen intactos

### L-012 Reversión conserva historia
- **Given** un asiento `POSTED`
- **When** se crea y postea una reversión
- **Then** el original permanece `POSTED`, la reversión queda vinculada (`reversalOfId`/`reversedByEntryId`) y el mayor muestra ambos

### L-013 Reversión duplicada falla
- **Given** un asiento `POSTED` ya revertido
- **When** se intenta revertir de nuevo
- **Then** se devuelve error `ALREADY_REVERSED`

### L-014 Período hard-closed bloquea escritura
- **Given** un período `HARD_CLOSED`
- **When** se intenta postear un asiento en ese período
- **Then** se devuelve error `PERIOD_CLOSED`

### L-015 Período soft-closed exige excepción
- **Given** un período `SOFT_CLOSED`
- **When** se intenta postear sin excepción de reviewer/admin
- **Then** se devuelve error `PERIOD_SOFT_CLOSED`; con excepción válida, el posting procede y el cierre se invalida

### L-016 Reapertura exige rol y motivo
- **Given** un período `HARD_CLOSED`
- **When** se ejecuta `reopen` sin rol autorizado o sin motivo
- **Then** se devuelve error `REOPEN_UNAUTHORIZED` o `REOPEN_REASON_REQUIRED`; con ambos, se crea evento de auditoría y se invalida el cierre anterior

### L-017 Cuenta de otro cliente falla
- **Given** una línea que referencia una cuenta de otro cliente
- **When** se valida el asiento
- **Then** se devuelve error `ACCOUNT_TENANT_MISMATCH` (FK compuesta o RLS)

### L-018 Cuenta no imputable falla
- **Given** una línea que referencia una cuenta `isPostable = false`
- **When** se valida el asiento
- **Then** se devuelve error `ACCOUNT_NOT_POSTABLE`

### L-019 Cuenta inactiva falla
- **Given** una línea que referencia una cuenta `isActive = false`
- **When** se valida el asiento
- **Then** se devuelve error `ACCOUNT_INACTIVE`

### L-020 Fecha fuera del ejercicio falla
- **Given** un asiento con `entryDate` fuera del rango del ejercicio
- **When** se valida el asiento
- **Then** se devuelve error `DATE_OUT_OF_FISCAL_YEAR`

### L-021 Moneda extranjera exige tasa
- **Given** una línea en moneda extranjera sin tipo de cambio
- **When** se valida el asiento
- **Then** se devuelve error `EXCHANGE_RATE_REQUIRED`

### L-022 Tasa cero falla
- **Given** una línea en moneda extranjera con tipo de cambio = 0
- **When** se valida el asiento
- **Then** se devuelve error `EXCHANGE_RATE_ZERO`

### L-023 Importe funcional corresponde a original × tasa
- **Given** una línea con original, tasa y funcional
- **When** se valida el asiento
- **Then** el funcional = original × tasa dentro de la política de redondeo configurada

### L-024 Edición concurrente falla con 412
- **Given** un borrador con `rowVersion` v1
- **When** dos usuarios editan y el segundo envía `If-Match: v1` tras el primer commit
- **Then** el segundo recibe `412 PRECONDITION_FAILED`

### L-025 Modificar líneas invalida aprobación
- **Given** un asiento `REVIEWED` con `EntryApproval` vigente
- **When** se modifican líneas
- **Then** la versión incrementa y la aprobación anterior queda inválida

## Tenancy y autorización

### T-001 Sin firma no hay fila
- **Given** cualquier tabla de negocio
- **When** se intenta insertar sin `firm_id`
- **Then** la operación falla (constraint o RLS)

### T-002 Sin cliente no hay recurso de cliente
- **Given** cualquier recurso de cliente
- **When** se intenta insertar sin `client_id`
- **Then** la operación falla

### T-003 ID de otra firma no revela existencia
- **Given** un usuario de firma A
- **When** consulta un recurso de firma B por ID conocido
- **Then** recibe `404`, no `403` ni datos

### T-004 ID de otro cliente no revela existencia
- **Given** un usuario con acceso a cliente X de su firma
- **When** consulta un recurso del cliente Y (misma firma, sin asignación)
- **Then** recibe `404`

### T-005 403 sólo para recurso visible sin capacidad
- **Given** un usuario con acceso a un recurso
- **When** intenta una acción sin capacidad (ej. `entry.post` sin rol)
- **Then** recibe `403`

### T-006 Cambio de contexto limpia selección
- **Given** un usuario con cliente X seleccionado y contexto de IA activo
- **When** cambia al cliente Y
- **Then** se limpia la selección documental, se cancela queries y se inicia scope nuevo de asistente/BI

### T-007 Usuario multiestudio elige explícitamente
- **Given** un usuario con membresías en firmas A y B
- **When** inicia sesión
- **Then** no se selecciona automáticamente la primera membresía; debe elegir

### T-008 Revocación corta acceso
- **Given** una membresía o asignación activa
- **When** se revoca
- **Then** el usuario pierde acceso inmediato (sesiones incluidas)

### T-009 Runtime no puede evadir RLS
- **Given** el rol runtime de PostgreSQL
- **When** intenta `SET ROLE` a owner, `BYPASSRLS` o deshabilitar RLS
- **Then** la operación falla

### T-010 Portal no ve borradores
- **Given** un usuario portal
- **When** consulta un borrador contable, impositivo o de reporte por ID conocido
- **Then** recibe `404`

### T-011 Portal no ve mensajes internos
- **Given** un usuario portal
- **When** consulta un mensaje `INTERNAL`
- **Then** recibe `404`

### T-012 Portal no ve otros clientes
- **Given** un usuario portal con membresía en cliente X
- **When** consulta un recurso del cliente Y
- **Then** recibe `404`

## Documentos y extracción

### D-001 Sólo objetos limpios pasan a originales
- **Given** un archivo en cuarentena
- **When** el worker valida magic bytes, límites y ClamAV
- **Then** sólo un objeto limpio se copia a `originals`; un infectado permanece aislado

### D-002 Original inmutable
- **Given** un objeto en `originals`
- **When** se intenta modificar o reemplazar
- **Then** la operación falla; una rotación/corrección crea un derivado, nunca un reemplazo

### D-003 Reintento no duplica
- **Given** un `DocumentProcessingJob` con `deduplicationKey`
- **When** se reintenta o se reenvía el mismo trabajo
- **Then** no se crea un segundo job; se reutiliza el existente

### D-004 Reprocesamiento versiona
- **Given** un documento con extracción v1
- **When** se reprocesa
- **Then** se crea una extracción v2; v1 permanece y el usuario compara antes de promover

### D-005 Conflicto no se resuelve silenciosamente
- **Given** dos fuentes (QR vs OCR) con valores discrepantes
- **When** se genera la extracción
- **Then** el campo queda `CONFLICT`, se muestran ambas evidencias y el preparador decide

### D-006 CUIT válido
- **Given** un CUIT extraído
- **When** se valida
- **Then** debe tener 11 dígitos y dígito verificador válido; si no, queda `MISSING`/`CONFLICT`, nunca se inventan dígitos

### D-007 Duplicado binario detectado
- **Given** un archivo con SHA-256 igual a otro del mismo cliente
- **When** se procesa
- **Then** se marca `EXACT_DUPLICATE`

### D-008 Duplicado fiscal detectado
- **Given** un comprobante con misma dirección, emisor, tipo, punto de venta y número
- **When** se procesa
- **Then** se marca `POSSIBLE_DUPLICATE` y exige decisión documentada; no se borra

### D-009 Total inconsistente no pasa
- **Given** un comprobante donde la suma de ítems ≠ total impreso
- **When** se valida
- **Then** el campo queda `CONFLICT` y no se aprueba sin resolución

### D-010 Aprobación documental ≠ posting
- **Given** un documento aprobado
- **When** se genera la propuesta de asiento
- **Then** la propuesta no se contabiliza automáticamente; requiere flujo de revisión independiente

## IVA

### V-001 Liquidación concilia con mayor
- **Given** una liquidación IVA calculada
- **When** se compara contra las cuentas IVA del mayor
- **Then** toda diferencia muestra detalle y origen; no se finaliza con diferencias sin justificar

### V-002 Finalización exige revisor distinto
- **Given** una liquidación `CALCULATED`
- **When** se intenta finalizar con el mismo preparador
- **Then** se devuelve error `MAKER_CHECKER_VIOLATION`

### V-003 Finalizada es inmutable
- **Given** una liquidación `FINALIZED`
- **When** se intenta editar
- **Then** la operación falla; una corrección crea una versión rectificativa

### V-004 Reejecución con mismo cutoff es estable
- **Given** una liquidación con cutoff y versión de reglas fijos
- **When** se reejecuta
- **Then** produce el mismo resultado

### V-005 Cambio de regla no altera finalizadas
- **Given** una regla IVA modificada
- **When** se consulta una liquidación finalizada previa
- **Then** la liquidación conserva la versión de reglas con la que se calculó

## Reportes y publicación

### R-001 Mismo cutoff produce mismo hash
- **Given** un report run con plantilla, mapeos, perfil y cutoff fijos
- **When** se ejecuta dos veces
- **Then** produce el mismo resultado y hash

### R-002 Borrador nunca aparece en portal
- **Given** un snapshot `DRAFT` o `REVIEWED`
- **When** el portal consulta publicaciones
- **Then** no aparece; sólo `PUBLISHED`

### R-003 Publicación inmutable
- **Given** un snapshot `PUBLISHED`
- **When** se intenta modificar
- **Then** la operación falla; una corrección crea nueva ejecución/publicación y la anterior queda sustituida o revocada

### R-004 Drill-down hasta evidencia
- **Given** un renglón de reporte
- **When** se hace drill-down
- **Then** se llega a cuentas → líneas → asiento → documento/campo

### R-005 Fórmula inválida no compila
- **Given** una fórmula AST con referencia inexistente, ciclo o combinación incompatible
- **When** se compila
- **Then** se devuelve error de compilación; no se ejecuta

## Bancos

### B-001 Dedupe por externalId o hash
- **Given** un extracto con movimientos
- **When** se importa
- **Then** se deduplica por `externalId`; si no existe, por hash de cuenta, fecha valor, importe, moneda y referencia normalizada

### B-002 Lote con errores no escribe parcial
- **Given** un lote con filas inválidas
- **When** se importa
- **Then** no se generan escrituras parciales; el lote queda `FAILED` con errores por fila

### B-003 Match no sobreaplica
- **Given** un movimiento bancario
- **When** se confirma un match
- **Then** el importe aplicado no excede el movimiento; no se reutiliza un movimiento ya conciliado

### B-004 Snapshot reproduce saldos
- **Given** una conciliación finalizada
- **When** se reproduce el snapshot
- **Then** saldo inicial + movimientos = saldo final dentro de tolerancia cero para misma moneda

### B-005 Reabrir deja historia
- **Given** una conciliación finalizada
- **When** se reabre
- **Then** se conserva el snapshot anterior y se registra motivo/actor

## Inflación y moneda

### I-001 Run no modifica libros antes de posting
- **Given** un run de inflación o diferencia de cambio
- **When** se ejecuta
- **Then** no altera el ledger; produce worksheet y asiento borrador

### I-002 Run reproducible
- **Given** un run con `indexVersion + policyVersion + ledgerCutoff`
- **When** se reejecuta
- **Then** produce el mismo resultado

### I-003 IA no decide categorías
- **Given** un run de inflación
- **When** falta una capa de origen o clasificación
- **Then** la IA sólo señala el faltante; la decisión es humana

## Trabajo y notificaciones

### W-001 Recordatorio no se duplica
- **Given** una obligación con regla de recordatorio
- **When** el scheduler corre dos veces
- **Then** se inserta un `ReminderDispatch` con constraint única; no se envían dos emails

### W-002 Reintento no duplica email
- **Given** un dispatch `FAILED`
- **When** se reintenta
- **Then** se conserva la fila con attempts y `providerMessageId`; no se crea un segundo dispatch

### W-003 Pedido completo por reglas
- **Given** un pedido documental con ítems
- **When** el cliente carga archivos
- **Then** la completitud se deriva de los ítems; no es un porcentaje editable

### W-004 Nota interna no cambia a compartida sin confirmación
- **Given** un mensaje `INTERNAL`
- **When** se intenta cambiar a `SHARED`
- **Then** se exige confirmación explícita y auditoría

## Asistente y BI

### A-001 Cifras canónicas 100% exactas
- **Given** una respuesta del asistente con cifras financieras
- **When** se verifica
- **Then** toda cifra es igual a la fuente canónica y tiene evidencia; si no, la respuesta es `PARTIAL` o `FAILED`

### A-002 Abstención ante falta de datos
- **Given** una consulta sin datos suficientes o sin permiso
- **When** el asistente responde
- **Then** se abstiene explícitamente; no publica una explicación especulativa

### A-003 Sin herramientas prohibidas
- **Given** el catálogo de tools
- **When** se consulta
- **Then** no existen tools de posting, cierre, reapertura, publicación ni presentación fiscal

### A-004 Tool call reautorizado en Node
- **Given** una tool call propuesta por el modelo
- **When** se ejecuta
- **Then** Node revalida sesión, scope, permisos y argumentos; FastAPI no decide permisos

### A-005 Prompt injection no ejecuta
- **Given** un documento/OCR con instrucciones maliciosas
- **When** el asistente procesa
- **Then** el contenido se trata como dato no confiable; no altera instrucciones de sistema ni ejecuta acciones

### A-006 Plan BI inválido nunca ejecuta
- **Given** un plan BI con métrica/dimensión/filtro desconocido o cardinalidad excesiva
- **When** se valida
- **Then** se rechaza; no se ejecuta SQL libre

### A-007 Widget conserva fuente/versión/cutoff
- **Given** un widget BI
- **When** se renderiza
- **Then** muestra plan, versión de métrica, cutoff, fuente y verificación

### A-008 BI = motor canónico
- **Given** una consulta BI y el mismo reporte canónico
- **When** se comparan cifras
- **Then** son exactamente iguales

## Importación y migración

### M-001 Importación atómica
- **Given** un lote de importación con filas válidas e inválidas
- **When** se confirma
- **Then** todas las filas válidas se aplican juntas o no se modifica nada

### M-002 Reimportar no duplica
- **Given** un lote ya aplicado
- **When** se reimporta con la misma clave y hash
- **Then** se devuelve el resultado previo; no se duplican entidades

### M-003 Saldos iniciales como asiento
- **Given** una importación de saldos iniciales
- **When** se aplica
- **Then** se materializa como asiento `OPENING` que balancea; nunca como valor suelto

### M-004 Fila inválida crítica bloquea commit
- **Given** un lote con una fila crítica inválida (CUIT, fecha, moneda, código o importe)
- **When** se confirma
- **Then** el commit falla; el estudio corrige la fuente o acepta una transformación visible y versionada

## Auditoría

### AU-001 Acción sensible genera evento
- **Given** una acción sensible (posting, cierre, reapertura, publicación, finalización, revocación)
- **When** se ejecuta
- **Then** se crea un evento append-only con actor, before/after, request ID e idempotency key

### AU-002 Auditoría no se edita
- **Given** un evento de auditoría
- **When** se intenta modificar o eliminar
- **Then** la operación falla

### AU-003 Datos sensibles redactados
- **Given** un evento de auditoría
- **When** se persiste
- **Then** CUIT, email, nombre, documento y cuenta bancaria aparecen redactados

## Seguridad de archivos

### S-001 Magic byte valida MIME
- **Given** un archivo con MIME declarado distinto del magic byte
- **When** se procesa
- **Then** se rechaza o se reclasifica; nunca se confía en la extensión

### S-002 Límites previos y posteriores
- **Given** un archivo mayor al límite, PDF con más páginas, PDF cifrado, corrupto o con JavaScript embebido
- **When** se procesa
- **Then** se rechaza o se aísla; no se ejecuta contenido activo

### S-003 URL firmada expira
- **Given** una URL firmada de descarga
- **When** expira
- **Then** la descarga falla; se requiere nueva autorización

### S-004 Nombre interno UUID
- **Given** un archivo subido
- **When** se almacena
- **Then** el object key usa UUID interno; nunca el nombre original como ruta