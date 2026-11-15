CREATE TABLE "hijri_month_overrides" (
	"country" char(2) NOT NULL,
	"hijri_year" smallint NOT NULL,
	"hijri_month" smallint NOT NULL,
	"starts_on" date NOT NULL,
	CONSTRAINT "hijri_month_overrides_country_hijri_year_hijri_month_pk" PRIMARY KEY("country","hijri_year","hijri_month"),
	CONSTRAINT "hijri_month_overrides_year" CHECK ("hijri_month_overrides"."hijri_year" between 1300 and 1600),
	CONSTRAINT "hijri_month_overrides_month" CHECK ("hijri_month_overrides"."hijri_month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" char(2) PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "name_i18n" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "country" char(2);--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "number" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issued_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "issue_date" date NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "description" jsonb;--> statement-breakpoint
ALTER TABLE "hijri_month_overrides" ADD CONSTRAINT "hijri_month_overrides_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_country_countries_code_fk" FOREIGN KEY ("country") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_number_unique" UNIQUE("tenant_id","number");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_name_i18n" CHECK ("tenants"."name_i18n" is null or case
        when jsonb_typeof("tenants"."name_i18n") <> 'object' then false
        else "tenants"."name_i18n" <> '{}'::jsonb
         and "tenants"."name_i18n" - 'ar' - 'en' = '{}'::jsonb
         and ("tenants"."name_i18n" -> 'ar' is null
       or (jsonb_typeof("tenants"."name_i18n" -> 'ar') = 'string'
           and btrim("tenants"."name_i18n" ->> 'ar') <> ''))
         and ("tenants"."name_i18n" -> 'en' is null
       or (jsonb_typeof("tenants"."name_i18n" -> 'en') = 'string'
           and btrim("tenants"."name_i18n" ->> 'en') <> ''))
      end);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_due_date" CHECK ("invoices"."due_date" >= "invoices"."issue_date");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_description" CHECK ("invoices"."description" is null or case
        when jsonb_typeof("invoices"."description") <> 'object' then false
        else "invoices"."description" <> '{}'::jsonb
         and "invoices"."description" - 'ar' - 'en' = '{}'::jsonb
         and ("invoices"."description" -> 'ar' is null
       or (jsonb_typeof("invoices"."description" -> 'ar') = 'string'
           and btrim("invoices"."description" ->> 'ar') <> ''))
         and ("invoices"."description" -> 'en' is null
       or (jsonb_typeof("invoices"."description" -> 'en') = 'string'
           and btrim("invoices"."description" ->> 'en') <> ''))
      end);