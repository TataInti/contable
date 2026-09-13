#!/bin/sh
set -eu

: "${RUNTIME_DB_PASSWORD:?RUNTIME_DB_PASSWORD is required}"
: "${WORKER_DB_PASSWORD:?WORKER_DB_PASSWORD is required}"

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set=ON_ERROR_STOP=1 \
  --set=runtime_password="$RUNTIME_DB_PASSWORD" \
  --set=worker_password="$WORKER_DB_PASSWORD" <<'SQL'
SELECT format(
  'CREATE ROLE contable_runtime LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  :'runtime_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contable_runtime')
\gexec

SELECT format(
  'CREATE ROLE contable_worker LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
  :'worker_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'contable_worker')
\gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO contable_runtime, contable_worker',
  current_database()
)
\gexec
GRANT USAGE ON SCHEMA public TO contable_runtime, contable_worker;
SQL
