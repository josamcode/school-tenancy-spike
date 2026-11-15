CREATE TABLE "admission_applications" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"applicant_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"student_id" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	CONSTRAINT "admission_applications_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "admission_applications_tenant_id_student_id_unique" UNIQUE("tenant_id","student_id"),
	CONSTRAINT "admission_applications_status" CHECK ("admission_applications"."status" in ('pending', 'accepted')),
	CONSTRAINT "admission_applications_accepted" CHECK (("admission_applications"."status" = 'accepted') = ("admission_applications"."student_id" is not null)
          and ("admission_applications"."status" = 'accepted') = ("admission_applications"."accepted_at" is not null)
          and ("admission_applications"."status" = 'accepted') = ("admission_applications"."accepted_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_user_id" uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "outbox_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "outbox_events_type" CHECK ("outbox_events"."type" in ('student.accepted'))
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_tenant_id_event_id_pk" PRIMARY KEY("tenant_id","event_id"),
	CONSTRAINT "processed_events_handler" CHECK ("processed_events"."handler" in ('finance', 'webhook'))
);
--> statement-breakpoint
CREATE TABLE "webhook_attempts" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"response_status" integer,
	"error" text,
	CONSTRAINT "webhook_attempts_tenant_id_event_id_attempt_no_pk" PRIMARY KEY("tenant_id","event_id","attempt_no"),
	CONSTRAINT "webhook_attempts_outcome" CHECK (("webhook_attempts"."response_status" is null) <> ("webhook_attempts"."error" is null))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "webhook_deliveries_tenant_id_event_id_pk" PRIMARY KEY("tenant_id","event_id"),
	CONSTRAINT "webhook_deliveries_status" CHECK ("webhook_deliveries"."status" in ('pending', 'delivered', 'failed')),
	CONSTRAINT "webhook_deliveries_finished" CHECK (("webhook_deliveries"."status" = 'pending') = ("webhook_deliveries"."finished_at" is null))
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"tenant_id" uuid PRIMARY KEY DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registration_fees" (
	"tenant_id" uuid PRIMARY KEY DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"amount" numeric(19, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"receivable_account_id" uuid NOT NULL,
	"income_account_id" uuid NOT NULL,
	CONSTRAINT "registration_fees_positive" CHECK ("registration_fees"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_kind";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "timezone" text NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission_applications" ADD CONSTRAINT "admission_applications_tenant_id_student_id_students_tenant_id_id_fk" FOREIGN KEY ("tenant_id","student_id") REFERENCES "public"."students"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_tenant_id_event_id_outbox_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."outbox_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_attempts" ADD CONSTRAINT "webhook_attempts_tenant_id_event_id_webhook_deliveries_tenant_id_event_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."webhook_deliveries"("tenant_id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_event_id_processed_events_tenant_id_event_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."processed_events"("tenant_id","event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_fees" ADD CONSTRAINT "registration_fees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_fees" ADD CONSTRAINT "registration_fees_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_fees" ADD CONSTRAINT "registration_fees_receivable_fk" FOREIGN KEY ("tenant_id","receivable_account_id","currency") REFERENCES "public"."ledger_accounts"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_fees" ADD CONSTRAINT "registration_fees_income_fk" FOREIGN KEY ("tenant_id","income_account_id","currency") REFERENCES "public"."ledger_accounts"("tenant_id","id","currency") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_undispatched" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."dispatched_at" is null;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_kind" CHECK ("ledger_entries"."kind" in ('invoice', 'discount', 'late_fee', 'payment', 'refund', 'fx_conversion', 'fx_revaluation', 'reversal', 'adjustment', 'registration_fee'));