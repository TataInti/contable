# Flujograma del Expediente Mensual — Acciones y botones por etapa

> **Propósito:** explicar, de forma visual y paso a paso, el flujo de trabajo de la interfaz web al entrar al **Expediente mensual** (`/expediente-mensual`). Describe las **6 etapas** del stepper persistente, las **acciones** disponibles en cada una y los **botones** que las disparan, para que preparador y revisor entiendan qué hacer y en qué orden.
>
> La vista usa un **stepper persistente** (no un wizard que oculta información): las 6 etapas están siempre visibles y se puede saltar entre ellas libremente. El estado del expediente (badge) y los controles bloqueantes determinan qué botones están habilitados.

---

## 0. Antes de empezar: crear el expediente

Al entrar a `/expediente-mensual` con un cliente y período activos, la pantalla muestra:

- **Botón "Subir Excel"** (cabecera): abre el modal para importar los libros IVA (ventas/compras) desde Excel. Disponible con capacidad `tax.vouchers.prepare`.
- **Botón "Nuevo expediente"** (cabecera): crea el expediente mensual del período. Disponible con `tax.settlements.calculate`.
- Si **no hay expedientes** para el período, se muestra un estado vacío con el botón **"Crear expediente"**.

> El expediente nace en estado `DRAFT`. A partir de ahí se recorre el stepper.

```mermaid
flowchart TD
    A[Entrar a /expediente-mensual<br/>cliente + período activos] --> B{¿Hay expediente?}
    B -- No --> C[Estado vacío<br/>Botón: Crear expediente]
    B -- Sí --> D[Card del expediente<br/>badge de estado + stepper 6 etapas]
    C --> D
    D --> E[Botón cabecera: Subir Excel<br/>modal libros IVA]
    D --> F[Botón cabecera: Nuevo expediente]
```

---

## 1. Las 6 etapas del stepper

El stepper persistente tiene 6 etapas. Cada una tiene un **menú de pestañas** (clic directo) y botones **Anterior / Siguiente** para moverse en orden.

| # | Etapa | Descripción |
|---|---|---|
| 1 | **Saldos** | Arrastres, créditos y saldos iniciales antes de calcular |
| 2 | **Fuentes** | Documentación y componentes requeridos para sostener el cálculo |
| 3 | **Clasificación** | Actividades, criterios y configuración que determinan alícuotas |
| 4 | **Cálculo** | Posición fiscal, pagos, presentaciones e intereses del período |
| 5 | **Controles** | Hallazgos, bloqueos y resoluciones antes de cerrar |
| 6 | **Cierre** | Hashes, finalización y arrastre al siguiente período |

```mermaid
flowchart LR
    S1[Saldos] --> S2[Fuentes] --> S3[Clasificación] --> S4[Cálculo] --> S5[Controles] --> S6[Cierre]
```

> **Navegación común a todas las etapas:** menú de pestañas (1–6), botón **"Anterior: <etapa>"**, botón **"Siguiente: <etapa>"**, y en el pie **"Volver a <etapa>"** / **"Ir a <etapa>"**.

---

## 2. Etapa 1 — Saldos

**Objetivo:** registrar y revisar los saldos a favor y arrastres disponibles por impuesto, régimen y jurisdicción.

```mermaid
flowchart TD
    A[Etapa 1 · Saldos] --> B[Tabla de saldos a favor<br/>original · disponible · movimientos · respaldo]
    B --> C[Botón: Actualizar]
    B --> D[Botón: Cargar saldo inicial<br/>requiere tax.settlements.calculate]
    D --> E[Modal: Cargar saldo inicial]
    E --> E1[Impuesto]
    E --> E2[Período fiscal]
    E --> E3[Régimen opcional]
    E --> E4[Naturaleza: saldo a favor / IVA técnico / IVA libre]
    E --> E5[Importe]
    E --> E6[Documento de respaldo<br/>opcional en carga manual]
    E --> F[Botón: Registrar saldo]
    F --> G[Se crea lote de crédito<br/>se registra el usuario que lo cargó]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Refrescar la tabla de saldos | **Actualizar** | Siempre |
| Abrir el formulario de carga | **Cargar saldo inicial** | `tax.settlements.calculate` |
| Confirmar la carga | **Registrar saldo** | Impuesto + período + importe completos |
| Cancelar la carga | **Cancelar** | — |

> **Carga manual:** el saldo inicial puede ingresarse manualmente **sin** adjuntar un comprobante. El sistema conserva el **usuario que lo registró** (`createdByUserId`) para trazabilidad.

---

## 3. Etapa 2 — Fuentes

**Objetivo:** declarar qué documentación y componentes llegaron y qué todavía bloquea el cálculo.

```mermaid
flowchart TD
    A[Etapa 2 · Fuentes] --> B[Selector de fuente + archivo CSV/TXT/JSON]
    B --> C[Botón: Importar lote]
    C --> D[Lote validado y commiteado]
    D --> E[Tabla de fuentes<br/>registros · lotes · estado]
    E --> F[Botón: Revisar lote<br/>si COMMITTED sin revisar]
    A --> G[Tabla de componentes<br/>obligaciones vinculadas]
    A --> H[Botón: Actualizar]
    A --> I[Botón: Ir a bandeja]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Elegir fuente y archivo | Selector + input file | `tax.vouchers.prepare` y expediente editable |
| Importar el lote | **Importar lote** | Fuente + archivo seleccionados |
| Revisar un lote commiteado | **Revisar** | `tax.vouchers.review` |
| Refrescar cobertura | **Actualizar** | Siempre |
| Ir a la bandeja de trabajo | **Ir a bandeja** | — |

> El cálculo queda bloqueado mientras una fuente **obligatoria** no esté presente (`WAITING_INPUTS`).

---

## 4. Etapa 3 — Clasificación

**Objetivo:** completar actividades y rubros que determinan las alícuotas, e imputar retenciones/percepciones.

```mermaid
flowchart TD
    A[Etapa 3 · Clasificación] --> B[Resumen: clasificados / pendientes / gate]
    B --> C[Tabla de comprobantes]
    C --> D[Rubro compra / actividad venta]
    D --> E[Botón: Guardar / Actualizar]
    A --> F[Subsección: Imputación de retenciones y percepciones]
    F --> G[Selector de jurisdicción]
    G --> H[Botón: Reimputar]
    A --> I[Botón: Actualizar clasificación]
    A --> J[Botón: Ver configuración fiscal]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Clasificar un comprobante | **Guardar** / **Actualizar** | `tax.vouchers.prepare` |
| Reimputar un certificado | **Reimputar** | `tax.vouchers.prepare` |
| Refrescar clasificación | **Actualizar clasificación** | Siempre |
| Ir a configuración fiscal | **Ver configuración fiscal** | — |

> El cálculo queda bloqueado mientras exista una compra sin rubro o una venta sin actividad (`WAITING_INPUTS`).

---

## 5. Etapa 4 — Cálculo

**Objetivo:** revisar la posición fiscal del período: devengado, pagos, presentaciones e intereses.

```mermaid
flowchart TD
    A[Etapa 4 · Cálculo] --> B[Determinación y trazabilidad<br/>totales · fórmulas · versión de reglas]
    B --> C[Botón: Actualizar cálculo]
    A --> D[Tabla de posición fiscal<br/>devengado · pagado · pendiente · total a pagar]
    D --> E[Botón: Registrar presentación]
    D --> F[Botón: Calcular mora]
    D --> G[Botón: Registrar pago]
    A --> H[Botón: Actualizar posición]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Refrescar determinación | **Actualizar cálculo** | Siempre |
| Refrescar posición | **Actualizar posición** | Siempre |
| Registrar presentación | **Registrar presentación** | `tax.filings.record` y liquidación presente |
| Calcular intereses por mora | **Calcular mora** | Pendiente > 0, vencido, liquidación FINALIZED, `tax.payments.record` |
| Registrar pago | **Registrar pago** | Total a pagar > 0, `tax.payments.record` |

---

## 6. Etapa 5 — Controles

**Objetivo:** revisar hallazgos, bloqueos y resoluciones antes de cerrar.

```mermaid
flowchart TD
    A[Etapa 5 · Controles] --> B[Card por control<br/>código · severidad · esperado vs actual]
    B --> C[Input: explicá la resolución]
    C --> D[Select: evidencia<br/>solo para BLOCKING]
    D --> E[Botón: Resolver]
    C --> F[Botón: Eximir<br/>solo no-BLOCKING]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Resolver un control | **Resolver** | `tax.settlements.review`, resolución escrita (+ evidencia si BLOCKING) |
| Eximir un control | **Eximir** | `tax.settlements.review`, solo no-BLOCKING |

> Un control **BLOCKING** abierto impide finalizar el expediente (se muestra el contador "N control(es) bloqueante(s)" en la cabecera de la card).

---

## 7. Etapa 6 — Cierre

**Objetivo:** revisar hashes y finalizar el expediente para arrastrar saldos al siguiente período.

```mermaid
flowchart TD
    A[Etapa 6 · Cierre] --> B[Detalle: hash de entrada / hash de salida / controles bloqueantes]
    B --> C[Botón: Finalizar<br/>requiere tax.settlements.finalize]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Finalizar el expediente | **Finalizar** | `tax.settlements.finalize`, sin controles BLOCKING abiertos |

---

## 8. Acciones globales del expediente (pie de la card)

Independientemente de la etapa activa, el pie de la card muestra el botón correspondiente al **estado** del expediente:

| Estado del expediente | Botón | Capacidad |
|---|---|---|
| `DRAFT` / `COLLECTING_INPUTS` / `READY_TO_CALCULATE` | **Calcular** | `tax.settlements.calculate` (solo si `READY_TO_CALCULATE`) |
| `CHANGES_REQUESTED` | **Recalcular** | `tax.settlements.calculate` |
| `CALCULATED` | **Enviar a revisión** | `tax.settlements.submit_review` |
| `IN_REVIEW` | **Aprobar revisión** / **Solicitar cambios** | `tax.settlements.review` |
| `REVIEWED` | **Finalizar** | `tax.settlements.finalize` |
| `FINALIZED` | **Crear rectificativa** | `tax.settlements.rectify` |

```mermaid
flowchart LR
    D[DRAFT] --> CI[COLLECTING_INPUTS] --> RTC[READY_TO_CALCULATE]
    RTC -->|Calcular| CAL[CALCULATED]
    CAL -->|Enviar a revisión| IR[IN_REVIEW]
    IR -->|Aprobar| REV[REVIEWED]
    IR -->|Solicitar cambios| CR[CHANGES_REQUESTED]
    CR -->|Recalcular| CAL
    REV -->|Finalizar| FIN[FINALIZED]
    FIN -->|Crear rectificativa| SUP[SUPERSEDED / nueva revisión]
```

---

## 9. Resumen del flujo completo

```mermaid
flowchart TD
    INICIO[Crear expediente] --> E1[Saldos<br/>cargar saldo inicial]
    E1 --> E2[Fuentes<br/>importar y revisar lotes]
    E2 --> E3[Clasificación<br/>rubros, actividades, imputaciones]
    E3 --> E4[Cálculo<br/>revisar posición, pagos, presentaciones]
    E4 --> E5[Controles<br/>resolver / eximir hallazgos]
    E5 --> E6[Cierre<br/>finalizar y arrastrar]
    E6 --> FIN[Expediente FINALIZED<br/>rectificativa si hace falta]
```

> **Consejo de uso:** el orden natural es 1 → 6, pero el stepper permite saltar. El sistema **bloquea el cálculo** (botón "Calcular" deshabilitado) hasta que las fuentes obligatorias estén presentes y las clasificaciones estén completas, y **bloquea la finalización** mientras existan controles BLOCKING abiertos.
