# Contable — Runbook operativo (F2.7)

## Health endpoints

| Endpoint | Qué verifica | Esperado |
|---|---|---|
| `GET /health/live` | Proceso vivo | `{"status":"ok"}` |
| `GET /health/ready` | PostgreSQL + Valkey + MinIO + IA | `{"status":"ready","dependencies":{...}}` |
| `GET /health/startup` | Inicialización completada | `{"status":"started"}` |

Si `/health/ready` devuelve 503, revisar `dependencies` para identificar el servicio caído.

## Métricas y logs

- **API**: logs JSON en stdout (Fastify pino). Nivel configurable con `LOG_LEVEL` (default `info`).
- **Worker**: logs en stdout con prefijo `[queue]`. Errores de job incluyen stack trace.
- **Nginx**: access log en stdout, error log en stderr. Rate limits visibles como 429.
- **PostgreSQL**: logs en stderr del contenedor. Slow queries > 200ms visibles con `log_min_duration_statement=200`.

### Comandos de diagnóstico

```bash
# Ver estado de todos los servicios
docker compose -f infra/compose/docker-compose.prod.yml ps

# Logs de la API (últimas 100 líneas)
docker compose -f infra/compose/docker-compose.prod.yml logs --tail=100 api

# Logs del worker
docker compose -f infra/compose/docker-compose.prod.yml logs --tail=100 worker

# Health check rápido
curl -s http://localhost:3000/health/ready | jq .

# Conexiones activas en PostgreSQL
docker compose -f infra/compose/docker-compose.prod.yml exec postgres \
  psql -U contable -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"

# Tamaño de la base de datos
docker compose -f infra/compose/docker-compose.prod.yml exec postgres \
  psql -U contable -c "SELECT pg_database_size('contable') / 1024 / 1024 AS mb;"
```

## Backup y restore

### Backup diario (cron)

```bash
# En el host, agregar a crontab:
# 0 3 * * * /ruta/contable/infra/scripts/backup.sh >> /var/log/contable-backup.log 2>&1
```

El script:
1. Hace `pg_dump` comprimido con checksum SHA-256.
2. Sube a MinIO (bucket `backups`) con metadata (timestamp, host, sha256).
3. Conserva los últimos 30 días.

### Restore

```bash
# Restaurar el backup más reciente:
./infra/scripts/restore.sh latest

# Restaurar un backup específico:
./infra/scripts/restore.sh 20260819T120000Z
```

El restore:
1. Descarga de MinIO.
2. Verifica checksum.
3. Pide confirmación interactiva (`RESTAURAR`).
4. Aplica `pg_restore` + migraciones pendientes.

### Restore drill (trimestral)

1. Levantar entorno aislado con `docker compose -f infra/compose/docker-compose.prod.yml` (puertos distintos).
2. Ejecutar `./infra/scripts/restore.sh latest`.
3. Verificar `/health/ready` verde.
4. Validar que los datos del último período cerrado coincidan con el hash de cierre.

## Recuperación de servicios

### PostgreSQL no arranca

```bash
# Ver logs
docker compose -f infra/compose/docker-compose.prod.yml logs postgres

# Verificar espacio en disco
df -h /var/lib/docker/volumes/contable-prod_pgdata

# Si hay corrupción: restore desde backup
./infra/scripts/restore.sh latest
```

### Valkey no responde

```bash
# Reiniciar (los datos en Valkey son efímeros, el outbox está en PostgreSQL)
docker compose -f infra/compose/docker-compose.prod.yml restart valkey
```

### Worker no procesa jobs

```bash
# Verificar dead-letter queue
docker compose -f infra/compose/docker-compose.prod.yml exec postgres \
  psql -U contable_runtime -d contable \
  -c "SELECT id, topic, status, attempts, "deadLetterAt", "deadLetterReason" FROM outbox_events WHERE status='DEAD_LETTER' ORDER BY "createdAt" DESC LIMIT 20;"

# Reencolar jobs muertos (sólo si la causa está resuelta):
# UPDATE outbox_events SET status='PENDING', attempts=0, "deadLetterAt"=NULL, "deadLetterReason"=NULL WHERE status='DEAD_LETTER';
```

### IA no responde

```bash
# Verificar health del servicio AI
curl -s http://ai:8000/health/ready

# Si está caído, la API sigue funcionando (la IA es asíncrona vía worker).
# Los documentos quedan en cola y se procesan cuando el servicio vuelve.
```

## Alertas mínimas

| Condición | Severidad | Acción |
|---|---|---|
| `/health/ready` != 200 | CRÍTICA | Verificar dependencia caída |
| Dead-letter queue > 0 | ALTA | Revisar jobs fallidos, reencolar si corresponde |
| Disco PostgreSQL > 80% | MEDIA | Limpiar backups viejos, expandir volumen |
| Rate limit 429 en login | MEDIA | Posible ataque de fuerza bruta, revisar logs |
| Worker sin procesar > 5 min | MEDIA | Reiniciar worker |

## Mantenimiento programado

### Actualización de imágenes

```bash
# 1. Build local
docker compose -f infra/compose/docker-compose.prod.yml build api worker web

# 2. Backup previo
./infra/scripts/backup.sh

# 3. Deploy con rolling restart
docker compose -f infra/compose/docker-compose.prod.yml up -d --no-deps api worker web

# 4. Verificar health
curl -s http://localhost:3000/health/ready | jq .
```

### Rotación de secretos

1. Generar nuevos secretos (openssl rand -hex 32).
2. Actualizar variables de entorno.
3. Reiniciar servicios: `docker compose restart api worker ai`.
4. Verificar health.