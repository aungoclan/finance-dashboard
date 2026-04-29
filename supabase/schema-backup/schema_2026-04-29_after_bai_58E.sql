


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."set_cash_wallet_monthly_ledger_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_cash_wallet_monthly_ledger_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_financial_goals_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_financial_goals_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "account_type" "text" NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "asset_class" "text" NOT NULL,
    "current_value" numeric DEFAULT 0 NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."asset_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "symbol" "text" NOT NULL,
    "display_name" "text",
    "asset_type" "text" NOT NULL,
    "currency" "text" DEFAULT 'USD'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_price_locked" boolean DEFAULT false NOT NULL,
    "locked_price" numeric,
    "price_lock_note" "text",
    "price_locked_at" timestamp with time zone
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bills" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text" DEFAULT 'Other'::"text" NOT NULL,
    "amount" numeric DEFAULT 0 NOT NULL,
    "due_day" integer DEFAULT 1 NOT NULL,
    "frequency" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category_id" "uuid"
);


ALTER TABLE "public"."bills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."budgets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "month" integer NOT NULL,
    "year" integer NOT NULL,
    "category" "text" NOT NULL,
    "planned_amount" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category_id" "uuid"
);


ALTER TABLE "public"."budgets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cash_wallet_monthly_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "cash_account_id" "uuid" NOT NULL,
    "month_key" "text" NOT NULL,
    "opening_balance" numeric(14,2) DEFAULT 0 NOT NULL,
    "cash_in" numeric(14,2) DEFAULT 0 NOT NULL,
    "cash_out" numeric(14,2) DEFAULT 0 NOT NULL,
    "expected_closing_balance" numeric(14,2) DEFAULT 0 NOT NULL,
    "actual_cash_count" numeric(14,2),
    "difference" numeric(14,2),
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "note" "text",
    "locked" boolean DEFAULT false NOT NULL,
    "reconciled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cash_wallet_monthly_ledger_month_key_check" CHECK (("month_key" ~ '^\d{4}-\d{2}$'::"text")),
    CONSTRAINT "cash_wallet_monthly_ledger_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reconciled'::"text", 'needs_review'::"text"])))
);


ALTER TABLE "public"."cash_wallet_monthly_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cashflow_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "name_key" "text" GENERATED ALWAYS AS ("lower"(TRIM(BOTH FROM "name"))) STORED,
    "type" "text" DEFAULT 'expense'::"text" NOT NULL,
    "group_name" "text" DEFAULT 'General'::"text",
    "icon" "text" DEFAULT '•'::"text",
    "color" "text" DEFAULT '#64748b'::"text",
    "is_default" boolean DEFAULT false NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "cashflow_categories_type_check" CHECK (("type" = ANY (ARRAY['income'::"text", 'expense'::"text", 'both'::"text"])))
);


ALTER TABLE "public"."cashflow_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."cashflow_entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_id" "uuid",
    "entry_date" "date" NOT NULL,
    "type" "text" NOT NULL,
    "amount" numeric,
    "category" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category_id" "uuid",
    "description" "text"
);


ALTER TABLE "public"."cashflow_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."financial_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "goal_type" "text" DEFAULT 'Other'::"text" NOT NULL,
    "target_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "current_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "target_date" "date",
    "priority" "text" DEFAULT 'Medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "financial_goals_current_amount_check" CHECK (("current_amount" >= (0)::numeric)),
    CONSTRAINT "financial_goals_priority_check" CHECK (("priority" = ANY (ARRAY['High'::"text", 'Medium'::"text", 'Low'::"text"]))),
    CONSTRAINT "financial_goals_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'completed'::"text"]))),
    CONSTRAINT "financial_goals_target_amount_check" CHECK (("target_amount" >= (0)::numeric))
);


ALTER TABLE "public"."financial_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."import_jobs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "source" "text",
    "file_name" "text",
    "total_rows" integer,
    "imported_rows" integer,
    "skipped_rows" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."import_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."investment_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_id" "uuid",
    "asset_id" "uuid",
    "transaction_date" "date" NOT NULL,
    "type" "text" NOT NULL,
    "quantity" numeric,
    "unit_price" numeric,
    "fee" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "funding_account_id" "uuid",
    "cashflow_entry_id" "uuid",
    "cash_sync_enabled" boolean DEFAULT false NOT NULL,
    "cash_sync_direction" "text",
    "cash_sync_amount" numeric(18,2),
    CONSTRAINT "investment_transactions_cash_sync_direction_check" CHECK ((("cash_sync_direction" IS NULL) OR ("cash_sync_direction" = ANY (ARRAY['out'::"text", 'in'::"text"]))))
);


ALTER TABLE "public"."investment_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."liabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "liability_type" "text" NOT NULL,
    "current_balance" numeric DEFAULT 0 NOT NULL,
    "interest_rate" numeric,
    "minimum_payment" numeric,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "due_day" integer,
    "statement_day" integer,
    "default_payment_account_id" "uuid",
    "autopay_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "liabilities_due_day_check" CHECK ((("due_day" IS NULL) OR (("due_day" >= 1) AND ("due_day" <= 31)))),
    CONSTRAINT "liabilities_statement_day_check" CHECK ((("statement_day" IS NULL) OR (("statement_day" >= 1) AND ("statement_day" <= 31))))
);


ALTER TABLE "public"."liabilities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."liability_monthly_statements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "liability_id" "uuid" NOT NULL,
    "month_key" "text" NOT NULL,
    "opening_balance" numeric DEFAULT 0 NOT NULL,
    "new_charges" numeric DEFAULT 0 NOT NULL,
    "interest_charged" numeric DEFAULT 0 NOT NULL,
    "fees" numeric DEFAULT 0 NOT NULL,
    "payments_made" numeric DEFAULT 0 NOT NULL,
    "principal_paid" numeric DEFAULT 0 NOT NULL,
    "closing_balance" numeric DEFAULT 0 NOT NULL,
    "minimum_due" numeric,
    "due_date" "date",
    "statement_date" "date",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "note" "text",
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "liability_monthly_statements_month_key_check" CHECK (("month_key" ~ '^\d{4}-\d{2}$'::"text")),
    CONSTRAINT "liability_monthly_statements_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'partial'::"text", 'paid'::"text", 'closed'::"text", 'needs_review'::"text"])))
);


ALTER TABLE "public"."liability_monthly_statements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."net_worth_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "snapshot_date" "date" NOT NULL,
    "net_worth" numeric DEFAULT 0,
    "total_assets" numeric DEFAULT 0,
    "liabilities" numeric DEFAULT 0,
    "investment_value" numeric DEFAULT 0,
    "created_at" timestamp without time zone DEFAULT "now"()
);


ALTER TABLE "public"."net_worth_snapshots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."price_quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "price" numeric,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."price_quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_settings" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_accounts"
    ADD CONSTRAINT "asset_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_wallet_monthly_ledger"
    ADD CONSTRAINT "cash_wallet_monthly_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cash_wallet_monthly_ledger"
    ADD CONSTRAINT "cash_wallet_monthly_ledger_unique_month" UNIQUE ("user_id", "cash_account_id", "month_key");



ALTER TABLE ONLY "public"."cashflow_categories"
    ADD CONSTRAINT "cashflow_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cashflow_entries"
    ADD CONSTRAINT "cashflow_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."financial_goals"
    ADD CONSTRAINT "financial_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."investment_transactions"
    ADD CONSTRAINT "investment_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."liabilities"
    ADD CONSTRAINT "liabilities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."liability_monthly_statements"
    ADD CONSTRAINT "liability_monthly_statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."liability_monthly_statements"
    ADD CONSTRAINT "liability_monthly_statements_user_id_liability_id_month_key_key" UNIQUE ("user_id", "liability_id", "month_key");



ALTER TABLE ONLY "public"."net_worth_snapshots"
    ADD CONSTRAINT "net_worth_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."price_quotes"
    ADD CONSTRAINT "price_quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."net_worth_snapshots"
    ADD CONSTRAINT "unique_user_date" UNIQUE ("user_id", "snapshot_date");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_key" UNIQUE ("user_id");



CREATE INDEX "bills_category_id_idx" ON "public"."bills" USING "btree" ("category_id");



CREATE INDEX "budgets_category_id_idx" ON "public"."budgets" USING "btree" ("category_id");



CREATE INDEX "cash_wallet_monthly_ledger_account_month_idx" ON "public"."cash_wallet_monthly_ledger" USING "btree" ("cash_account_id", "month_key" DESC);



CREATE INDEX "cash_wallet_monthly_ledger_user_month_idx" ON "public"."cash_wallet_monthly_ledger" USING "btree" ("user_id", "month_key" DESC);



CREATE INDEX "cashflow_categories_user_archived_idx" ON "public"."cashflow_categories" USING "btree" ("user_id", "is_archived");



CREATE UNIQUE INDEX "cashflow_categories_user_name_key_idx" ON "public"."cashflow_categories" USING "btree" ("user_id", "name_key");



CREATE INDEX "cashflow_categories_user_type_idx" ON "public"."cashflow_categories" USING "btree" ("user_id", "type");



CREATE INDEX "cashflow_entries_category_id_idx" ON "public"."cashflow_entries" USING "btree" ("category_id");



CREATE INDEX "cashflow_entries_description_idx" ON "public"."cashflow_entries" USING "btree" ("description");



CREATE INDEX "financial_goals_goal_type_idx" ON "public"."financial_goals" USING "btree" ("goal_type");



CREATE INDEX "financial_goals_status_idx" ON "public"."financial_goals" USING "btree" ("status");



CREATE INDEX "financial_goals_user_id_idx" ON "public"."financial_goals" USING "btree" ("user_id");



CREATE INDEX "idx_investment_transactions_cash_sync_enabled" ON "public"."investment_transactions" USING "btree" ("user_id", "cash_sync_enabled");



CREATE INDEX "idx_investment_transactions_cashflow_entry_id" ON "public"."investment_transactions" USING "btree" ("cashflow_entry_id");



CREATE INDEX "idx_investment_transactions_funding_account_id" ON "public"."investment_transactions" USING "btree" ("funding_account_id");



CREATE INDEX "liability_monthly_statements_liability_idx" ON "public"."liability_monthly_statements" USING "btree" ("liability_id");



CREATE INDEX "liability_monthly_statements_user_month_idx" ON "public"."liability_monthly_statements" USING "btree" ("user_id", "month_key" DESC);



CREATE OR REPLACE TRIGGER "set_cash_wallet_monthly_ledger_updated_at" BEFORE UPDATE ON "public"."cash_wallet_monthly_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."set_cash_wallet_monthly_ledger_updated_at"();



CREATE OR REPLACE TRIGGER "set_cashflow_categories_updated_at" BEFORE UPDATE ON "public"."cashflow_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_financial_goals_updated_at" BEFORE UPDATE ON "public"."financial_goals" FOR EACH ROW EXECUTE FUNCTION "public"."set_financial_goals_updated_at"();



CREATE OR REPLACE TRIGGER "set_user_settings_updated_at" BEFORE UPDATE ON "public"."user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_accounts"
    ADD CONSTRAINT "asset_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."cashflow_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bills"
    ADD CONSTRAINT "bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."cashflow_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."budgets"
    ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_wallet_monthly_ledger"
    ADD CONSTRAINT "cash_wallet_monthly_ledger_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cash_wallet_monthly_ledger"
    ADD CONSTRAINT "cash_wallet_monthly_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cashflow_categories"
    ADD CONSTRAINT "cashflow_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cashflow_entries"
    ADD CONSTRAINT "cashflow_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cashflow_entries"
    ADD CONSTRAINT "cashflow_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."cashflow_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cashflow_entries"
    ADD CONSTRAINT "cashflow_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."financial_goals"
    ADD CONSTRAINT "financial_goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."import_jobs"
    ADD CONSTRAINT "import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."investment_transactions"
    ADD CONSTRAINT "investment_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."investment_transactions"
    ADD CONSTRAINT "investment_transactions_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."investment_transactions"
    ADD CONSTRAINT "investment_transactions_cashflow_entry_id_fkey" FOREIGN KEY ("cashflow_entry_id") REFERENCES "public"."cashflow_entries"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."investment_transactions"
    ADD CONSTRAINT "investment_transactions_funding_account_id_fkey" FOREIGN KEY ("funding_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."investment_transactions"
    ADD CONSTRAINT "investment_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."liabilities"
    ADD CONSTRAINT "liabilities_default_payment_account_id_fkey" FOREIGN KEY ("default_payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."liabilities"
    ADD CONSTRAINT "liabilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."liability_monthly_statements"
    ADD CONSTRAINT "liability_monthly_statements_liability_id_fkey" FOREIGN KEY ("liability_id") REFERENCES "public"."liabilities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."liability_monthly_statements"
    ADD CONSTRAINT "liability_monthly_statements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."net_worth_snapshots"
    ADD CONSTRAINT "net_worth_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_quotes"
    ADD CONSTRAINT "price_quotes_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Allow insert for own user" ON "public"."import_jobs" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Allow select own import jobs" ON "public"."import_jobs" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own bills" ON "public"."bills" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own settings" ON "public"."user_settings" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete their own financial goals" ON "public"."financial_goals" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own bills" ON "public"."bills" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own settings" ON "public"."user_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert their own financial goals" ON "public"."financial_goals" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own snapshots" ON "public"."net_worth_snapshots" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own bills" ON "public"."bills" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own settings" ON "public"."user_settings" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update their own financial goals" ON "public"."financial_goals" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own bills" ON "public"."bills" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own settings" ON "public"."user_settings" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view their own financial goals" ON "public"."financial_goals" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "accounts_delete_own" ON "public"."accounts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "accounts_insert_own" ON "public"."accounts" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "accounts_select_own" ON "public"."accounts" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "accounts_update_own" ON "public"."accounts" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."asset_accounts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_accounts_delete_own" ON "public"."asset_accounts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "asset_accounts_insert_own" ON "public"."asset_accounts" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "asset_accounts_select_own" ON "public"."asset_accounts" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "asset_accounts_update_own" ON "public"."asset_accounts" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assets_insert_authenticated" ON "public"."assets" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "assets_select_all" ON "public"."assets" FOR SELECT USING (true);



ALTER TABLE "public"."bills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."budgets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "budgets_delete_own" ON "public"."budgets" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "budgets_insert_own" ON "public"."budgets" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "budgets_select_own" ON "public"."budgets" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "budgets_update_own" ON "public"."budgets" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cash wallet ledger delete own rows" ON "public"."cash_wallet_monthly_ledger" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cash wallet ledger insert own rows" ON "public"."cash_wallet_monthly_ledger" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "cash wallet ledger select own rows" ON "public"."cash_wallet_monthly_ledger" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cash wallet ledger update own rows" ON "public"."cash_wallet_monthly_ledger" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."cash_wallet_monthly_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."cashflow_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cashflow_categories_delete_own" ON "public"."cashflow_categories" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cashflow_categories_insert_own" ON "public"."cashflow_categories" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "cashflow_categories_select_own" ON "public"."cashflow_categories" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cashflow_categories_update_own" ON "public"."cashflow_categories" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."cashflow_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cashflow_entries_delete_own" ON "public"."cashflow_entries" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cashflow_entries_insert_own" ON "public"."cashflow_entries" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "cashflow_entries_select_own" ON "public"."cashflow_entries" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "cashflow_entries_update_own" ON "public"."cashflow_entries" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."financial_goals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."import_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."investment_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "investment_transactions_delete_own" ON "public"."investment_transactions" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "investment_transactions_insert_own" ON "public"."investment_transactions" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "investment_transactions_select_own" ON "public"."investment_transactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "investment_transactions_update_own" ON "public"."investment_transactions" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."liabilities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "liabilities_delete_own" ON "public"."liabilities" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "liabilities_insert_own" ON "public"."liabilities" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "liabilities_select_own" ON "public"."liabilities" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "liabilities_update_own" ON "public"."liabilities" FOR UPDATE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."liability_monthly_statements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "liability_monthly_statements_delete_own" ON "public"."liability_monthly_statements" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "liability_monthly_statements_insert_own" ON "public"."liability_monthly_statements" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "liability_monthly_statements_select_own" ON "public"."liability_monthly_statements" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "liability_monthly_statements_update_own" ON "public"."liability_monthly_statements" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."net_worth_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."price_quotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "price_quotes_insert_authenticated" ON "public"."price_quotes" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "price_quotes_select_all" ON "public"."price_quotes" FOR SELECT USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert_own" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "profiles_select_own" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles_update_own" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."set_cash_wallet_monthly_ledger_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_cash_wallet_monthly_ledger_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_cash_wallet_monthly_ledger_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_financial_goals_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_financial_goals_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_financial_goals_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON TABLE "public"."asset_accounts" TO "anon";
GRANT ALL ON TABLE "public"."asset_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";



GRANT ALL ON TABLE "public"."bills" TO "anon";
GRANT ALL ON TABLE "public"."bills" TO "authenticated";
GRANT ALL ON TABLE "public"."bills" TO "service_role";



GRANT ALL ON TABLE "public"."budgets" TO "anon";
GRANT ALL ON TABLE "public"."budgets" TO "authenticated";
GRANT ALL ON TABLE "public"."budgets" TO "service_role";



GRANT ALL ON TABLE "public"."cash_wallet_monthly_ledger" TO "anon";
GRANT ALL ON TABLE "public"."cash_wallet_monthly_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."cash_wallet_monthly_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."cashflow_categories" TO "anon";
GRANT ALL ON TABLE "public"."cashflow_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."cashflow_categories" TO "service_role";



GRANT ALL ON TABLE "public"."cashflow_entries" TO "anon";
GRANT ALL ON TABLE "public"."cashflow_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."cashflow_entries" TO "service_role";



GRANT ALL ON TABLE "public"."financial_goals" TO "anon";
GRANT ALL ON TABLE "public"."financial_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."financial_goals" TO "service_role";



GRANT ALL ON TABLE "public"."import_jobs" TO "anon";
GRANT ALL ON TABLE "public"."import_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."import_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."investment_transactions" TO "anon";
GRANT ALL ON TABLE "public"."investment_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."investment_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."liabilities" TO "anon";
GRANT ALL ON TABLE "public"."liabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."liabilities" TO "service_role";



GRANT ALL ON TABLE "public"."liability_monthly_statements" TO "anon";
GRANT ALL ON TABLE "public"."liability_monthly_statements" TO "authenticated";
GRANT ALL ON TABLE "public"."liability_monthly_statements" TO "service_role";



GRANT ALL ON TABLE "public"."net_worth_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."net_worth_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."net_worth_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."price_quotes" TO "anon";
GRANT ALL ON TABLE "public"."price_quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."price_quotes" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."user_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_settings" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







