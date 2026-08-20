#!/bin/bash
# ============================================================
# Contable — Restore desde backup (F2.7)
#
# Restaura un backup desde MinIO a la base de datos.
# Diseñado para restore drill y recuperación de desastres.
#
# Uso: ./restore.sh <timestamp|latest>
# Ejemplo: ./restore.sh 20260819T120000Z
#          ./restore.sh latest
#
# Requiere: pg_restore, curl, MINIO_* y PG* en entorno.
# ADVERTENCIA: SOBRESCRIBE la base de datos actual.
# ============================================================
set -euo pipefail

TIMESTAMP="${1:-latest}"
BACKUP_FILE="/tmp/contable-restore-${TIMESTAMP}.sql.gz"

# Conexión a PostgreSQL.
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-contable}"
PGDATABASE="${PGDATABASE:-contable}"
PGPASSWORD="${PGPASSWORD:?PGPASSWORD es obligatorio}"
export PGPASSWORD

# MinIO.
MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio}"
MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-contable}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:?MINIO_SECRET_KEY es obligatorio}"
MINIO_BUCKET="${MINIO_BUCKET:-backups}"
MINIO_HOST="${MINIO_ENDPOINT}:${MINIO_PORT}"

if [ "${TIMESTAMP}" = "latest" ]; then
  echo "[restore] Buscando backup más reciente..."
  # Listar objetos y tomar el último.
  TIMESTAMP=$(curl -sS "http://${MINIO_HOST}/${MINIO_BUCKET}?list-type=2&prefix=backups/" \
    -H "Authorization: AWS ${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}" \
    | grep -oP 'backups/\K[0-9TZ]+(?=\.sql\.gz)' \
    | sort -r \
    | head -1)
  if [ -z "${TIMESTAMP}" ]; then
    echo "[restore] ERROR: No se encontraron backups en ${MINIO_BUCKET}"
    exit 1
  fi
  echo "[restore] Backup más reciente: ${TIMESTAMP}"
fi

OBJECT_KEY="backups/${TIMESTAMP}.sql.gz"

echo "[restore] Descargando backup: ${MINIO_BUCKET}/${OBJECT_KEY}"

# 1. Descargar de MinIO.
curl -sS -o "${BACKUP_FILE}" \
  "http://${MINIO_HOST}/${MINIO_BUCKET}/${OBJECT_KEY}" \
  -H "Authorization: AWS ${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}"

if [ ! -s "${BACKUP_FILE}" ]; then
  echo "[restore] ERROR: No se pudo descargar el backup ${OBJECT_KEY}"
  exit 1
fi

echo "[restore] Backup descargado: $(du -h "${BACKUP_FILE}" | cut -f1)"

# 2. Verificar checksum (si está disponible en metadata).
EXPECTED_SHA=$(curl -sS -I \
  "http://${MINIO_HOST}/${MINIO_BUCKET}/${OBJECT_KEY}" \
  -H "Authorization: AWS ${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}" \
  | grep -i 'x-amz-meta-sha256' \
  | cut -d: -f2 \
  | tr -d ' \r')
if [ -n "${EXPECTED_SHA}" ]; then
  ACTUAL_SHA=$(sha256sum "${BACKUP_FILE}" | cut -d' ' -f1)
  if [ "${EXPECTED_SHA}" != "${ACTUAL_SHA}" ]; then
    echo "[restore] ERROR: Checksum no coincide. Esperado: ${EXPECTED_SHA}, Actual: ${ACTUAL_SHA}"
    exit 1
  fi
  echo "[restore] Checksum verificado: ${ACTUAL_SHA}"
fi

# 3. CONFIRMACIÓN (sólo en terminal interactiva).
if [ -t 0 ]; then
  echo ""
  echo "⚠️  ADVERTENCIA: Esto SOBRESCRIBIRÁ la base de datos '${PGDATABASE}' en ${PGHOST}."
  echo "   Backup a restaurar: ${TIMESTAMP}"
  echo ""
  read -r -p "   Escribí 'RESTAURAR' para confirmar: " CONFIRM
  if [ "${CONFIRM}" != "RESTAURAR" ]; then
    echo "[restore] Cancelado."
    rm -f "${BACKUP_FILE}"
    exit 0
  fi
fi

# 4. Restaurar.
echo "[restore] Restaurando base de datos..."
gunzip -c "${BACKUP_FILE}" | psql \
  -h "${PGHOST}" \
  -p "${PGPORT}" \
  -U "${PGUSER}" \
  -d "${PGDATABASE}" \
  -v ON_ERROR_STOP=1

echo "[restore] Base de datos restaurada exitosamente."

# 5. Aplicar migraciones pendientes (por si el backup es de versión anterior).
echo "[restore] Aplicando migraciones pendientes..."
npx prisma migrate deploy --config apps/api/prisma.config.ts

echo "[restore] Restore completado: ${TIMESTAMP}"

# 6. Limpiar.
rm -f "${BACKUP_FILE}"