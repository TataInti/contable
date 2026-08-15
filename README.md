# Contable

Plataforma contable multiestudio para estudios argentinos, con portal del cliente, procesamiento documental y herramientas de IA apoyadas exclusivamente en datos contables canónicos.

La especificación y las decisiones completas están en [PLAN_DESARROLLO_CONTABLE.md](./PLAN_DESARROLLO_CONTABLE.md). La documentación técnica de contratos, ADRs e invariantes está en [docs](./docs/README.md).

## Arquitectura

```text
apps/web       React 19 + Vite; estudio y portal con rutas protegidas
apps/api       Fastify + Prisma; autoridad de escritura y contratos HTTP
apps/worker    BullMQ; documentos y notificaciones durables
services/ai    FastAPI; PDF, OCR, QR, asistente y planner BI
packages/*     motor contable, permisos, contratos, storage y design system
infra/*        PostgreSQL, Valkey, MinIO, ClamAV, Nginx y Compose
```

> 📐 **[Diagrama de arquitectura vivo →](./docs/architecture-overview.md)**
> Incluye vista de contenedores, mapa de transición de módulos legacy → fiscal, flujo de liquidación target y principios arquitectónicos.
> Se actualiza con cada cambio arquitectónico significativo.

## Inicio local

Requisitos: Node 22+, npm, Docker Compose y Python 3.12+.

```bash
cp .env.example .env
docker compose -f infra/compose/docker-compose.yml up --build
```

La aplicación queda en `http://localhost:8080`. La API también se expone en `http://localhost:3000` para diagnóstico local. En un despliegue real sólo debe exponerse Nginx.

Compose usa un migrador con rol owner y ejecuta API/worker con roles separados que no son owners. Para reinicializar una instalación exclusivamente de desarrollo debe eliminarse expresamente el volumen `contable_pgdata`; no lo haga sobre datos reales.

### Datos demo opcionales

Con infraestructura levantada:

```bash
DATABASE_URL=postgresql://contable:contable@localhost:5432/contable npm run seed:demo -w @contable/api
```

Credenciales: `demo@contable.local` / `demo1234`. El seed es sólo para desarrollo y no se ejecuta automáticamente.

## Desarrollo sin contenedores

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Servicio Python:

```bash
cd services/ai
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
pytest
ruff check app tests
mypy app
```

## Seguridad operativa

- Toda ruta de negocio es autenticada por defecto y las mutaciones requieren CSRF.
- El contexto de estudio, cliente y período es explícito; no se elige la primera membresía silenciosamente.
- PostgreSQL aplica RLS forzado por estudio/cliente; auth utiliza funciones `SECURITY DEFINER` estrechas.
- El portal tiene membresías, invitaciones y rutas propias; nunca consume colecciones internas del estudio.
- Los refresh tokens se rotan por dispositivo y el replay revoca la familia.
- MFA usa desafíos firmados y secretos TOTP cifrados con AES-256-GCM.
- Documentos entran en cuarentena, se verifican por magic bytes/SHA-256 y pasan por ClamAV antes de IA.
- Auditoría es append-only a nivel SQL.
- Asientos posteados son inmutables y el balance se verifica en base de datos.

Copie `.env.example` y configure secretos reales antes de cualquier entorno no local. `OPENROUTER_*` es opcional: sin proveedor el asistente responde de manera determinista sobre evidencia; nunca inventa saldos. `NOTIFICATION_WEBHOOK_URL` debe configurarse para enviar invitaciones y recordatorios; de lo contrario los jobs permanecen fallidos/reintentables.

## Health checks

- `GET /health/live`: proceso vivo.
- `GET /health/ready`: PostgreSQL, Valkey, MinIO y FastAPI disponibles.
- `GET /health/startup`: proceso inicializado; las migraciones son responsabilidad del servicio `migrate`.

## Estado

El vertical integrado disponible comprende login/MFA, contexto, clientes, carga documental, antivirus, extracción PDF/OCR/QR, revisión, propuesta/posting contable, balance, reportes PDF/XLSX/CSV, publicación y consulta desde portal. Los handlers no implementados permanecen fuera de `WORKER_QUEUES` y fallan explícitamente si se invocan; no hay jobs que simulen éxito.
