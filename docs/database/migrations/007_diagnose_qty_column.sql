-- Diagnostic (read-only, no changes made) — run this and share the output.
-- Reveals exactly what depends on transaction_items.qty, so the fix can target the
-- real blocker instead of guessing.

-- 1. Views that reference qty
select table_schema, table_name, view_column_usage.column_name
from information_schema.view_column_usage
where table_name = 'transaction_items' and column_name = 'qty';

-- 2. Is qty itself a generated column, or does another column's generation expression use it?
select column_name, is_generated, generation_expression
from information_schema.columns
where table_name = 'transaction_items';

-- 3. Constraints on transaction_items (check constraints referencing qty would show here)
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.transaction_items'::regclass;

-- 4. Indexes on transaction_items (an index on qty needs no special handling for a type
--    change normally, but worth seeing)
select indexname, indexdef
from pg_indexes
where tablename = 'transaction_items';

-- 5. Current qty column type, to confirm what we're actually starting from
select column_name, data_type, udt_name
from information_schema.columns
where table_name = 'transaction_items' and column_name = 'qty';
