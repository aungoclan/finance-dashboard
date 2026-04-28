-- Finance Dashboard V2.2
-- Database Inventory Read-Only Script
--
-- SAFE TO RUN.
-- This file only reads database metadata.
--
-- It does NOT create, alter, update, insert, delete, truncate, or drop anything.

-- =========================================================
-- 1. App table list
-- =========================================================

select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in (
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
order by table_name;

-- =========================================================
-- 2. Full column inventory
-- =========================================================

select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default,
  character_maximum_length,
  numeric_precision,
  numeric_scale,
  datetime_precision
from information_schema.columns
where table_schema = 'public'
  and table_name in (
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
order by table_name, ordinal_position;

-- =========================================================
-- 3. Table row estimates
-- This is only an estimate from PostgreSQL statistics.
-- It is safe and fast.
-- =========================================================

select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_rows,
  n_dead_tup as estimated_dead_rows,
  last_vacuum,
  last_autovacuum,
  last_analyze,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
  and relname in (
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
order by relname;

-- =========================================================
-- 4. Public views, if any
-- =========================================================

select
  table_schema,
  table_name as view_name
from information_schema.views
where table_schema = 'public'
order by table_name;

-- =========================================================
-- 5. Extensions
-- =========================================================

select
  extname as extension_name,
  extversion as extension_version
from pg_extension
order by extname;