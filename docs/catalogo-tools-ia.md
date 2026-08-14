# Catálogo de tools IA — Contable

> Herramientas disponibles para el asistente contable. Allowlisted por modo, rol y contexto.
> **Regla central:** no existen tools de posting, cierre, reapertura, publicación ni presentación fiscal.
> Una tool de propuesta retorna un artefacto efímero; sólo `POST /tool-proposals/{id}/confirm` crea el borrador real, tras volver a comprobar permiso, versión y contexto.

## Modos

| Modo | Tools de lectura | Tools de propuesta |
|---|---|---|
| `READ` | Todas | Ninguna |
| `PROPOSE` | Todas | Todas |

El router determinista clasifica la intención antes de seleccionar tools. Node reautoriza y revalida cada tool call; FastAPI no decide permisos.

## Tools de lectura

| Tool | Descripción | Capacidad requerida | Fuente |
|---|---|---|---|
| `get_client_profile` | Perfil del cliente (identidad, ejercicio, moneda) | `client.read` | Cliente |
| `list_documents` | Documentos del cliente | `client.read` | Documentos |
| `get_document_evidence` | Evidencia de un documento (página, bbox, extraction run) | `client.read` | Documentos |
| `get_trial_balance` | Balance de sumas y saldos | `client.read` | Ledger |
| `get_journal_entries` | Asientos del período | `client.read` | Ledger |
| `get_vat_position` | Posición de IVA | `vat.review` | IVA |
| `get_obligations` | Obligaciones del cliente | `obligation.manage` | Obligaciones |
| `get_close_status` | Estado del cierre | `client.read` | Cierres |
| `run_financial_statement` | Ejecutar un reporte | `report.run` | Reportes |
| `explain_report_line` | Explicar un renglón de reporte | `report.run` | Reportes |
| `get_bank_reconciliation_status` | Estado de conciliación bancaria | `bank.reconcile` | Bancos |

## Tools de propuesta

| Tool | Descripción | Capacidad requerida | Artefacto |
|---|---|---|---|
| `draft_document_request` | Borrador de pedido documental | `request.manage` | `DocumentRequestDraft` |
| `draft_work_item` | Borrador de tarea | `request.manage` | `WorkItemDraft` |
| `draft_reminder` | Borrador de recordatorio | `obligation.manage` | `ReminderDraft` |
| `draft_journal_entry` | Borrador de asiento | `entry.create` | `JournalEntryDraft` |

## Tools prohibidas (no existen)

- `post_journal_entry`
- `close_period`
- `reopen_period`
- `publish_report`
- `finalize_vat`
- `file_tax`
- `execute_sql`
- `run_shell`

## Contrato de tool call

Cada tool call:

- Se revalida en Node: sesión, scope (firma/cliente/período), permisos y argumentos.
- Devuelve IDs/cutoff/versiones; el modelo no aporta cifras canónicas.
- Se registra en `AiToolCall` con herramienta, argumentos redactados, resultado/hash, permiso y estado.
- Los resultados de tools se delimitan como datos no confiables, nunca como instrucciones de sistema.

## Artefactos efímeros

Una tool de propuesta retorna un artefacto con estado `EPHEMERAL`. Sólo `POST /tool-proposals/{id}/confirm` crea el borrador real. `POST /tool-proposals/{id}/reject` lo descarta.

| Artefacto | Confirmación crea |
|---|---|
| `DocumentRequestDraft` | `DocumentRequest` (borrador) |
| `WorkItemDraft` | `WorkItem` (borrador) |
| `ReminderDraft` | `ReminderDispatch` (pendiente) |
| `JournalEntryDraft` | `JournalEntry` (DRAFT) |

## Verificación

- Toda cifra lleva referencia estructurada a consulta, cutoff y filas fuente.
- Antes de enviar, Node compara todos los artefactos numéricos contra el resultado de la herramienta.
- Respuesta `VERIFIED`: todas las cifras y afirmaciones críticas tienen evidencia.
- `PARTIAL`: la respuesta identifica exactamente qué no pudo verificarse.
- `FAILED`: no se publica una explicación especulativa.

## Pendiente de validación

- [ ] Confirmar capacidades requeridas por tool con la matriz de permisos.
- [ ] Confirmar el catálogo de tools con el responsable de dominio.