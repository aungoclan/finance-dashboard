-- Finance Dashboard V2.2
-- Security, Relationships, Indexes, Triggers Read-Only Script
--
-- SAFE TO RUN.
-- This file only reads database metadata.
--
-- It does NOT create, alter, update, insert, delete, truncate, or drop anything.

-- =========================================================
-- 1. Primary keys, foreign keys, unique constraints, checks
-- =========================================================

select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  case con.contype
    when 'p' then 'PRIMARY KEY'
    when 'f' then 'FOREIGN KEY'
    when 'u' then 'UNIQUE'
    when 'c' then 'CHECK'
    when 'x' then 'EXCLUSION'
    else con.contype::text
  end as constraint_type,
  pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint con
join pg_class c
  on c.oid = con.conrelid
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'accounts',
    'assets',
    'investment_transactions',
    'price_quotes',
    'cashflow_entries',
    'budgets',
    'asset_accounts',
    'liabilities',
    'bills',
    'financial_goals',
    'import_jobs',
    'net_worth_snapshots',
    'user_settings'
  )
order by c.relname, con.contype, con.conname;

-- =========================================================
-- 2. Foreign key relationships
-- =========================================================

select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  ccu.table_schema as foreign_table_schema,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  tc.constraint_name
from information_schema.table_constraints as tc
join information_schema.key_column_usage as kcu
  on tc.constraint_name = kcu.constraint_name
  and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage as ccu
  on ccu.constraint_name = tc.constraint_name
  and ccu.table_schema = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and tc.table_schema = 'public'
  and tc.table_name in (
    'profiles',
    'accounts',
    'assets',
    'investment_transactions',
    'price_quotes',
    'cashflow_entries',
    'budgets',
    'asset_accounts',
    'liabilities',
    'bills',
    'financial_goals',
    'import_jobs',
    'net_worth_snapshots',
    'user_settings'
  )
order by tc.table_name, kcu.column_name;

-- =========================================================
-- 3. Indexes
-- =========================================================

select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles',
    'accounts',
    'assets',
    'investment_transactions',
    'price_quotes',
    'cashflow_entries',
    'budgets',
    'asset_accounts',
    'liabilities',
    'bills',
    'financial_goals',
    'import_jobs',
    'net_worth_snapshots',
    'user_settings'
  )
order by tablename, indexname;

-- =========================================================
-- 4. RLS enabled check
-- =========================================================

select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles',
    'accounts',
    'assets',
    'investment_transactions',
    'price_quotes',
    'cashflow_entries',
    'budgets',
    'asset_accounts',
    'liabilities',
    'bills',
    'financial_goals',
    'import_jobs',
    'net_worth_snapshots',
    'user_settings'
  )
order by tablename;

-- =========================================================
-- 5. RLS policies
-- =========================================================

select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'accounts',
    'assets',
    'investment_transactions',
    'price_quotes',
    'cashflow_entries',
    'budgets',
    'asset_accounts',
    'liabilities',
    'bills',
    'financial_goals',
    'import_jobs',
    'net_worth_snapshots',
    'user_settings'
  )
order by tablename, policyname;

-- =========================================================
-- 6. Triggers
-- =========================================================

select
  event_object_schema as table_schema,
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in (
    'profiles',
    'accounts',
    'assets',
    'investment_transactions',
    'price_quotes',
    'cashflow_entries',
    'budgets',
    'asset_accounts',
    'liabilities',
    'bills',
    'financial_goals',
    'import_jobs',
    'net_worth_snapshots',
    'user_settings'
  )
order by event_object_table, trigger_name;

-- =========================================================
-- 7. Public functions
-- This helps document trigger functions and helper functions.
-- =========================================================

select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  l.lanname as language_name
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
join pg_language l
  on l.oid = p.prolang
where n.nspname = 'public'
order by p.proname;

-- =========================================================
-- 8. Full public function definitions
-- This can return long output.
-- Useful for copying function definitions into a backup note.
-- =========================================================

select
  p.proname as function_name,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;