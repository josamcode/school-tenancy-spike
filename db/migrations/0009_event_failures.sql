CREATE TABLE "event_failures" (
	"tenant_id" uuid DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text NOT NULL,
	CONSTRAINT "event_failures_tenant_id_event_id_pk" PRIMARY KEY("tenant_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "event_failures" ADD CONSTRAINT "event_failures_tenant_id_event_id_outbox_events_tenant_id_id_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."outbox_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;