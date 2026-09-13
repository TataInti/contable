# Runbooks operativos — Piloto (Puerta 6)

> Fuente: PLAN_DESARROLLO_CONTABLE.md §15.3 (Soporte).
> Cada runbook describe síntoma, diagnóstico y acción. Los runbooks son
> propiedad del equipo de soporte y se actualizan con cada incidente.

## RB-00 — Entornos E2E cruzados

**Síntoma:** un documento queda en `UPLOADED` o `QUEUED`, aparece
`FILE_VERSION_NOT_FOUND` en el worker o una corrida E2E consume datos de otra
base.

**Causa habitual:** varias bases comparten Valkey y API/worker usan el mismo
namespace BullMQ.

**Acción:**
1. Asignar un `QUEUE_PREFIX` único por entorno y usar exactamente el mismo
   valor en API y worker (por ejemplo `contable-e2e-20260908`).
2. Confirmar que hay un solo worker documental consumiendo ese prefijo y que
   `WORKER_DATABASE_URL` apunta a la misma base que `E2E_DATABASE_URL`.
3. Ejecutar E2E sobre una base aislada recién migrada y sembrada; no reutilizar
   una base con períodos o documentos de una corrida anterior.

Sin `QUEUE_PREFIX` explícito se conserva `bull`, el namespace histórico de
BullMQ, para no romper despliegues existentes.

## RB-01 — Importación rechazada

**Síntoma:** un lote de importación queda con filas en estado ERROR o el commit
falla.

**Diagnóstico:**
- Revisar `import_rows` del lote: cada fila tiene `error` específico.
- Verificar formato del archivo contra el adaptador versionado (G2-02/03).
- Confirmar que el encabezado, CUIT, período y totales coinciden.

**Acción:**
1. Corregir el archivo o las filas inválidas.
2. Reintentar `validate` (idempotente, no duplica).
3. Si el formato cambió, crear un adaptador nuevo (nunca editar uno en uso).

## RB-02 — OCR detenido

**Síntoma:** documentos sin extracción o cola de OCR estancada.

**Diagnóstico:**
- Estado de `document_processing_jobs`.
- Logs del servicio AI (`services/ai`).
- Confianza por campo: valores con confianza baja quedan pendientes de revisión.

**Acción:**
1. Reiniciar el worker de OCR.
2. Reencolar jobs fallidos (idempotente).
3. El valor oficial SIEMPRE prevalece sobre OCR (G2-10).

## RB-03 — Outbox atascado

**Síntoma:** eventos sin publicar, métricas de edad crecientes.

**Diagnóstico:**
- `outbox_events` con estado PROCESSING y `lockedAt` vencido.
- Logs del dispatcher (lease/retry/reclaim/dead-letter, G0-07).

**Acción:**
1. Verificar que el worker tiene heartbeat.
2. El reclaim automático recupera PROCESSING vencidos (>5 min).
3. Tras 10 intentos, el evento pasa a DEAD_LETTER; revisar causa y reencolar.

## RB-04 — Regla incorrecta

**Síntoma:** un cálculo difiere del control profesional.

**Diagnóstico:**
- Comparar `rulesHash` de la liquidación con la versión ACTIVE.
- Revisar golden tests del rule pack.
- Confirmar vigencia y fuente oficial.

**Acción:**
1. Nunca editar una versión APPROVED/ACTIVE (inmutable).
2. Crear una versión nueva corregida (G1-05).
3. Rectificar las liquidaciones afectadas (G3-09) con motivo y evidencia.

## RB-05 — Cálculo no reproducible

**Síntoma:** mismo input produce distinto output.

**Diagnóstico:**
- Verificar `inputHash`/`outputHash` (V-004).
- Confirmar que el cutoff y el período son idénticos.
- Revisar que no haya hechos fuera del período/cutoff.

**Acción:**
1. El motor es determinista; un cambio de hash implica cambio de entrada o regla.
2. Comparar `settlement_inputs` entre ejecuciones.
3. Si la regla cambió, la liquidación finalizada conserva su `rulesHash` (V-005).

## RB-06 — Vencimiento faltante

**Síntoma:** una obligación no tiene vencimiento derivado.

**Diagnóstico:**
- `due_date_rules` ACTIVE para el régimen.
- Feriados y terminación de CUIT (G1-10).

**Acción:**
1. Verificar que existe DueDateRule ACTIVE.
2. Re-materializar la obligación desde el calendario.
3. Registrar alerta si un vencimiento no se materializó.

## RB-07 — Artifact fallido

**Síntoma:** no se genera el papel de trabajo.

**Diagnóstico:**
- Estado de `tax_export_artifacts`.
- Disponibilidad de MinIO (BUCKETS.exports).
- Checksum sha256 del artifact.

**Acción:**
1. Verificar que la liquidación está FINALIZED (sólo se exporta desde finalizada).
2. Reintentar generación (idempotente).
3. Confirmar que el objeto quedó inmutable con checksum.

## RB-08 — Presentación o pago mal registrado

**Síntoma:** obligación en estado incorrecto (FILED/PAID sin evidencia).

**Diagnóstico:**
- `tax_filings` / `tax_payments` del cliente.
- Asignaciones de pago y saldo pendiente.

**Acción:**
1. Revertir el pago erróneo (`reversePayment`, exige revisor distinto).
2. Re-registrar con la evidencia correcta.
3. La obligación pasa a PAID sólo cuando la asignación cubre el exigible.

## RB-09 — Rectificación

**Síntoma:** se necesita corregir una liquidación finalizada.

**Diagnóstico:**
- Versión actual y `supersedesId`.
- Delta por renglón contra la versión anterior.

**Acción:**
1. Crear rectificativa (G3-09) con motivo y evidencia.
2. Recalcular con nuevo cutoff; no se copian totales.
3. Repetir maker-checker y finalización; la anterior queda SUPERSEDED.

## RB-10 — Sospecha de fuga de tenant

**Síntoma:** un usuario ve datos de otra firma/cliente.

**Diagnóstico:**
- RLS forzada en tablas multi-tenant (G1-01).
- FKs compuestas firmId+clientId.
- Pruebas de aislamiento con `contable_runtime`.

**Acción:**
1. Verificar que el rol runtime NO tiene BYPASSRLS.
2. Reproducir con dos firmas y dos clientes.
3. Revisar auditoría append-only y revocar sesiones si corresponde.

## RB-11 — Restore

**Síntoma:** se necesita recuperar la base o el almacenamiento.

**Diagnóstico:**
- Backups cifrados y restauración ensayada (G6-05).

**Acción:**
1. Restaurar el backup más reciente verificado.
2. Verificar integridad de objetos (checksum).
3. Confirmar que las migraciones aplican desde base vacía.

## RB-12 — Corrida histórica del piloto (G6-02)

**Síntoma:** se necesita ejecutar (o revalidar) los períodos históricos de
control para un cliente piloto.

**Diagnóstico:**
- El script `seed:corrida` materializa 3 períodos consecutivos (Ene–Mar 2026),
  cubiertos por las versiones normativas activas del seed fiscal,
  por cliente con perfil fiscal ACTIVE, aprobando hechos y finalizando cada
  liquidación con maker-checker (V-002).
- Genera `docs/piloto/g6-corrida-historica.md` con totales y hashes.

**Acción:**
1. Inspeccionar primero el alcance sin escribir datos:
   `npm run seed:corrida -w @contable/api -- --dry-run --periodos 1`.
2. Ejecutar la corrida sólo con autorización explícita y, si corresponde,
   limitarla a un cliente:
   `npm run seed:corrida -w @contable/api -- --client-id <id> --periodos 1 --confirm-write`.
3. Comparar cada total del reporte contra la liquidación manual de control
   del contador (tres períodos por régimen deben coincidir o tener diferencia
   explicada).
4. La corrida es idempotente: re-ejecutar reutiliza las liquidaciones FINALIZED
   (no duplica) y sólo completa los faltantes.
5. Si una regla/dato cambió, corregir creando versión nueva y rectificar
   (nunca editar APPROVED/ACTIVE ni FINALIZED).
