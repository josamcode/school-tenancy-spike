-- Grants, row-level security and the policy for event_failures. Written by hand.

-- The runtime role records a failure and names only the event and the error.
-- The school and the time come from the transaction. It cannot change or
-- delete a failure.
GRANT SELECT ON event_failures TO app_runtime;
--> statement-breakpoint
GRANT INSERT (event_id, error) ON event_failures TO app_runtime;
--> statement-breakpoint

ALTER TABLE event_failures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE event_failures FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON event_failures
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
