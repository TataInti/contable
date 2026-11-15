# Flujograma del Expediente Mensual — Acciones y botones por etapa

> **Propósito:** explicar, de forma visual y paso a paso, el flujo de trabajo de la interfaz web al entrar al **Expediente mensual** (`/expediente-mensual`). Describe las **6 etapas** del stepper persistente, las **acciones** disponibles en cada una y los **botones** que las disparan, para que preparador y revisor entiendan qué hacer y en qué orden.
>
> La vista usa un **stepper persistente** (no un wizard que oculta información): las 6 etapas están siempre visibles y se puede saltar entre ellas libremente. El estado del expediente (badge) y los controles bloqueantes determinan qué botones están habilitados.

---

## 0. Antes de empezar: crear el expediente

Al entrar a `/expediente-mensual` con un cliente y período activos, la pantalla muestra:

- La importación de los libros IVA ya no está en la cabecera: se hace desde la fila de IVA ventas o IVA compras en la etapa **Fuentes** (ver §3).
- **Nuevo legajo** (cabecera): crea el legajo del período fiscal elegido. Requiere `tax.settlements.calculate` y un período fiscal; si falta alguno, el botón queda deshabilitado y la pantalla dice por qué.
- Si **no hay legajos** para el período, se muestra «Sin legajos para este período» con el botón **Crear legajo** (solo si el perfil puede crear legajos).

> El expediente nace en estado `DRAFT`. A partir de ahí se recorre el stepper.

```mermaid
flowchart TD
    A[Entrar a /expediente-mensual<br/>cliente + período activos] --> B{¿Hay expediente?}
    B -- No --> C[Estado vacío<br/>Botón: Crear legajo]
    B -- Sí --> D[Card del expediente<br/>badge de estado + stepper 6 etapas]
    C --> D
    D --> F[Botón cabecera: Nuevo legajo]
```

---

## 1. Las 6 etapas del stepper

El stepper persistente tiene 6 etapas. Cada una se abre desde el **menú de pestañas** (clic directo), y el pie de la tarjeta, con **Volver a <etapa>** e **Ir a <etapa>**, la mueve en orden.

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

> **Navegación común a todas las etapas:** menú de pestañas (1–6) y, en el pie de la tarjeta, **«Volver a <etapa>»** / **«Ir a <etapa>»**. En la primera y en la última etapa esos botones quedan deshabilitados, con **«Inicio del proceso»** y **«Última etapa»**.

---

## 2. Etapa 1 — Saldos

**Objetivo:** registrar y revisar los saldos a favor y arrastres disponibles por impuesto, régimen y jurisdicción.

```mermaid
flowchart TD
    A[Etapa 1 · Saldos] --> B[Tabla de saldos a favor<br/>original · disponible · movimientos · respaldo]
    B --> C[Botón: Actualizar]
    B --> D[Botón: Cargar saldo inicial<br/>requiere tax.settlements.calculate]
    D --> E[Panel lateral: Cargar saldo inicial]
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
    A --> J[Fila IVA ventas o compras: Importar libro<br/>panel Importar libros IVA]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Elegir fuente y archivo | Selector + input file | `tax.vouchers.prepare` y expediente editable |
| Importar el lote | **Importar lote** | Fuente + archivo seleccionados |
| Revisar un lote commiteado | **Revisar** | `tax.vouchers.review` |
| Importar un libro IVA (ventas o compras) | **Importar libro** (fila de IVA en la tabla de fuentes) | Deshabilitado con su motivo visible cuando no se puede importar |
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
    A --> I[Botón: Actualizar<br/>refresca clasificación e imputaciones]
    A --> J[Botón: Ver configuración fiscal]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Clasificar un comprobante | **Guardar** / **Actualizar** | `tax.vouchers.prepare` |
| Reimputar un certificado | **Reimputar** | `tax.vouchers.prepare` |
| Refrescar clasificación e imputaciones | **Actualizar** (uno por etapa) | Siempre |
| Ir a configuración fiscal | **Ver configuración fiscal** | — |

> El cálculo queda bloqueado mientras exista una compra sin rubro o una venta sin actividad (`WAITING_INPUTS`).

---

## 5. Etapa 4 — Cálculo

**Objetivo:** revisar la posición fiscal del período: devengado, pagos, presentaciones e intereses.

```mermaid
flowchart TD
    A[Etapa 4 · Cálculo] --> B[Determinación y trazabilidad<br/>totales · fórmulas · versión de reglas]
    B --> C[Botón: Actualizar<br/>refresca posición y determinación]
    A --> D[Tabla de posición fiscal<br/>devengado · pagado · pendiente · total a pagar]
    D --> E[Botón: Registrar presentación]
    D --> F[Botón: Calcular mora]
    D --> G[Botón: Registrar pago]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Refrescar posición y determinación | **Actualizar** (uno por etapa) | Siempre |
| Registrar presentación | **Registrar presentación** | `tax.filings.record` y liquidación FINALIZED; no aparece si el período ya está presentado |
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
    C --> F[Botón: Eximir<br/>solo no-BLOCKING, pide confirmación]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Resolver un control | **Resolver** | `tax.settlements.review` y resolución escrita; en BLOCKING, el respaldo es opcional |
| Eximir un control | **Eximir** | `tax.settlements.review`, solo no-BLOCKING, con motivo escrito; pide confirmación («Eximir el control») |

> Un control **BLOCKING** abierto impide finalizar el expediente (se muestra el contador "N control(es) bloqueante(s)" en la cabecera de la card).

---

## 7. Etapa 6 — Cierre

**Objetivo:** revisar hashes y finalizar el expediente para arrastrar saldos al siguiente período.

```mermaid
flowchart TD
    A[Etapa 6 · Cierre] --> B[Detalle: hash de entrada / hash de salida / controles bloqueantes]
    B --> C[Botón: Finalizar, en el pie de la tarjeta<br/>requiere tax.settlements.finalize y confirmación]
```

**Acciones y botones:**

| Acción | Botón | Condición / capacidad |
|---|---|---|
| Finalizar el legajo | **Finalizar** (pie de la tarjeta, con confirmación «Finalizar el legajo») | `tax.settlements.finalize`, con la revisión en `REVIEWED` y sin controles BLOCKING abiertos |

---

## 8. Acciones globales del expediente (pie de la card)

Independientemente de la etapa activa, el pie de la card muestra el botón correspondiente al **estado** del expediente:

| Estado del expediente | Botón | Capacidad |
|---|---|---|
| `DRAFT` / `COLLECTING_INPUTS` / `READY_TO_CALCULATE` | **Calcular** | `tax.settlements.calculate`; se habilita en `READY_TO_CALCULATE` y, si no, muestra el motivo |
| `CHANGES_REQUESTED` | **Recalcular** | `tax.settlements.calculate` |
| `CALCULATED` | **Enviar a revisión** | `tax.settlements.submit_review` |
| `IN_REVIEW` | **Aprobar revisión** / **Solicitar cambios** | `tax.settlements.review`; quien preparó el legajo no puede revisarlo, salvo autorrevisión habilitada por el Titular |
| `REVIEWED` | **Finalizar** (con confirmación) | `tax.settlements.finalize` |
| `FINALIZED` | **Crear rectificativa** (con confirmación) | `tax.settlements.rectify` |

> Una revisión reemplazada por una rectificativa se muestra como resumen de solo lectura, sin etapas ni acciones.

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
    INICIO[Crear legajo] --> E1[Saldos<br/>cargar saldo inicial]
    E1 --> E2[Fuentes<br/>importar y revisar lotes]
    E2 --> E3[Clasificación<br/>rubros, actividades, imputaciones]
    E3 --> E4[Cálculo<br/>revisar posición, pagos, presentaciones]
    E4 --> E5[Controles<br/>resolver / eximir hallazgos]
    E5 --> E6[Cierre<br/>finalizar y arrastrar]
    E6 --> FIN[Expediente FINALIZED<br/>rectificativa si hace falta]
```

> **Consejo de uso:** el orden natural es 1 → 6, pero el stepper permite saltar. El sistema **bloquea el cálculo** (botón "Calcular" deshabilitado) hasta que las fuentes obligatorias estén presentes y las clasificaciones estén completas, y **bloquea la finalización** mientras existan controles BLOCKING abiertos.
