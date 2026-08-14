# Fixtures contables y fiscales — Contable

> Dataset dorado para validar el motor contable y fiscal.
> **Estado:** borrador para revisión por responsable contable. No usar como fuente de verdad hasta validación profesional.
> Formato: escenarios con datos sintéticos y resultado esperado.

## Convenciones

- Moneda funcional: ARS.
- Importes en `NUMERIC(20,4)`; tipo de cambio en `NUMERIC(20,8)`.
- Fechas sin zona horaria (`YYYY-MM-DD`).
- Los asientos deben balancear en moneda funcional.

## 1. Apertura de ejercicio

### Escenario A-01 — Apertura balanceada

**Given** un cliente con ejercicio 2026-01-01 a 2026-12-31 y saldos iniciales:

| Cuenta | Código | Tipo | Naturaleza | Saldo |
|---|---|---|---|---|
| Caja | 1.1.1 | ASSET | DEBIT | 100.000,00 |
| Banco | 1.1.2 | ASSET | DEBIT | 500.000,00 |
| Proveedores | 2.1.1 | LIABILITY | CREDIT | 200.000,00 |
| Capital | 3.1.1 | EQUITY | CREDIT | 400.000,00 |

**When** se importa como asiento `OPENING` de apertura

**Then** el asiento balancea: débitos = 600.000,00; créditos = 600.000,00

### Escenario A-02 — Apertura desbalanceada

**Given** los mismos saldos pero Capital = 300.000,00 (débitos 600.000,00 ≠ créditos 500.000,00)

**When** se importa

**Then** el asiento no se crea; se devuelve error `UNBALANCED_ENTRY` y no se escribe nada

## 2. Compra de bienes de uso

### Escenario C-01 — Compra con IVA

**Given** una factura A de compra:

- Emisor: proveedor con CUIT válido
- Fecha: 2026-03-15
- Neto: 100.000,00
- IVA 21%: 21.000,00
- Total: 121.000,00

**When** se genera la propuesta de asiento

**Then** el asiento propuesto es:

| Cuenta | Débito | Crédito |
|---|---|---|
| Bienes de uso | 100.000,00 | |
| IVA crédito fiscal | 21.000,00 | |
| Proveedores | | 121.000,00 |

**And** balancea: débitos = créditos = 121.000,00

### Escenario C-02 — Total inconsistente

**Given** la misma factura pero el total impreso es 120.000,00 (≠ neto + IVA)

**When** se valida

**Then** el campo total queda `CONFLICT` y no se aprueba sin resolución

## 3. Venta con IVA

### Escenario V-01 — Venta con IVA

**Given** una factura A de venta:

- Fecha: 2026-04-10
- Neto: 200.000,00
- IVA 21%: 42.000,00
- Total: 242.000,00

**When** se genera la propuesta de asiento

**Then** el asiento propuesto es:

| Cuenta | Débito | Crédito |
|---|---|---|
| Deudores por ventas | 242.000,00 | |
| Ventas | | 200.000,00 |
| IVA débito fiscal | | 42.000,00 |

**And** balancea: débitos = créditos = 242.000,00

## 4. Nota de crédito

### Escenario NC-01 — Nota de crédito de compra

**Given** una nota de crédito A de compra por 10.000,00 neto + 2.100,00 IVA (total 12.100,00)

**When** se genera la propuesta de asiento

**Then** el asiento propuesto es:

| Cuenta | Débito | Crédito |
|---|---|---|
| Proveedores | 12.100,00 | |
| Bienes de uso | | 10.000,00 |
| IVA crédito fiscal | | 2.100,00 |

**And** balancea

## 5. Moneda extranjera

### Escenario FX-01 — Compra en USD

**Given** una factura de compra en USD:

- Importe original: 1.000,00 USD
- Tipo de cambio: 1.200,00000000 ARS/USD
- Importe funcional: 1.200.000,00 ARS

**When** se genera la propuesta de asiento

**Then** el asiento propuesto es:

| Cuenta | Débito (ARS) | Crédito (ARS) |
|---|---|---|
| Mercaderías | 1.200.000,00 | |
| Proveedores | | 1.200.000,00 |

**And** el funcional = original × tasa dentro de la política de redondeo

### Escenario FX-02 — Tasa faltante

**Given** la misma compra sin tipo de cambio

**When** se valida

**Then** se devuelve error `EXCHANGE_RATE_REQUIRED`

## 6. IVA — posición mensual

### Escenario IVA-01 — Posición simple

**Given** un mes con:

- Débito fiscal: 42.000,00
- Crédito fiscal: 21.000,00

**When** se calcula la liquidación

**Then** la posición es: a favor del fisco = 21.000,00 (42.000,00 − 21.000,00)

### Escenario IVA-02 — Con retenciones y percepciones

**Given** un mes con:

- Débito fiscal: 50.000,00
- Crédito fiscal: 30.000,00
- Percepciones a favor: 5.000,00
- Retenciones sufridas: 3.000,00

**When** se calcula la liquidación

**Then** la posición es: a favor del fisco = 12.000,00 (50.000,00 − 30.000,00 − 5.000,00 − 3.000,00)

### Escenario IVA-03 — Conciliación con mayor

**Given** una liquidación calculada y las cuentas IVA del mayor

**When** se compara

**Then** toda diferencia muestra detalle y origen; no se finaliza con diferencias sin justificar

## 7. Reversión

### Escenario R-01 — Reversión de asiento

**Given** un asiento `POSTED` de compra (débito Bienes de uso 100.000, IVA 21.000; crédito Proveedores 121.000)

**When** se crea y postea una reversión

**Then** el asiento de reversión es:

| Cuenta | Débito | Crédito |
|---|---|---|
| Proveedores | 121.000,00 | |
| Bienes de uso | | 100.000,00 |
| IVA crédito fiscal | | 21.000,00 |

**And** el original permanece `POSTED` y el mayor muestra ambos

## 8. Cierre de período

### Escenario P-01 — Cierre suave

**Given** un período `OPEN` con asientos posteados

**When** se ejecuta `soft-close`

**Then** el período pasa a `SOFT_CLOSED`; el posting requiere excepción de reviewer/admin

### Escenario P-02 — Cierre duro

**Given** un período `SOFT_CLOSED`

**When** se ejecuta `hard-close`

**Then** el período pasa a `HARD_CLOSED`; bloquea cualquier escritura contable ordinaria

### Escenario P-03 — Reapertura

**Given** un período `HARD_CLOSED`

**When** se ejecuta `reopen` con rol autorizado y motivo

**Then** el período pasa a `OPEN` (o `SOFT_CLOSED` según política), se crea evento de auditoría y se invalida el cierre anterior

## 9. Reportes

### Escenario REP-01 — Situación patrimonial

**Given** un cliente con asientos posteados

**When** se ejecuta el reporte de situación patrimonial

**Then** Activo = Pasivo + Patrimonio Neto según clasificación aplicable

### Escenario REP-02 — Resultados

**Given** un cliente con ingresos y gastos posteados

**When** se ejecuta el reporte de resultados

**Then** Resultado = Ingresos − Gastos

## 10. Inflación

### Escenario INF-01 — Ajuste por inflación

**Given** una serie de índices mensuales y cuentas clasificadas monetarias/no monetarias

**When** se ejecuta un run de inflación

**Then** se produce un worksheet nominal/reexpresado y un asiento borrador; no modifica el ledger antes del posting

### Escenario INF-02 — Reproducible

**Given** un run con `indexVersion + policyVersion + ledgerCutoff`

**When** se reejecuta

**Then** produce el mismo resultado

## 11. Bancos

### Escenario B-01 — Conciliación

**Given** un extracto con saldo inicial 500.000,00, movimientos y saldo final

**When** se importa y concilia

**Then** saldo inicial + movimientos = saldo final dentro de tolerancia cero para misma moneda

### Escenario B-02 — Dedupe

**Given** un extracto con un movimiento duplicado

**When** se importa

**Then** se deduplica por `externalId` o hash; no se crea un segundo movimiento

## 12. Casos límite

### Escenario L-01 — Línea en cero

**Given** un asiento con una línea donde débito = crédito = 0

**When** se valida

**Then** se devuelve error `ZERO_LINE`

### Escenario L-02 — Débito y crédito simultáneos

**Given** una línea con débito > 0 y crédito > 0

**When** se valida

**Then** se devuelve error `AMBIGUOUS_LINE`

### Escenario L-03 — Importe negativo

**Given** una línea con débito o crédito negativo

**When** se valida

**Then** se devuelve error `NEGATIVE_AMOUNT`

### Escenario L-04 — Cuenta de otro cliente

**Given** una línea que referencia una cuenta de otro cliente

**When** se valida

**Then** se devuelve error `ACCOUNT_TENANT_MISMATCH`

### Escenario L-05 — Fecha fuera del ejercicio

**Given** un asiento con `entryDate` fuera del rango del ejercicio

**When** se valida

**Then** se devuelve error `DATE_OUT_OF_FISCAL_YEAR`

## Pendiente de validación profesional

- [ ] Confirmar códigos de cuenta y jerarquía del plan de cuentas.
- [ ] Confirmar tratamiento de percepciones/retenciones en la posición IVA.
- [ ] Confirmar política de redondeo para moneda extranjera.
- [ ] Confirmar clasificación monetaria/no monetaria para inflación.
- [ ] Confirmar criterio de cierre suave/duro y reapertura.
- [ ] Confirmar mapeo de reportes (situación patrimonial y resultados).