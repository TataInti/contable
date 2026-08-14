-- G0-07: lease, retry, reclaim y dead-letter en el outbox.
-- - Agrega deadLetterAt/deadLetterReason para eventos que agotaron intentos.
-- - app_claim_outbox ahora reclama eventos PROCESSING con lease vencido (reclaim).
-- - app_fail_outbox mueve a DEAD_LETTER tras el máximo de intentos.

ALTER TABLE "outbox_events"
  ADD COLUMN IF NOT EXISTS "deadLetterAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deadLetterReason" TEXT;

-- Reclaim: recupera PROCESSING cuyo lease (lockedAt) venció hace más de 5 minutos.
-- Nota: availableAt/lockedAt se insertan con now() (UTC, timestamp sin zona) vía
-- Prisma. now() devuelve timestamp con zona local (-03). Para comparar correctamente
-- se convierte now() a UTC sin zona con "AT TIME ZONE 'UTC'".
CREATE OR REPLACE FUNCTION app_claim_outbox(target_limit integer DEFAULT 25)
RETURNS TABLE(id text, topic text, "eventType" text, "aggregateId" text, payload jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT o.id FROM outbox_events o
    WHERE (
      -- Pendientes o reintentables
      (o.status IN ('PENDING','FAILED') AND o."availableAt"<=(now() AT TIME ZONE 'UTC') AND o.attempts<10)
      -- Reclaim: PROCESSING con lease vencido (worker caído)
      OR (o.status='PROCESSING' AND o."lockedAt" IS NOT NULL AND o."lockedAt" < (now() AT TIME ZONE 'UTC') - interval '5 minutes')
    )
    ORDER BY o."createdAt" FOR UPDATE SKIP LOCKED LIMIT target_limit
  ), updated AS (
    UPDATE outbox_events o SET status='PROCESSING', "lockedAt"=CURRENT_TIMESTAMP, attempts=o.attempts+1
    FROM claimed c WHERE o.id=c.id
    RETURNING o.id, o.topic, o."eventType", o."aggregateId", o.payload
  ) SELECT * FROM updated;
END $$;

-- Dead-letter: tras el máximo de intentos, marca DEAD_LETTER en vez de reintentar.
CREATE OR REPLACE FUNCTION app_fail_outbox(target_id text, target_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE outbox_events SET
    status = CASE WHEN attempts >= 10 THEN 'DEAD_LETTER' ELSE 'FAILED' END,
    "lockedAt" = NULL,
    "lastError" = left(target_error,1000),
    "deadLetterAt" = CASE WHEN attempts >= 10 THEN (now() AT TIME ZONE 'UTC') ELSE NULL END,
    "deadLetterReason" = CASE WHEN attempts >= 10 THEN left(target_error,1000) ELSE NULL END,
    "availableAt" = (now() AT TIME ZONE 'UTC') + make_interval(secs => LEAST(300, power(2, attempts)::integer))
  WHERE id=target_id
$$;

REVOKE ALL ON FUNCTION app_claim_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_fail_outbox(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_claim_outbox(integer), app_fail_outbox(text,text) TO contable_runtime;