# Supabase Schema Backup Guide

This folder is for backing up the database structure of Finance Dashboard V2.2.

This is NOT a migration folder.

Nothing in this folder should modify the live database unless clearly stated.

---

## Purpose

CSV export only backs up table data.

CSV usually does not fully preserve:

- Table definitions
- Column data types
- Default values
- Primary keys
- Foreign keys
- Indexes
- RLS policies
- Triggers
- Functions
- Relationships between tables

For a full recovery into a new Supabase project, you should keep both:

1. Code backup
2. Data backup
3. Schema backup

---

## Current App Tables

The current app depends on these public tables:

```txt
profiles
accounts
assets
investment_transactions
price_quotes
cashflow_entries
budgets
asset_accounts
liabilities
bills
financial_goals
import_jobs
net_worth_snapshots
user_settings