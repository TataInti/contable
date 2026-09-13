-- C/D (plan piloto fiscal §10 paso 3): el colaborador del cliente carga los
-- documentos de un pedido y el complete liga el documento al ítem (UPDATE de
-- document_request_items) y deriva el estado del pedido (UPDATE de
-- document_requests). Las políticas anteriores bloqueaban todo UPDATE del
-- actor PORTAL, rompiendo el flujo legítimo de respuesta al pedido.
-- El resto de las escrituras del portal sigue bloqueada (INSERT/DELETE).

DROP POLICY IF EXISTS tenant_update ON "document_request_items";
CREATE POLICY tenant_update ON "document_request_items"
    FOR UPDATE
    USING (app_can_access_tenant("firmId", "clientId"))
    WITH CHECK (app_can_access_tenant("firmId", "clientId"));

DROP POLICY IF EXISTS tenant_update ON "document_requests";
CREATE POLICY tenant_update ON "document_requests"
    FOR UPDATE
    USING (app_can_access_tenant("firmId", "clientId"))
    WITH CHECK (app_can_access_tenant("firmId", "clientId"));
