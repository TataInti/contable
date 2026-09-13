-- Fix: la tabla outbox_events no tiene default en id (uuid generado por el
-- cliente Prisma); la función debe generar el id explícitamente.

CREATE OR REPLACE FUNCTION app_create_outbox(
    p_firm_id text,
    p_client_id text,
    p_topic text,
    p_event_type text,
    p_aggregate_id text,
    p_payload jsonb
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id text;
BEGIN
    IF p_topic NOT IN ('documents', 'exports', 'notifications', 'recurrences', 'ai', 'maintenance') THEN
        RAISE EXCEPTION 'OUTBOX_TOPIC_NOT_ALLOWED:%', p_topic;
    END IF;
    v_id := 'obx_' || replace(gen_random_uuid()::text, '-', '');
    INSERT INTO outbox_events (
        id, "firmId", "clientId", topic, "eventType", "aggregateId", payload, status, "availableAt"
    ) VALUES (
        v_id, p_firm_id, p_client_id, p_topic, p_event_type, p_aggregate_id, p_payload, 'PENDING', now() AT TIME ZONE 'UTC'
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_create_outbox(text, text, text, text, text, jsonb) TO contable_runtime;
