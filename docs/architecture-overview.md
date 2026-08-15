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
        WEB_STUDY["apps/web — Study Shell<br/>Rutas: estudio contable<br/>auth, clientes, bandeja, admin<br/><br/><i>⚠️ Módulos legacy ocultos:<br/>contabilidad, reportes,<br/>asistente, BI</i>"]
        WEB_PORTAL["apps/web — Portal Cliente<br/>Rutas: /portal/*<br/>Dashboard, upload,<br/>obligaciones, reportes<br/><br/><i>🔧 En transición a<br/>vista fiscal + rentabilidad</i>"]
    end

    subgraph API["⚡ API Node — Autoridad de escritura"]
        FASTIFY["apps/api — Fastify + Prisma<br/><br/>🔵 Auth / MFA / Sesiones<br/>🔵 Firmas y membresías<br/>🔵 Clientes (→ onboarding fiscal)<br/>🔵 Documentos pipeline<br/>🔵 Jobs / Outbox<br/>🔵 Portal endpoints<br/><br/>🟡 Contabilidad (mayor)<br/>🟡 Banking<br/>🟡 Reportes<br/>🟡 Asistente<br/>🟡 BI<br/><br/>🔴 IVA Legacy — DESHABILITADO<br/>&nbsp;&nbsp;&nbsp;&nbsp;(feature flag TAX=off)"]
        TAX_SVC["🔴 apps/api/src/tax/<br/>VAT legacy service<br/><br/><i>A reemplazar por<br/>nuevo motor fiscal</i>"]
    end

    subgraph Workers["⚙️ Workers — BullMQ"]
        WORKER["apps/worker<br/>documentos, exports,<br/>notificaciones, recurrencias<br/><br/><i>🔧 En revisión:<br/>entrega y recuperación</i>"]
    end

    subgraph AI["🧠 AI Service — FastAPI"]
        FASTAPI["services/ai — FastAPI Python<br/>PDF, OCR, QR, asistente,<br/>planner BI<br/><br/><i>🔧 Sin acceso a DB<br/>Solo red privada</i>"]
    end

    subgraph Packages["📦 Packages compartidos"]
        ENG["accounting-engine<br/>Motor decimal puro<br/>partida doble, validación"]
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

    class TAX_SVC legacy
    class WEB_PORTAL,WORKER,FASTAPI transition
    class FASTIFY,WEB_STUDY,PG,VK,MO,NX stable
```

---

## 2. Mapa de transición — Módulos

```mermaid
graph LR
    subgraph EstadoActual["📋 Estado actual"]
        AUTH[Auth / MFA / Sesiones]
        FIRM[Firmas + membresías]
        CLI_OLD[Clientes ABM parcial]
        DOCS[Documentos + OCR]
        LEDGER[Contabilidad mayor]
        BANK[Banking]
        VAT_LEGACY[IVA Legacy<br/><b>DESHABILITADO</b>]
        REPORTS[Reportes + BI]
        ASSISTANT[Asistente IA]
        PORTAL_OLD[Portal cliente]
        WORKER_OLD[Worker docs/notif]
    end

    subgraph EstadoDestino["🎯 Estado destino (fiscal vertical)"]
        AUTH2[Auth / MFA / Sesiones<br/><i>✓ Conservar</i>]
        FIRM2[Firmas + permisos<br/><i>✓ Conservar + endurecer</i>]
        ONBOARD[Onboarding fiscal completo<br/><i>🆕 perfil fiscal, actividades,<br/>jurisdicciones, obligaciones</i>]
        CALENDAR[Calendario de obligaciones<br/><i>🆕 derivado de reglas</i>]
        IMPO[Importación oficial +<br/>reconciliación<br/><i>🆕 AFIP/ARCA, SIFEN</i>]
        COMP[Comprobantes fiscales<br/><i>🆕 base, alícuota,<br/>componentes, ret/pers</i>]
        VAT_NEW[IVA liquidación<br/><i>🆕 nuevo motor</i>]
        IIBB[IIBB Tucumán + CM03<br/><i>🆕 nuevo</i>]
        TEM[TEM SMT<br/><i>🆕 nuevo</i>]
        MONO["Monotributo<br/>(seguimiento)<br/><i>🆕 nuevo</i>"]
        MAKER[Flujo maker-checker<br/><i>🆕 preparar → revisar →<br/>aprobar → finalizar</i>]
        EXPORT[Exportación + acuse + pago<br/><i>🆕 papel de trabajo</i>]
        PROFIT[Rentabilidad gerencial<br/><i>🆕 devengado + caja</i>]
        PORTAL_NEW[Portal cliente fiscal<br/><i>🔄 pedidos, publicaciones,<br/>rentabilidad</i>]
        WORKER_NEW[Worker robusto<br/><i>🔄 outbox + dead-letter</i>]
    end

    %% Transiciones
    AUTH --> AUTH2
    FIRM --> FIRM2
    CLI_OLD --> ONBOARD
    DOCS --> IMPO
    DOCS --> COMP
    LEDGER -.->|"🔒 Oculto<br/>solo conciliación"| LEDGER_HIDDEN[("Mayor interno<br/>evidencia")]
    BANK -.->|"⏸️ Pausado"| BANK_PAUSED[("Futuro")]
    VAT_LEGACY --> VAT_NEW
    REPORTS -.->|"🔒 Oculto"| REPORTS_HIDDEN[("Reemplazado por<br/>rentabilidad")]
    ASSISTANT -.->|"🔒 Oculto"| ASST_HIDDEN[("Futuro")]
    PORTAL_OLD --> PORTAL_NEW
    WORKER_OLD --> WORKER_NEW

    %% Nuevos flujos
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

    style VAT_LEGACY fill:#fdd,stroke:#c00
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
| **Feature flags** | Módulos incompletos ocultos por flag server-side. Sin pantallas decorativas. |
| **Sin credenciales fiscales** | No se almacenan claves ARCA/COMARB. El contador presenta manualmente. |

---

> **Próxima actualización:** cuando un nuevo módulo fiscal (IVA, IIBB, TEM) pase su puerta y se active.