-- ============================================================
-- F0.2: grants de portal para contable_runtime (migración incremental)
--
-- El baseline ya otorgaba CRUD sobre portal_memberships y
-- portal_invitations, pero una base ya migrada puede no tenerlo
-- (el rol runtime no podía gestionar accesos del portal → 500).
-- Esta migración incremental garantiza los grants sin editar
-- migraciones ya aplicadas. Las policies RLS ya cubren a miembros
-- internos y excluyen al actor PORTAL.
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON portal_memberships TO contable_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_invitations TO contable_runtime;

-- El worker necesita leer membresías/invitaciones para resolver
-- destinatarios de notificaciones y eventos de portal.
GRANT SELECT ON portal_memberships TO contable_worker;
GRANT SELECT ON portal_invitations TO contable_worker;