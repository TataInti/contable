-- C/D fix: creación de eventos de outbox desde la API. El patrón G0-06
-- restringe outbox_events a funciones SECURITY DEFINER; existían
-- claim/complete/fail pero no la creación. Sin ella, cualquier INSERT de
-- outbox desde contable_runtime (p.ej. completar una carga documental del
-- portal o crear una invitación) fallaba con 42501.

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
    INSERT INTO outbox_events (
        "firmId", "clientId", topic, "eventType", "aggregateId", payload, status, "availableAt"
    ) VALUES (
        p_firm_id, p_client_id, p_topic, p_event_type, p_aggregate_id, p_payload, 'PENDING', now() AT TIME ZONE 'UTC'
    ) RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app_create_outbox(text, text, text, text, text, jsonb) TO contable_runtime;
