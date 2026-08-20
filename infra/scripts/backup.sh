#!/bin/bash
# ============================================================
# Contable — Backup fuera del host (F2.7)
#
# Hace pg_dump de la base de datos y lo sube a MinIO con
# timestamp y checksum. Diseñado para cron diario.
#
# Uso: ./backup.sh
# Requiere: pg_dump, curl, sha256sum, MINIO_* y PG* en entorno.
# ============================================================
set -euo pipefail

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="/tmp/contable-backup-${TIMESTAMP}.sql.gz"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

# Conexión a PostgreSQL (desde dentro de la red Docker o local).
PGHOST="${PGHOST:-postgres}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-contable}"
PGDATABASE="${PGDATABASE:-contable}"
PGPASSWORD="${PGPASSWORD:?PGPASSWORD es obligatorio}"
export PGPASSWORD

# MinIO (endpoint interno de Docker).
MINIO_ENDPOINT="${MINIO_ENDPOINT:-minio}"
MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-contable}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:?MINIO_SECRET_KEY es obligatorio}"
MINIO_BUCKET="${MINIO_BUCKET:-backups}"
MINIO_HOST="${MINIO_ENDPOINT}:${MINIO_PORT}"

echo "[backup] Iniciando backup de ${PGDATABASE} en ${PGHOST}:${PGPORT}"

# 1. pg_dump comprimido.
pg_dump \
  -h "${PGHOST}" \
  -p "${PGPORT}" \
  -U "${PGUSER}" \
  -d "${PGDATABASE}" \
  --no-owner \
  --no-acl \
  --compress=9 \
  -f "${BACKUP_FILE}"

echo "[backup] pg_dump completado: $(du -h "${BACKUP_FILE}" | cut -f1)"

# 2. Checksum.
sha256sum "${BACKUP_FILE}" | cut -d' ' -f1 > "${CHECKSUM_FILE}"
echo "[backup] sha256: $(cat "${CHECKSUM_FILE}")"

# 3. Subir a MinIO.
OBJECT_KEY="backups/${TIMESTAMP}.sql.gz"
curl -sS \
  -X PUT \
  -H "Content-Type: application/gzip" \
  -H "x-amz-meta-sha256: $(cat "${CHECKSUM_FILE}")" \
  -H "x-amz-meta-timestamp: ${TIMESTAMP}" \
  -H "x-amz-meta-host: $(hostname)" \
  --data-binary "@${BACKUP_FILE}" \
  "http://${MINIO_HOST}/${MINIO_BUCKET}/${OBJECT_KEY}" \
  -H "Authorization: AWS ${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}"

echo "[backup] Subido a MinIO: ${MINIO_BUCKET}/${OBJECT_KEY}"

# 4. Limpiar backups viejos (conservar últimos 30 días).
CUTOFF=$(date -u -d '30 days ago' +%Y%m%dT%H%M%SZ)
echo "[backup] Limpiando backups anteriores a ${CUTOFF}..."

# Listar objetos y borrar los viejos (requiere mc o aws-cli; si no, omite).
if command -v mc &>/dev/null; then
  mc alias set contable-backup "http://${MINIO_HOST}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" --api S3v4
  mc ls "contable-backup/${MINIO_BUCKET}/backups/" | while read -r _ _ _ _ name; do
    obj_date=$(echo "${name}" | sed 's/contable-backup-//;s/\.sql\.gz//')
    if [[ "${obj_date}" < "${CUTOFF}" ]]; then
      mc rm "contable-backup/${MINIO_BUCKET}/backups/${name}"
      echo "[backup] Eliminado backup viejo: ${name}"
    fi
  done
else
  echo "[backup] mc no disponible, omitiendo limpieza de backups viejos"
fi

# 5. Limpiar archivos temporales.
rm -f "${BACKUP_FILE}" "${CHECKSUM_FILE}"

echo "[backup] Backup completado exitosamente: ${TIMESTAMP}"