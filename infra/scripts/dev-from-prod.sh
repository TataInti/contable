#!/usr/bin/env bash
# ============================================================
# Contable — Deja el entorno de desarrollo igual a producción
#
# Copia (sólo lectura sobre el servidor) la base de producción a un
# PostgreSQL 18 local —la misma versión que producción— y crea dos
# usuarios de prueba locales. No escribe nada en el servidor.
#
# Uso:  ./infra/scripts/dev-from-prod.sh
# Luego reiniciá API y worker apuntando a la base local (ver el final).
#
# ADVERTENCIA: reemplaza la base `contable` del PostgreSQL local de
# este script (puerto 5442). Trae datos reales: no la compartas.
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

PROD_SSH="${PROD_SSH:-root@72.61.47.19}"      # ver ssh.md
PROD_PG_CONTAINER="${PROD_PG_CONTAINER:-contable-prod-postgres-1}"
LOCAL_PORT="${POSTGRES_PORT:-5442}"
export PGPASSWORD="${POSTGRES_PASSWORD:-contable}"
DUMP="$(mktemp -t contable-prod-XXXXXX.sql)"
trap 'rm -f "$DUMP"' EXIT

echo "▶ PostgreSQL 18 local en :${LOCAL_PORT}…"
POSTGRES_PORT="$LOCAL_PORT" POSTGRES_DB=contable \
  docker compose -p contable-prodlike -f infra/compose/docker-compose.yml up -d --wait postgres

echo "▶ Leyendo producción (pg_dump, sólo lectura)…"
ssh -o BatchMode=yes "$PROD_SSH" \
  "docker exec $PROD_PG_CONTAINER pg_dump -U contable -d contable --no-owner" > "$DUMP"

echo "▶ Recreando la base local…"
psql -h localhost -p "$LOCAL_PORT" -U contable -d postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS contable WITH (FORCE)" -c "CREATE DATABASE contable"
psql -h localhost -p "$LOCAL_PORT" -U contable -d contable -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT CONNECT ON DATABASE contable TO contable_runtime, contable_worker;
GRANT USAGE ON SCHEMA public TO contable_runtime, contable_worker;
SQL
psql -h localhost -p "$LOCAL_PORT" -U contable -d contable -q -f "$DUMP" >/dev/null

echo "▶ Usuarios de prueba locales…"
DATABASE_URL="postgresql://contable:${PGPASSWORD}@localhost:${LOCAL_PORT}/contable" \
  npm run seed:usuarios-locales -w @contable/api --silent

cat <<MSG

Listo. Apuntá los servicios a la base local:

  RUNTIME_DATABASE_URL=postgresql://contable_runtime:runtime_secret@localhost:${LOCAL_PORT}/contable?schema=public \\
    DATABASE_URL=postgresql://contable_runtime:runtime_secret@localhost:${LOCAL_PORT}/contable?schema=public \\
    npm run dev -w @contable/api
  WORKER_DATABASE_URL=postgresql://contable_worker:worker_secret@localhost:${LOCAL_PORT}/contable?schema=public \\
    npm run dev -w @contable/worker

Ingreso local: demo@contable.local / demo1234 (Titular y admin de plataforma).
MSG
