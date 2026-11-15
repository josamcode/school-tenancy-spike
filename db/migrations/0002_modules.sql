CREATE TABLE "modules" (
	"key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
-- Added by hand: the catalog rows must exist before the foreign key is created,
-- and in every environment, so they live here and not in the seed.
-- The runtime role gets no privilege on this table.
INSERT INTO "modules" ("key") VALUES ('finance');
--> statement-breakpoint
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_module_modules_key_fk" FOREIGN KEY ("module") REFERENCES "public"."modules"("key") ON DELETE no action ON UPDATE no action;
