#!/usr/bin/env bash
# Levanta el entorno local de Contable (Valkey, MinIO, API y web).
# Uso: ./dev.sh
# Detener: Ctrl+C (detiene API y web; Valkey y MinIO quedan activos).

set -euo pipefail
cd "$(dirname "$0")"

COMPOSE_FILE="infra/compose/docker-compose.yml"
INFRA_TIMEOUT="${DEV_INFRA_TIMEOUT:-60}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no está instalado o no está disponible en PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker no está en ejecución. Iniciá Docker y volvé a ejecutar ./dev.sh." >&2
  exit 1
fi

echo "▶ Levantando Valkey y MinIO…"
docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout "$INFRA_TIMEOUT" valkey minio

# Además del health check de Compose, comprobamos los protocolos que usa la API.
if [ "$(docker compose -f "$COMPOSE_FILE" exec -T valkey valkey-cli ping)" != "PONG" ]; then
  echo "Error: Valkey no respondió PONG." >&2
  exit 1
fi
docker compose -f "$COMPOSE_FILE" exec -T minio \
  curl -fsS http://localhost:9000/minio/health/live >/dev/null

echo "  Valkey: disponible en localhost:${VALKEY_PORT:-6379}"
echo "  MinIO:  http://localhost:${MINIO_API_PORT:-9000}"
echo "  Consola MinIO: http://localhost:${MINIO_CONSOLE_PORT:-9001}"
echo "▶ Levantando API (:3000) y web (:5173)…"
echo "  API: http://localhost:3000"
echo "  Web: http://localhost:5173"
echo "  Ctrl+C para detener."

# Mata ambos al salir
trap 'kill 0' EXIT INT TERM

# API en background
npm run dev -w @contable/api &
API_PID=$!

# Web en background
npm run dev -w @contable/web &
WEB_PID=$!

echo "  API pid=$API_PID · web pid=$WEB_PID"

# Espera a que cualquiera termine (o Ctrl+C)
wait
