-- Fix: la migración 20260821000000_tax_credit_lot_history creó la tabla sin
-- GRANT al rol runtime (patrón estándar de todas las migraciones). Sin él,
-- verificar un saldo (que audita en el historial) fallaba con 42501.

GRANT SELECT, INSERT, UPDATE, DELETE ON tax_credit_lot_history TO contable_runtime;
