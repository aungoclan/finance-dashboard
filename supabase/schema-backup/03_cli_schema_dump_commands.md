# Supabase CLI Schema Dump Commands

This file documents how to create a real schema-only backup of the Supabase database.

This is the best way to preserve table structure, RLS policies, functions, triggers, indexes, and relationships.

---

## 1. Check Supabase CLI

From the project root, run:

```bash
npx supabase --version