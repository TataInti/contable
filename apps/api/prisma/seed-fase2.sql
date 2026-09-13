-- Seed de prueba para validar aislamiento RLS (Fase 2)
-- Crea dos firmas con clientes y miembros de prueba.
-- Uso: psql -h localhost -U contable -d contable -f prisma/seed-fase2.sql
-- Idempotente: evita duplicados por email/CUIT.

-- Usuarios
INSERT INTO users (id, "emailNormalized", name, "passwordHash", status, "updatedAt")
SELECT '11111111-1111-4111-8111-111111111111', 'owner.a@example.com', 'Owner A', 'hash', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '11111111-1111-4111-8111-111111111111' OR "emailNormalized" = 'owner.a@example.com');

INSERT INTO users (id, "emailNormalized", name, "passwordHash", status, "updatedAt")
SELECT '22222222-2222-4222-8222-222222222222', 'owner.b@example.com', 'Owner B', 'hash', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '22222222-2222-4222-8222-222222222222' OR "emailNormalized" = 'owner.b@example.com');

INSERT INTO users (id, "emailNormalized", name, "passwordHash", status, "updatedAt")
SELECT '33333333-3333-4333-8333-333333333333', 'preparer.a@example.com', 'Preparer A', 'hash', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = '33333333-3333-4333-8333-333333333333' OR "emailNormalized" = 'preparer.a@example.com');

-- Firmas
INSERT INTO firms (id, "legalName", "displayName", status, "updatedAt")
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Estudio Alfa', 'Alfa', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM firms WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

INSERT INTO firms (id, "legalName", "displayName", status, "updatedAt")
SELECT 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Estudio Beta', 'Beta', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM firms WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- Membresías
INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "acceptedAt")
SELECT 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'OWNER', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM firm_memberships WHERE "firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND "userId" = '11111111-1111-4111-8111-111111111111');

INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "acceptedAt")
SELECT 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'OWNER', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM firm_memberships WHERE "firmId" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND "userId" = '22222222-2222-4222-8222-222222222222');

INSERT INTO firm_memberships (id, "firmId", "userId", role, status, "acceptedAt")
SELECT 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'PREPARER', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM firm_memberships WHERE "firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND "userId" = '33333333-3333-4333-8333-333333333333');

-- Clientes
INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '11111111-2222-4333-8444-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Alfa Uno', '20111111111', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '11111111-2222-4333-8444-555555555555' OR ("firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND cuit = '20111111111'));

INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '11111111-2222-4333-8444-666666666666', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Alfa Dos', '20111111112', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '11111111-2222-4333-8444-666666666666' OR ("firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND cuit = '20111111112'));

INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '11111111-2222-4333-8444-777777777777', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Alfa Tres', '20111111113', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '11111111-2222-4333-8444-777777777777' OR ("firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND cuit = '20111111113'));

INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '11111111-2222-4333-8444-888888888888', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Alfa Cuatro', '20111111114', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '11111111-2222-4333-8444-888888888888' OR ("firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND cuit = '20111111114'));

INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '11111111-2222-4333-8444-999999999999', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Alfa Cinco', '20111111115', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '11111111-2222-4333-8444-999999999999' OR ("firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND cuit = '20111111115'));

INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '11111111-2222-4333-8444-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Alfa Seis', '20111111116', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '11111111-2222-4333-8444-000000000000' OR ("firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND cuit = '20111111116'));

INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '11111111-2222-4333-8444-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Cliente Alfa Siete', '20111111117', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '11111111-2222-4333-8444-111111111111' OR ("firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND cuit = '20111111117'));

INSERT INTO clients (id, "firmId", "legalName", cuit, status, "updatedAt")
SELECT '22222222-3333-4444-8555-777777777777', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Cliente Beta Uno', '20222222222', 'ACTIVE', now()
WHERE NOT EXISTS (SELECT 1 FROM clients WHERE id = '22222222-3333-4444-8555-777777777777' OR ("firmId" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND cuit = '20222222222'));

-- Asignación: Preparer A al cliente Alfa Uno
INSERT INTO client_assignments (id, "firmId", "userId", "clientId")
SELECT 'ffffffff-ffff-4fff-8fff-ffffffffffff', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', '11111111-2222-4333-8444-555555555555'
WHERE NOT EXISTS (SELECT 1 FROM client_assignments WHERE "firmId" = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND "userId" = '33333333-3333-4333-8333-333333333333' AND "clientId" = '11111111-2222-4333-8444-555555555555');
