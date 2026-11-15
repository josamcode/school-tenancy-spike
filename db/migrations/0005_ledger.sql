CREATE TABLE "currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"minor_units" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_settings" (
	"tenant_id" uuid PRIMARY KEY DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"base_currency" char(3) NOT NULL,
	CONSTRAINT "finance_settings_tenant_id_base_currency_unique" UNIQUE("tenant_id","base_currency")
);
--> statement-breakpoint
CREATE TABLE "financial_years" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	CONSTRAINT "financial_years_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "financial_years_dates" CHECK ("financial_years"."end_date" >= "financial_years"."start_date")
);
--> statement-breakpoint
CREATE TABLE "fx_positions" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"base_currency" char(3) NOT NULL,
	"foreign_account_id" uuid NOT NULL,
	"base_account_id" uuid NOT NULL,
	"gain_loss_account_id" uuid NOT NULL,
	CONSTRAINT "fx_positions_tenant_id_currency_pk" PRIMARY KEY("tenant_id","currency"),
	CONSTRAINT "fx_positions_tenant_id_foreign_account_id_unique" UNIQUE("tenant_id","foreign_account_id"),
	CONSTRAINT "fx_positions_tenant_id_base_account_id_unique" UNIQUE("tenant_id","base_account_id"),
	CONSTRAINT "fx_positions_foreign" CHECK ("fx_positions"."currency" <> "fx_positions"."base_currency")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"rate_date" date NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	CONSTRAINT "fx_rates_tenant_id_currency_rate_date_pk" PRIMARY KEY("tenant_id","currency","rate_date"),
	CONSTRAINT "fx_rates_positive" CHECK ("fx_rates"."rate" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"currency" char(3) NOT NULL,
	"is_control" boolean DEFAULT false NOT NULL,
	CONSTRAINT "ledger_accounts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ledger_accounts_tenant_id_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "ledger_accounts_tenant_id_id_currency_unique" UNIQUE("tenant_id","id","currency"),
	CONSTRAINT "ledger_accounts_type" CHECK ("ledger_accounts"."type" in ('asset', 'liability', 'equity', 'income', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"period_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"invoice_id" uuid,
	"reverses_entry_id" uuid,
	"fx_currency" char(3),
	"fx_rate" numeric(18, 8),
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"posted_by" uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
	"posted_txid" bigint DEFAULT txid_current() NOT NULL,
	CONSTRAINT "ledger_entries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ledger_entries_tenant_id_reverses_entry_id_unique" UNIQUE("tenant_id","reverses_entry_id"),
	CONSTRAINT "ledger_entries_kind" CHECK ("ledger_entries"."kind" in ('invoice', 'discount', 'late_fee', 'payment', 'refund', 'fx_conversion', 'fx_revaluation', 'reversal', 'adjustment')),
	CONSTRAINT "ledger_entries_fx" CHECK (("ledger_entries"."fx_currency" is null) = ("ledger_entries"."fx_rate" is null))
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"student_id" uuid,
	CONSTRAINT "ledger_lines_tenant_id_entry_id_line_no_pk" PRIMARY KEY("tenant_id","entry_id","line_no"),
	CONSTRAINT "ledger_lines_not_zero" CHECK ("ledger_lines"."amount" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_periods" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"year_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"locked_at" timestamp with time zone,
	CONSTRAINT "ledger_periods_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "ledger_periods_dates" CHECK ("ledger_periods"."end_date" >= "ledger_periods"."start_date"),
	CONSTRAINT "ledger_periods_status" CHECK ("ledger_periods"."status" in ('open', 'locked'))
);
--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_settings" ADD CONSTRAINT "finance_settings_base_currency_currencies_code_fk" FOREIGN KEY ("base_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_positions" ADD CONSTRAINT "fx_positions_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_positions" ADD CONSTRAINT "fx_positions_base_currency_fk" FOREIGN KEY ("tenant_id","base_currency") REFERENCES "public"."finance_settings"("tenant_id","base_currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_positions" ADD CONSTRAINT "fx_positions_foreign_account_fk" FOREIGN KEY ("tenant_id","foreign_account_id","currency") REFERENCES "public"."ledger_accounts"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_positions" ADD CONSTRAINT "fx_positions_base_account_fk" FOREIGN KEY ("tenant_id","base_account_id","base_currency") REFERENCES "public"."ledger_accounts"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_positions" ADD CONSTRAINT "fx_positions_gain_loss_account_fk" FOREIGN KEY ("tenant_id","gain_loss_account_id","base_currency") REFERENCES "public"."ledger_accounts"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fx_currency_currencies_code_fk" FOREIGN KEY ("fx_currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_period_id_ledger_periods_tenant_id_id_fk" FOREIGN KEY ("tenant_id","period_id") REFERENCES "public"."ledger_periods"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_invoice_id_invoices_tenant_id_id_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_fk" FOREIGN KEY ("tenant_id","reverses_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_tenant_id_entry_id_ledger_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_currency_fk" FOREIGN KEY ("tenant_id","account_id","currency") REFERENCES "public"."ledger_accounts"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_tenant_id_student_id_students_tenant_id_id_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_periods" ADD CONSTRAINT "ledger_periods_tenant_id_year_id_financial_years_tenant_id_id_fk" FOREIGN KEY ("tenant_id","year_id") REFERENCES "public"."financial_years"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_one_per_invoice" ON "ledger_entries" USING btree ("tenant_id","invoice_id") WHERE "ledger_entries"."kind" = 'invoice';