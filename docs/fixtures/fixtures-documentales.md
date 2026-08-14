# Fixtures documentales — Contable

> Dataset dorado para validar OCR, clasificación y extracción.
> **Estado:** borrador para revisión por responsable contable. No usar como fuente de verdad hasta validación profesional.
> Requisito del plan: mínimo 250 documentos autorizados o sintéticos que cubran todos los tipos; al menos 100 con variabilidad real anonimizada; al menos 20 % con degradaciones controladas.

## Tipos documentales cubiertos

| Tipo | Letra | Dirección | Campos críticos |
|---|---|---|---|
| Factura | A | Compra/Venta | CUIT, fecha, neto, IVA, total, CAE |
| Factura | B | Compra/Venta | CUIT, fecha, neto, IVA (no discriminado), total |
| Factura | C | Compra/Venta | CUIT, fecha, total (sin IVA discriminado) |
| Factura | M | Compra/Venta | CUIT, fecha, neto, IVA, total (monotributo) |
| Nota de crédito | A/B/C/M | Compra/Venta | CUIT, fecha, neto, IVA, total, referencia |
| Nota de débito | A/B/C/M | Compra/Venta | CUIT, fecha, neto, IVA, total, referencia |
| Ticket | — | Compra | CUIT, fecha, total |
| Recibo | — | Compra/Venta | CUIT, fecha, importe, concepto |
| Pago/Cobro | — | Compra/Venta | CUIT, fecha, importe, medio |
| Extracto bancario | — | — | Cuenta, rango, saldos, movimientos |

## Estructura de cada caso

Cada caso documental incluye:

- `id` estable
- `tipo`, `letra`, `direccion`
- `archivo` (PDF/imagen)
- `ground_truth` por campo (valor esperado)
- `ground_truth_items` por ítem cuando aplique
- `bounding_box` por campo cuando aplique
- `degradacion` (ninguna, rotado, borroso, recortado, sombra, baja resolución, escaneado)
- `duplicado` (binario/fiscal/ninguno)
- `complejidad` (simple/media/alta)

## Casos de ejemplo

### DOC-001 — Factura A de compra (digital)

- **Tipo:** Factura A, compra
- **Archivo:** PDF digital
- **Degradación:** ninguna
- **Ground truth:**
  - CUIT emisor: 30-12345678-9
  - Fecha: 2026-03-15
  - Neto: 100.000,00
  - IVA 21%: 21.000,00
  - Total: 121.000,00
  - CAE: 12345678901234
- **Ítems:** 1 (Bienes de uso, 100.000,00)

### DOC-002 — Factura A de compra (escaneada)

- **Tipo:** Factura A, compra
- **Archivo:** PDF escaneado (imagen)
- **Degradación:** escaneado, leve rotación
- **Ground truth:** igual a DOC-001 pero con bounding boxes por campo
- **Nota:** debe pasar por OCR local antes de visión

### DOC-003 — Factura B de venta (digital)

- **Tipo:** Factura B, venta
- **Archivo:** PDF digital
- **Degradación:** ninguna
- **Ground truth:**
  - CUIT emisor: 30-12345678-9
  - Fecha: 2026-04-10
  - Total: 242.000,00 (IVA no discriminado)
- **Ítems:** 1 (Servicio, 242.000,00)

### DOC-004 — Nota de crédito A de compra

- **Tipo:** Nota de crédito A, compra
- **Archivo:** PDF digital
- **Degradación:** ninguna
- **Ground truth:**
  - CUIT emisor: 30-12345678-9
  - Fecha: 2026-04-20
  - Neto: 10.000,00
  - IVA 21%: 2.100,00
  - Total: 12.100,00
  - Referencia: factura original

### DOC-005 — Ticket de compra

- **Tipo:** Ticket, compra
- **Archivo:** imagen JPEG
- **Degradación:** borroso
- **Ground truth:**
  - CUIT emisor: 30-12345678-9
  - Fecha: 2026-05-01
  - Total: 5.000,00

### DOC-006 — Extracto bancario

- **Tipo:** Extracto bancario
- **Archivo:** PDF digital
- **Degradación:** ninguna
- **Ground truth:**
  - Cuenta: Banco X, CBU enmascarado
  - Rango: 2026-05-01 a 2026-05-31
  - Saldo inicial: 500.000,00
  - Saldo final: 620.000,00
  - Movimientos: 10 (con fecha valor, importe, descripción)

### DOC-007 — Factura A con total inconsistente

- **Tipo:** Factura A, compra
- **Archivo:** PDF digital
- **Degradación:** ninguna
- **Ground truth:** neto 100.000,00 + IVA 21.000,00, pero total impreso 120.000,00
- **Nota:** el campo total debe quedar `CONFLICT`; no se aprueba sin resolución

### DOC-008 — Duplicado binario

- **Tipo:** Factura A, compra
- **Archivo:** PDF digital (mismo SHA-256 que DOC-001)
- **Degradación:** ninguna
- **Nota:** debe marcarse `EXACT_DUPLICATE`

### DOC-009 — Duplicado fiscal

- **Tipo:** Factura A, compra
- **Archivo:** PDF digital (mismo emisor, tipo, punto de venta y número que DOC-001, distinto archivo)
- **Degradación:** ninguna
- **Nota:** debe marcarse `POSSIBLE_DUPLICATE` y exigir decisión documentada

### DOC-010 — Factura A con QR

- **Tipo:** Factura A, compra
- **Archivo:** PDF digital con QR fiscal
- **Degradación:** ninguna
- **Ground truth:** igual a DOC-001
- **Nota:** el QR debe parsearse y validarse determinísticamente antes de OCR/visión

## Distribución objetivo

| Segmento | Cantidad | Notas |
|---|---|---|
| Facturas A/B/C/M | 120 | 30 por letra, mezcla compra/venta |
| Notas de crédito/débito | 40 | 20 por tipo |
| Tickets | 30 | |
| Recibos y pagos/cobros | 30 | |
| Extractos bancarios | 30 | |
| **Total** | **250** | |

| Degradación | % |
|---|---|
| Ninguna | 40 % |
| Escaneado | 20 % |
| Rotado/borroso/recortado/sombra/baja resolución | 20 % |
| Con QR | 20 % |

## Pendiente de validación profesional

- [ ] Confirmar que los CUIT de ejemplo son sintéticos y no corresponden a entidades reales.
- [ ] Confirmar que los montos y cálculos de IVA son correctos.
- [ ] Confirmar la distribución de tipos y degradaciones.
- [ ] Confirmar el proceso de anonimización para documentos reales (preservar estructura, nunca copiar sin autorización).