# Glosario de dominio — Contable

> Fuente de verdad terminológica para la implementación. Congelado en Fase 0.
> Cualquier término nuevo se agrega aquí antes de usarse en código, contratos o UI.

## Documentos y extracción

| Término | Definición |
|---|---|
| **Documento** | Entidad que representa un archivo cargado por el estudio o el portal, con su ciclo de vida (cuarentena → original → extracción → revisión). No es el archivo físico ni la extracción. |
| **Archivo** | Objeto binario (PDF, JPEG, PNG, WEBP, HEIC) con versión, checksum SHA-256 y estado antivirus. El original es inmutable. |
| **Extracción** | Resultado estructurado de procesar un archivo: clasificación, campos, ítems, evidencia, confianza y validaciones. Versionada; nunca se edita la anterior. |
| **Voucher** | Comprobante aprobado (factura, nota, ticket, recibo, etc.) separado del archivo y de la extracción. Es la base de hechos fiscales. |
| **Propuesta** | Artefacto efímero generado por IA o reglas (asiento, pedido, tarea, recordatorio). No crea nada hasta confirmación explícita. |
| **Campo extraído** | Valor semántico (CUIT, fecha, total, alícuota) con valor bruto/normalizado, confianza, página, bounding box, método y estado. |
| **Ítem** | Línea de detalle de un comprobante (producto/servicio, cantidad, precio, IVA). |
| **Confianza** | Probabilidad calibrada de que un valor extraído sea correcto. Nunca se muestra sólo con color. |
| **Evidencia** | Referencia estructurada a la fuente de un valor: página, bounding box, extraction run, asiento, línea o report run. |

## Contabilidad

| Término | Definición |
|---|---|
| **Asiento** | Registro de doble partida con líneas de débito/crédito que balancean. Tiene estado y ciclo de revisión. |
| **Línea** | Componente de un asiento: cuenta, importe original/funcional, moneda, tipo de cambio, centro de costo, contraparte. |
| **Posting** | Transición determinista que contabiliza un asiento `REVIEWED` → `POSTED`, asigna secuencia y lo vuelve inmutable. |
| **Reversión** | Asiento que anula otro contabilizado. El original permanece inmutable; se crea un nuevo asiento. |
| **Período** | Unidad de tiempo contable (mes) dentro de un ejercicio. Estados: `OPEN`, `SOFT_CLOSED`, `HARD_CLOSED`. |
| **Ejercicio** | Año fiscal del cliente. Estados: `OPEN`, `CLOSING`, `CLOSED`. |
| **Cierre** | Transición que bloquea escrituras según nivel (suave/duro). Reabrir exige rol, motivo y auditoría. |
| **Saldos** | Agregados derivados de líneas `POSTED`. Siempre reconstruibles desde el ledger. |
| **Ledger** | Conjunto de asientos contabilizados; fuente de verdad de saldos y reportes. |
| **Plan de cuentas** | Jerarquía de cuentas con código, tipo, naturaleza, imputabilidad y comportamiento de moneda. |
| **Contraparte** | Tercero (proveedor/cliente) con CUIT y condición fiscal. El CUIT nunca se completa desde memoria de IA. |

## Impuestos y obligaciones

| Término | Definición |
|---|---|
| **Liquidación IVA** | Cálculo de posición de IVA (débito, crédito, retenciones, percepciones) desde vouchers y ajustes. Versionada e inmutable al finalizar. |
| **Obligación** | Instancia concreta de un impuesto/regla para un cliente y período, con vencimiento, responsable y estado. |
| **Regla** | Configuración versionada con fuente, vigencia y responsable de validación. |
| **Vencimiento** | Fecha calculada desde regla, feriados y terminación de CUIT; puede tener override justificado. |

## Reportes y publicación

| Término | Definición |
|---|---|
| **Run** | Ejecución congelada de un reporte con versiones, cutoff y hash del ledger. |
| **Snapshot** | Resultado de un run listo para revisión/publicación. Inmutable una vez publicado. |
| **Publicación** | Snapshot compartido al portal con destinatarios y versión. Los borradores nunca aparecen en el portal. |
| **Cutoff** | Punto de corte del ledger que define qué asientos entran en un cálculo. |

## Trabajo y portal

| Término | Definición |
|---|---|
| **Ciclo de cierre** | Proceso de cierre mensual/anual con checklist, dependencias y responsables. |
| **Pedido documental** | Solicitud al cliente de documentación con ítems, fecha límite y estados. |
| **Tarea** | Ítem de trabajo con responsable, prioridad y relación opcional a cierre/obligación/documento. |
| **Mensaje interno** | Comunicación visible sólo al estudio. |
| **Mensaje compartido** | Comunicación visible también al portal. Una nota interna nunca cambia a compartida sin confirmación y auditoría. |

## IA y BI

| Término | Definición |
|---|---|
| **Turno** | Una interacción usuario→asistente con contexto firma/cliente/período explícito. |
| **Context grant** | Recursos autorizados para un turno concreto. |
| **Evidencia IA** | Fuente recuperada vs. citada; se guardan por separado. |
| **Plan BI** | Contrato semántico `BiQueryPlanV1` que el planner propone y Node valida/ejecuta. |
| **Widget** | Artefacto visual (KPI, línea, barra, dona, tabla, comparación) con plan, versión, cutoff y fuente. |
| **Abstención** | Respuesta del asistente cuando faltan datos o permiso; no se publica una explicación especulativa. |

## Identidad y tenancy

| Término | Definición |
|---|---|
| **Firma** | Estudio contable; raíz de tenancy. |
| **Cliente** | Empresa del estudio; siempre dentro de una firma. |
| **Membresía** | Relación usuario↔firma con rol. |
| **Asignación** | Relación usuario↔cliente con capacidades. |
| **Membresía portal** | Relación usuario↔cliente con rol de portal. |
| **Capacidad** | Permiso calculado server-side (ej. `entry.post`, `vat.finalize`). |
| **Maker-checker** | Regla que exige preparador y revisor distintos para acciones sensibles. |