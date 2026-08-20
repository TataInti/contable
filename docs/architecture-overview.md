# Arquitectura de Contable — Diagrama vivo

> Este diagrama se actualiza con cada cambio arquitectónico significativo.
> Refleja el estado **actual** y la **transición** hacia el nuevo diseño fiscal.

---

## 1. Vista general — Contenedores (estado actual + transición)

```mermaid
graph TB
    subgraph Usuarios["👥 Usuarios"]
        EST["👤 Estudio contable<br/>preparador / revisor / prof. fiscal"]
        CLI["👤 Cliente<br/>(portal propio)"]
        ADMIN["👤 Admin del estudio"]
    end

    subgraph Frontend["🖥️ Frontend — React 19 + Vite"]
        WEB_STUDY["apps/web — Study Shell<br/>Rutas: estudio contable<br/>dashboard, clientes, onboarding<br/>fiscal, liquidaciones, bandeja,<br/>trabajo, rentabilidad, admin<br/><br/><i>⚠️ Legacy oculto de la nav:<br/>contabilidad, reportes,<br/>asistente, BI (G0-03)</i>"]
        WEB_PORTAL["apps/web — Portal Cliente<br/>Rutas: /portal/*<br/>Dashboard, pendientes, upload,<br/>impuestos, liquidaciones,<br/>rentabilidad, mensajes, perfil<br/><br/><i>✅ Vista fiscal + rentabilidad</i>"]
    end

    subgraph API["⚡ API Node — Autoridad de escritura"]
        FASTIFY["apps/api — Fastify + Prisma<br/><br/>🔵 Auth / MFA / Sesiones<br/>🔵 Firmas y membresías<br/>🔵 Clientes (onboarding fiscal)<br/>🔵 Documentos pipeline<br/>🔵 Jobs / Outbox (lease/retry/DLQ)<br/>🔵 Portal endpoints<br/><br/>🟢 Fundación fiscal (maestros,<br/>&nbsp;&nbsp;&nbsp;&nbsp;perfil, reglas, calendario)<br/>🟢 Ingestión (batches, vouchers,<br/>&nbsp;&nbsp;&nbsp;&nbsp;ret/perc, gastos gerenciales)<br/>🟢 Liquidaciones (IVA/IIBB/TEM/<br/>&nbsp;&nbsp;&nbsp;&nbsp;CM03/MONO, maker-checker)<br/>🟢 Rentabilidad (devengado/caja)<br/><br/>🟡 Legacy (mayor, banking,<br/>&nbsp;&nbsp;&nbsp;&nbsp;reportes, asistente, BI)<br/><br/>🔴 IVA Legacy — DESHABILITADO<br/>&nbsp;&nbsp;&nbsp;&nbsp;(feature flag TAX=off)"]
        TAX_SVC["🟢 apps/api/src/tax/<br/>Motor fiscal nuevo<br/>settlement + ingestion +<br/>profitability services"]
    end

    subgraph Workers["⚙️ Workers — BullMQ"]
        WORKER["apps/worker<br/>documentos, notificaciones<br/><br/><i>🔧 Pendiente: handlers reales<br/>para exports, recurrencias,<br/>ai y maintenance</i>"]
    end

    subgraph AI["🧠 AI Service — FastAPI"]
        FASTAPI["services/ai — FastAPI Python<br/>PDF, OCR, QR, asistente,<br/>planner BI<br/><br/><i>🔧 Sin acceso a DB<br/>Solo red privada</i>"]
    end

    subgraph Packages["📦 Packages compartidos"]
        ENG["accounting-engine<br/>Motor decimal puro<br/>partida doble, validación"]
        TAXENG["tax-engine<br/>Motores deterministas<br/>IVA · IIBB · TEM · CM03 ·<br/>MONO · rentabilidad"]
        CONTRACTS["contracts<br/>Schemas Zod + tipos TS"]
        PERMS["permissions<br/>Matriz de permisos runtime"]
        STORAGE["storage<br/>Cliente MinIO wrapper"]
        DS["design-system<br/>Tokens + componentes UI<br/>marfil/verde, Source Serif/Sans"]
    end

    subgraph Infra["🏗️ Infraestructura"]
        PG[("PostgreSQL 18<br/>RLS forzado<br/>Roles: owner / runtime / worker")]
        VK[("Valkey 8<br/>BullMQ queues + cache")]
        MO[("MinIO<br/>Objetos + documentos")]
        CLAM[("ClamAV<br/>Antivirus cuarentena")]
        NX[("Nginx<br/>Reverse proxy")]
    end

    %% Conexiones frontend → nginx → api
    EST --> WEB_STUDY
    CLI --> WEB_PORTAL
    WEB_STUDY --> NX
    WEB_PORTAL --> NX
    NX --> FASTIFY

    %% API → infra
    FASTIFY --> PG
    FASTIFY --> VK
    FASTIFY --> MO
    FASTIFY --> WORKER

    %% Worker → infra
    WORKER --> VK
    WORKER --> MO
    WORKER --> FASTAPI
    WORKER --> PG

    %% AI service
    FASTAPI --> MO
    FASTAPI --> VK

    %% Packages
    FASTIFY --> ENG
    FASTIFY --> TAXENG
    FASTIFY --> CONTRACTS
    FASTIFY --> PERMS
    FASTIFY --> STORAGE
    WEB_STUDY --> CONTRACTS
    WEB_STUDY --> DS
    WEB_PORTAL --> CONTRACTS
    WEB_PORTAL --> DS
    WORKER --> STORAGE

    %% Estilo
    classDef legacy fill:#fdd,stroke:#c00,stroke-width:2px
    classDef transition fill:#ffd,stroke:#c90,stroke-width:2px
    classDef stable fill:#dfd,stroke:#090,stroke-width:2px
    classDef infra fill:#eef,stroke:#66c,stroke-width:1px,stroke-dasharray: 3

    class TAX_SVC stable
    class WORKER,FASTAPI transition
    class FASTIFY,WEB_STUDY,WEB_PORTAL,PG,VK,MO,NX stable
```

---

## 2. Mapa de transición — Módulos

```mermaid
graph LR
    subgraph EstadoActual["📋 Estado actual (2026-08-20)"]
        AUTH[Auth / MFA / Sesiones]
        FIRM[Firmas + membresías]
        ONBOARD[Onboarding fiscal<br/><b>✅ completo</b>]
        CALENDAR[Calendario de obligaciones<br/><b>✅ derivado de reglas</b>]
        IMPO[Importación oficial +<br/>reconciliación<br/><b>✅ adaptadores ARCA/DGR/SMT/CM03</b>]
        COMP[Comprobantes fiscales<br/><b>✅ FiscalVoucher + componentes</b>]
        VAT_NEW[IVA liquidación<br/><b>✅ motor nuevo</b>]
        IIBB[IIBB Tucumán + CM03<br/><b>✅ motores</b>]
        TEM[TEM SMT<br/><b>✅ motor</b>]
        MONO[Monotributo<br/><b>✅ seguimiento</b>]
        MAKER[Flujo maker-checker<br/><b>✅ preparar → revisar →<br/>aprobar → finalizar</b>]
        EXPORT[Exportación + acuse + pago<br/><b>✅ papel de trabajo + acuse</b>]
        PROFIT[Rentabilidad gerencial<br/><b>✅ devengado + caja</b>]
        PORTAL_NEW[Portal cliente fiscal<br/><b>✅ pedidos, publicaciones,<br/>rentabilidad</b>]
        WORKER_NEW[Worker robusto<br/><b>✅ outbox + dead-letter</b>]
        LEDGER[Contabilidad mayor<br/><i>🔒 oculto de la nav</i>]
        BANK[Banking<br/><i>⏸️ pausado</i>]
        REPORTS[Reportes + BI<br/><i>🔒 oculto de la nav</i>]
        ASSISTANT[Asistente IA<br/><i>🔒 oculto de la nav</i>]
    end

    subgraph Pendiente["🎯 Pendiente (2026-08-20)"]
        ESTACION[Estación de trabajo<br/>liquidación 5 zonas]
        PEDIDOS[Pedidos ligados a<br/>obligationId + portal por ítem]
        DOCPREV[Estación documental<br/>con preview de evidencia]
        LEDGER_CR[Libro de créditos<br/>GET /tax-credit-ledger]
        CALC_EXCEL[Cálculos del Excel:<br/>Dto. 814 · mora · prorrata ·<br/>rubros · conciliación]
        OBS[Observabilidad /metrics<br/>+ alertas]
        CI[CI: ClamAV + E2E +<br/>scripts canónicos]
    end

    %% Flujo fiscal ya operativo
    ONBOARD --> CALENDAR
    CALENDAR --> IMPO
    IMPO --> COMP
    COMP --> VAT_NEW
    COMP --> IIBB
    COMP --> TEM
    COMP --> MONO
    VAT_NEW --> MAKER
    IIBB --> MAKER
    TEM --> MAKER
    MAKER --> EXPORT
    EXPORT --> PROFIT

    %% Legacy oculto
    LEDGER -.->|"🔒 Oculto<br/>solo conciliación"| LEDGER_HIDDEN[("Mayor interno<br/>evidencia")]
    BANK -.->|"⏸️ Pausado"| BANK_PAUSED[("Futuro")]
    REPORTS -.->|"🔒 Oculto"| REPORTS_HIDDEN[("Reemplazado por<br/>rentabilidad")]
    ASSISTANT -.->|"🔒 Oculto"| ASST_HIDDEN[("Futuro")]

    style VAT_NEW fill:#dfd,stroke:#090
    style IIBB fill:#dfd,stroke:#090
    style TEM fill:#dfd,stroke:#090
    style MONO fill:#dfd,stroke:#090
    style MAKER fill:#dfd,stroke:#090
    style EXPORT fill:#dfd,stroke:#090
    style PROFIT fill:#dfd,stroke:#090
    style LEDGER_HIDDEN fill:#eee,stroke:#999,stroke-dasharray: 3
    style REPORTS_HIDDEN fill:#eee,stroke:#999,stroke-dasharray: 3
    style ASST_HIDDEN fill:#eee,stroke:#999,stroke-dasharray: 3
    style BANK_PAUSED fill:#eee,stroke:#999,stroke-dasharray: 3
```

---

## 3. Flujo de liquidación (target)

```mermaid
flowchart TD
    START(["Cliente con obligación<br/>período abierto"]) --> ONBOARD_OK{"Perfil fiscal<br/>configurado?"}
    ONBOARD_OK -->|No| CONFIG[Configurar perfil<br/>actividades + jurisdicciones]
    ONBOARD_OK -->|Sí| PEDIDOS[Generar pedidos<br/>documentales automáticos]
    CONFIG --> PEDIDOS

    PEDIDOS --> DOCS_OK{"Documentación<br/>completa?"}
    DOCS_OK -->|No| ESPERA["Esperar aportes<br/>(portal cliente)"]
    ESPERA --> PEDIDOS

    DOCS_OK -->|Sí| IMPORT[Importar datos oficiales<br/>+ reconciliar comprobantes]
    IMPORT --> AJUSTES["Ajustes documentados<br/>(preparador)"]
    AJUSTES --> CALCULAR["Calcular liquidación<br/>(motor determinista)"]
    CALCULAR --> REVISAR["Revisión independiente<br/>(revisor)"]
    REVISAR --> DIFERENCIAS{"¿Diferencias<br/>u observaciones?"}
    DIFERENCIAS -->|Sí| AJUSTES
    DIFERENCIAS -->|No| APROBAR["Aprobación profesional<br/>(prof. fiscal)"]
    APROBAR --> FINALIZAR["Finalizar liquidación<br/>(inmutable)"]
    FINALIZAR --> EXPORT[Exportar papel de trabajo]
    EXPORT --> PAGO["Registrar presentación + pago<br/>(operador)"]
    PAGO --> PUBLICAR["Publicar en portal<br/>+ actualizar rentabilidad"]

    style FINALIZAR fill:#dfd,stroke:#090,stroke-width:2px
    style APROBAR fill:#dfd,stroke:#090
    style REVISAR fill:#ffd,stroke:#c90
    style AJUSTES fill:#ffd,stroke:#c90
```

---

## 4. Principios arquitectónicos clave

| Principio | Descripción |
|-----------|-------------|
| **Autoridad de escritura** | Solo Node/Fastify escribe. IA nunca crea asientos ni finaliza liquidaciones. |
| **RLS obligatorio** | Runtime nunca es owner de PostgreSQL. Políticas forzadas por estudio/cliente. |
| **Outbox durable** | Intención en PostgreSQL; worker reclama con lease. Dead-letter tras 10 intentos. |
| **Maker-checker** | Quien prepara no revisa ni finaliza. Historial inmutable. |
| **Autoridad de escritura** | Solo Node/Fastify escribe. IA nunca crea asientos ni finaliza liquidaciones. |
| **RLS obligatorio** | Runtime nunca es owner de PostgreSQL. Políticas forzadas por estudio/cliente. |
| **Outbox durable** | Intención en PostgreSQL; worker reclama con lease. Dead-letter tras 10 intentos. |
| **Maker-checker** | Quien prepara no revisa ni finaliza. Historial inmutable. |
| **Feature flags** | Módulos incompletos ocultos por flag server-side. Sin pantallas decorativas. |
| **Foco en el proceso** | La navegación del estudio expone sólo el flujo de liquidación fiscal mensual (captura → clasificación → cálculo → determinación de saldo → control → cierre). Los módulos de contabilidad de asientos y reportes/BI están ocultos de la navegación; su código se conserva como legado técnico (evidencia y conciliación interna), sin rutas de producto. |
| **Sin credenciales fiscales** | No se almacenan claves ARCA/COMARB. El contador presenta manualmente. |

---

> **Próxima actualización:** cuando un nuevo módulo fiscal (IVA, IIBB, TEM) pase su puerta y se active.