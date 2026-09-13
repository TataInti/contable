# Schemas de extracción — Contable

> Definición de los campos permitidos por tipo documental, validaciones, normalizadores y versión.
> El modelo no puede devolver propiedades arbitrarias. Cada schema es versionado.
> **Estado:** borrador técnico; los cálculos de IVA y montos requieren validación profesional.

## Convenciones

- `schemaVersion`: identificador estable (ej. `voucher-ar-v1`).
- Cada campo tiene: clave semántica, tipo, requerido, validación, normalizador y método de extracción preferido.
- Métodos: `QR | EMBEDDED_TEXT | OCR | VISION | HUMAN`.
- Precedencia de extracción: metadatos → QR → texto embebido → OCR → visión → corrección humana.
- Cuando dos fuentes discrepan, el campo queda `CONFLICT`; no se elige silenciosamente la de mayor confianza.

## Tipos de campo

| Tipo | Descripción |
|---|---|
| `cuit` | 11 dígitos con dígito verificador válido |
| `date` | Fecha sin zona horaria (`YYYY-MM-DD`) |
| `money` | Importe decimal (`NUMERIC(20,4)`) |
| `rate` | Tipo de cambio/coeficiente (`NUMERIC(20,8)`) |
| `string` | Texto normalizado |
| `enum` | Valor de catálogo versionado |
| `int` | Entero (punto de venta, número) |
| `bool` | Booleano |

## Schema `voucher-ar-v1` — Comprobante argentino

Aplica a facturas y notas A/B/C/M, tickets, recibos y pagos/cobros.

### Identificación

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `documentType` | enum | sí | catálogo versionado | alias → tipo canónico | QR/OCR/VISION |
| `letter` | enum | sí | A/B/C/M | mayúsculas | QR/OCR/VISION |
| `direction` | enum | sí | PURCHASE/SALE/NEUTRAL | según tipo | QR/OCR/VISION |
| `pointOfSale` | int | sí | 1–99999 | padding para comparación | QR/OCR/VISION |
| `number` | int | sí | 1–99999999 | padding para comparación | QR/OCR/VISION |
| `emitterCuit` | cuit | sí | dígito verificador | 11 dígitos | QR/OCR/VISION |
| `receiverCuit` | cuit | condicional | dígito verificador | 11 dígitos | QR/OCR/VISION |
| `emitterName` | string | sí | — | trim, normalizar | OCR/VISION |
| `receiverName` | string | condicional | — | trim, normalizar | OCR/VISION |

### Fechas

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `issueDate` | date | sí | coherencia emisión/vencimiento | sin zona | QR/OCR/VISION |
| `dueDate` | date | no | ≥ issueDate | sin zona | OCR/VISION |
| `serviceDate` | date | no | — | sin zona | OCR/VISION |

### Moneda e importes

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `currency` | enum | sí | ISO 4217 + alias | alias → código | OCR/VISION |
| `exchangeRate` | rate | condicional | > 0 si moneda ≠ ARS | decimal | OCR/VISION |
| `netAmount` | money | condicional | recomputación con tolerancia | decimal | OCR/VISION |
| `vatAmount` | money | condicional | recomputación con tolerancia | decimal | OCR/VISION |
| `totalAmount` | money | sí | = neto + IVA ± tolerancia | decimal | QR/OCR/VISION |
| `exemptAmount` | money | no | — | decimal | OCR/VISION |
| `notTaxedAmount` | money | no | — | decimal | OCR/VISION |

### Impuestos

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `vatRate` | enum | condicional | catálogo por vigencia | alícuota → categoría | OCR/VISION |
| `perceptions` | array | no | — | ítems | OCR/VISION |
| `withholdings` | array | no | — | ítems | OCR/VISION |

### CAE/CAI

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `cae` | string | condicional | formato y vencimiento | dígitos | QR/OCR/VISION |
| `caeDueDate` | date | condicional | — | sin zona | QR/OCR/VISION |
| `cai` | string | condicional | formato | dígitos | OCR/VISION |

### Ítems

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `items` | array | no | — | ítems | OCR/VISION |

Cada ítem:

| Clave | Tipo | Requerido | Validación | Normalizador |
|---|---|---|---|---|
| `description` | string | sí | — | trim |
| `quantity` | decimal | no | > 0 | decimal |
| `unitPrice` | money | no | — | decimal |
| `netAmount` | money | no | — | decimal |
| `vatRate` | enum | no | catálogo | alícuota → categoría |
| `vatAmount` | money | no | — | decimal |
| `totalAmount` | money | no | — | decimal |

### QR

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `qrPayload` | string | no | URL/payload contra esquema conocido | parse | QR |
| `qrValid` | bool | no | — | — | QR |

## Schema `bank-statement-ar-v1` — Extracto bancario

| Clave | Tipo | Requerido | Validación | Normalizador | Método |
|---|---|---|---|---|---|
| `bankName` | string | sí | — | trim | OCR/VISION |
| `accountNumber` | string | sí | — | enmascarar | OCR/VISION |
| `cbu` | string | condicional | formato | enmascarar | OCR/VISION |
| `periodStart` | date | sí | — | sin zona | OCR/VISION |
| `periodEnd` | date | sí | ≥ periodStart | sin zona | OCR/VISION |
| `openingBalance` | money | sí | — | decimal | OCR/VISION |
| `closingBalance` | money | sí | = opening + movimientos | decimal | OCR/VISION |
| `transactions` | array | sí | — | ítems | OCR/VISION |

Cada transacción:

| Clave | Tipo | Requerido | Validación | Normalizador |
|---|---|---|---|---|
| `operationDate` | date | sí | — | sin zona |
| `valueDate` | date | no | — | sin zona |
| `amount` | money | sí | ≠ 0 | decimal |
| `currency` | enum | sí | ISO 4217 | alias → código |
| `description` | string | sí | — | trim |
| `reference` | string | no | — | trim |
| `externalId` | string | no | — | trim |

## Validaciones transversales

- **CUIT:** sólo 11 dígitos y dígito verificador válido; no inventar dígitos.
- **Fecha:** normalización sin zona y coherencia emisión/vencimiento.
- **Tipo y letra:** catálogo versionado.
- **Punto de venta/número:** padding para comparación, conservación del bruto.
- **Moneda:** ISO 4217 y alias conocidos.
- **Alícuotas IVA:** catálogo por vigencia.
- **Totales:** recomputación con tolerancia de redondeo configurada.
- **Nota de crédito/débito:** signo/dirección normalizados sin perder importes impresos.
- **CAE:** formato y vencimiento cuando exista.
- **QR:** URL y payload validados contra esquema conocido; un QR no otorga autenticidad jurídica por sí solo.

## Pendiente de validación profesional

- [ ] Confirmar catálogo de alícuotas IVA por vigencia.
- [ ] Confirmar tolerancia de redondeo para recomputación de totales.
- [ ] Confirmar tratamiento de notas de crédito/débito (signo/dirección).
- [ ] Confirmar campos requeridos por tipo documental (A/B/C/M, ticket, recibo).