-- G0-06: corregir grants de outbox_events y relaciones Prisma implícitas.
-- outbox_events es una tabla del cliente (firmId/clientId). El acceso se hace
-- exclusivamente a través de funciones SECURITY DEFINER (app_claim_outbox,
-- app_complete_outbox, app_fail_outbox) que operan como owner.
--
-- El GRANT directo al runtime (20260813000000) permitía acceso sin restricción
-- de tenant. Se revoca: el runtime no debe operar outbox_events directamente.
-- No se habilita RLS FORCE porque rompería las funciones SECURITY DEFINER
-- (el owner no tiene contexto de tenant y FORCE aplica incluso a superusers).

REVOKE ALL ON outbox_events FROM contable_runtime;