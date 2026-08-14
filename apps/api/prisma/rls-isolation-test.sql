-- ============================================================
-- Test de aislamiento RLS con el rol runtime
-- Verifica que contable_runtime no pueda ver/cruzar datos de otra firma.
--
-- Uso: psql -h localhost -U contable -d contable -f prisma/rls-isolation-test.sql
-- Requiere: rol contable_runtime, firmas y clientes de prueba previamente creados.
-- ============================================================

-- Asume que ya existen usuarios, firmas y clientes de prueba.
-- Si no, crear primero con el seed de Fase 2.

-- 1) Como owner (contable), crear dos firmas y clientes de prueba
-- (se omiten si ya existen; idempotente por verificación)

-- 2) Verificar que el rol runtime no puede saltarse RLS
\echo '=== 1. El rol runtime NO tiene BYPASSRLS ==='
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'contable_runtime';

-- 3) Sin contexto, el runtime no debería ver clientes
\echo '=== 2. Runtime sin contexto no ve clientes ==='
SET ROLE contable_runtime;
SELECT count(*) AS clientes_visibles_sin_contexto FROM clients;
RESET ROLE;

-- 4) Con contexto de una firma, el runtime ve SOLO esa firma
\echo '=== 3. Runtime con contexto ve clientes solo de su firma ==='
SET ROLE contable_runtime;
SELECT set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
SELECT set_config('app.firm_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
SELECT set_config('app.actor_kind', 'USER', false);
SELECT count(*) AS clientes_alfa FROM clients WHERE "firmId" = current_setting('app.firm_id', true);
RESET ROLE;

-- 5) Aislamiento cruzado: Owner A no ve clientes de Beta
\echo '=== 4. Owner A NO ve clientes de Beta (cruce) ==='
SET ROLE contable_runtime;
SELECT set_config('app.user_id', '11111111-1111-4111-8111-111111111111', false);
SELECT set_config('app.firm_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false);
SELECT count(*) AS clientes_beta_visibles FROM clients WHERE "firmId" = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
RESET ROLE;

-- 6) El runtime no puede deshabilitar RLS
\echo '=== 5. Runtime NO puede deshabilitar RLS ==='
SET ROLE contable_runtime;
ALTER TABLE clients DISABLE ROW LEVEL SECURITY;
RESET ROLE;