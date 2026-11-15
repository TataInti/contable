# Matriz de permisos — Contable

> Matriz rol × capacidad × cliente asignado. Las capacidades se calculan server-side; la UI sólo las usa para ocultar/deshabilitar acciones.
> Owner/admin ven toda la firma; preparadores, revisores y auditores sólo clientes asignados.

## Roles

| Rol | Alcance | Notas |
|---|---|---|
| `OWNER` | Toda la firma | Puede actuar como preparador o revisor, pero no ambos en el mismo objeto. |
| `ADMIN` | Toda la firma | Igual que owner para capacidades operativas; sin transferencia de ownership. |
| `PREPARER` | Clientes asignados | Prepara documentos, asientos, liquidaciones. |
| `REVIEWER` | Clientes asignados | Revisa y aprueba; no prepara en el mismo objeto. |
| `AUDITOR_READONLY` | Clientes asignados | Lectura y auditoría; sin mutaciones. |

## Capacidades

### Firma y auditoría

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `firm.manage` | ✓ | ✓ | | | |
| `firm.users.manage` | ✓ | ✓ | | | |
| `firm.audit.read` | ✓ | ✓ | | | ✓ |

`platform.modules.manage` no pertenece a ningún rol de firma: sólo la recibe una sesión de administración general (`User.isPlatformAdmin`).

### Clientes

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `client.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `client.manage` | ✓ | ✓ | | | |
| `client.assign` | ✓ | ✓ | | | |

### Documentos

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `document.upload` | ✓ | ✓ | ✓ | ✓ | |
| `document.prepare` | ✓ | ✓ | ✓ | | |
| `document.review` | ✓ | ✓ | | ✓ | |

### Asientos

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `entry.create` | ✓ | ✓ | ✓ | | |
| `entry.submit` | ✓ | ✓ | ✓ | | |
| `entry.review` | ✓ | ✓ | | ✓ | |
| `entry.post` | ✓ | ✓ | | ✓ | |
| `entry.reverse` | ✓ | ✓ | | ✓ | |

### Períodos

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `period.soft_close` | ✓ | ✓ | | ✓ | |
| `period.hard_close` | ✓ | ✓ | | ✓ | |
| `period.reopen` | ✓ | ✓ | | | |

### Bancos

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `bank.import` | ✓ | ✓ | ✓ | | |
| `bank.reconcile` | ✓ | ✓ | | ✓ | |

### IVA

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `vat.calculate` | ✓ | ✓ | ✓ | | |
| `vat.review` | ✓ | ✓ | | ✓ | |
| `vat.finalize` | ✓ | ✓ | | ✓ | |

### Reportes

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `report.configure` | ✓ | ✓ | | | |
| `report.run` | ✓ | ✓ | ✓ | ✓ | |
| `report.review` | ✓ | ✓ | | ✓ | |
| `report.publish` | ✓ | ✓ | | ✓ | |

### Obligaciones y trabajo

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `obligation.manage` | ✓ | ✓ | ✓ | ✓ | |
| `request.manage` | ✓ | ✓ | ✓ | ✓ | |
| `message.internal` | ✓ | ✓ | ✓ | ✓ | |
| `message.shared` | ✓ | ✓ | ✓ | ✓ | |

### IA

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `ai.use` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `bi.use` | ✓ | ✓ | ✓ | ✓ | ✓ |

### Perfil fiscal (Puerta 1)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `tax.profile.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tax.profile.write` | ✓ | ✓ | ✓ | | |

### Reglas fiscales (Puerta 1)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `tax.rules.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tax.rules.propose` | ✓ | ✓ | | | |
| `tax.rules.approve` | ✓ | ✓ | | | |
| `tax.rules.activate` | ✓ | ✓ | | | |

### Calendarios fiscales (corte 2a-i)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `tax.calendars.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tax.calendars.manage` | ✓ | ✓ | ✓ | — | — |
| `tax.calendars.publish` | ✓ | ✓ | — | — | — |

Crear, editar en borrador, dar de baja una celda de un borrador, validar, versionar («crear a partir de este»), ocultar y mostrar requieren `tax.calendars.manage`. La baja solo se acepta en borradores: sobre una versión publicada u oculta responde 409 y la corrección es una versión nueva. Publicar requiere `tax.calendars.publish`, sin revisor distinto. Las rutas viven bajo `/api/v1/firms/:firmId/tax-calendars`; cada una tiene capacidad declarada en el guard (una ruta sin capacidad responde 404).

### Comprobantes e ingesta (Puerta 2)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `tax.vouchers.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tax.vouchers.prepare` | ✓ | ✓ | ✓ | | |
| `tax.vouchers.review` | ✓ | ✓ | | ✓ | |

### Liquidaciones (Puerta 3)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `tax.settlements.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tax.settlements.calculate` | ✓ | ✓ | ✓ | | |
| `tax.settlements.submit_review` | ✓ | ✓ | ✓ | | |
| `tax.settlements.review` | ✓ | ✓ | | ✓ | |
| `tax.settlements.finalize` | ✓ | ✓ | | ✓ | |
| `tax.settlements.rectify` | ✓ | ✓ | | ✓ | |
| `tax.settlements.export` | ✓ | ✓ | ✓ | ✓ | |

### Presentación y pagos (Puerta 3)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `tax.filings.record` | ✓ | ✓ | | ✓ | |
| `tax.payments.record` | ✓ | ✓ | | ✓ | |

### Gastos gerenciales (Puerta 2)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `tax.management_expenses.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `tax.management_expenses.write` | ✓ | ✓ | ✓ | | |
| `tax.management_expenses.approve_treatment` | ✓ | ✓ | | ✓ | |

### Rentabilidad (Puerta 5)

| Capacidad | OWNER | ADMIN | PREPARER | REVIEWER | AUDITOR_READONLY |
|---|---|---|---|---|---|
| `profitability.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `profitability.calculate` | ✓ | ✓ | ✓ | ✓ | |
| `profitability.publish` | ✓ | ✓ | | ✓ | |

## Reglas transversales

1. **Maker-checker:** `preparedByUserId` y `reviewedByUserId` deben ser distintos. Owner/admin pueden actuar como preparador o revisor, pero no ambos en el mismo objeto.
2. **Alcance:** Owner/admin ven toda la firma; preparadores, revisores y auditores sólo clientes asignados (`ClientAssignment`).
3. **Portal:** roles `CLIENT_ADMIN | CLIENT_CONTRIBUTOR | CLIENT_READONLY`; sólo lectura de lo publicado/compartido, carga de documentación y mensajes compartidos. Nunca muta contabilidad.
4. **Respuestas:** `404` para recurso no visible; `403` para acción no permitida sobre recurso visible.
5. **Rechazo de revisión:** devuelve el objeto a preparación con comentario obligatorio.
6. **Cambio posterior a revisión:** invalida la aprobación y crea una nueva versión.

## Notas de implementación

- La matriz se codifica en `packages/permissions` y se testea contra fixtures de dos estudios, múltiples clientes y roles mezclados.
- Las capacidades se resuelven server-side; la UI no decide autorización.
- RLS es la segunda barrera; la matriz es la primera.
