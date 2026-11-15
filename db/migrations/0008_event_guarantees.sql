-- Catalog rows, the timezone and module-switch triggers, grants, row-level
-- security and policies for admissions and events, and the queue's schema.
-- Written by hand.

-- Catalog rows that must exist in every environment.
INSERT INTO modules (key) VALUES ('admissions');
--> statement-breakpoint
INSERT INTO permissions (key) VALUES ('admissions:accept');
--> statement-breakpoint
INSERT INTO role_permissions (role, permission) VALUES ('school_admin', 'admissions:accept');
--> statement-breakpoint

-- A school's timezone is a name from the IANA database, spelled as it is there.
-- An offset or a POSIX rule would not follow the school through a law change.
CREATE FUNCTION tenants_timezone_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.timezone IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION '"%" is not an IANA time zone name', NEW.timezone;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenants_timezone BEFORE INSERT OR UPDATE OF timezone ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_timezone_check();
--> statement-breakpoint

-- Switching a module takes this lock exclusively, whoever does it. An event
-- handler takes it shared before it reads whether the module is on, so a
-- switch and a routing decision wait for each other. It is an advisory lock
-- because a school with no row for a module has no row to lock.
CREATE FUNCTION tenant_modules_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(OLD.tenant_id::text || ':module:' || OLD.module, 0));
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.tenant_id::text || ':module:' || NEW.module, 0));
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER tenant_modules_lock BEFORE INSERT OR UPDATE OR DELETE ON tenant_modules
  FOR EACH ROW EXECUTE FUNCTION tenant_modules_lock();
--> statement-breakpoint

-- Applications are created by provisioning. The runtime role accepts them.
GRANT SELECT ON admission_applications TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, student_id, accepted_at, accepted_by) ON admission_applications TO app_runtime;
--> statement-breakpoint

-- The runtime role appends events and names nothing but the type and the
-- payload: the school, the actor and the time come from the transaction, and
-- it cannot write an event that is already marked dispatched.
GRANT SELECT ON outbox_events TO app_runtime;
--> statement-breakpoint
GRANT INSERT (type, payload) ON outbox_events TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON processed_events, webhook_attempts TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON webhook_deliveries TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, finished_at) ON webhook_deliveries TO app_runtime;
--> statement-breakpoint
-- Endpoints, their secrets and the fee are provisioned by the owner.
GRANT SELECT ON webhook_endpoints, registration_fees TO app_runtime;
--> statement-breakpoint

-- The dispatcher's whole reach: which event belongs to which school, and the
-- one column it sets. It cannot read a payload, a type or an actor.
GRANT USAGE ON SCHEMA public TO app_dispatcher;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, created_at, dispatched_at) ON outbox_events TO app_dispatcher;
--> statement-breakpoint
GRANT UPDATE (dispatched_at) ON outbox_events TO app_dispatcher;
--> statement-breakpoint

ALTER TABLE admission_applications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admission_applications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE processed_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE processed_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_endpoints FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_attempts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE registration_fees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE registration_fees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY tenant_isolation ON admission_applications
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON outbox_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON processed_events
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_endpoints
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON webhook_attempts
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON registration_fees
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- A delivery can be updated only while it is pending, so delivered and failed
-- are final for every role.
CREATE POLICY tenant_read ON webhook_deliveries FOR SELECT
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_insert ON webhook_deliveries FOR INSERT
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY pending_update ON webhook_deliveries FOR UPDATE
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
         AND status = 'pending')
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- The only read across schools in the database. It applies to the dispatcher
-- role alone, and the column grants above limit what it returns.
CREATE POLICY dispatcher_read ON outbox_events FOR SELECT TO app_dispatcher
  USING (true);
--> statement-breakpoint
-- An event is marked dispatched once and never unmarked.
CREATE POLICY dispatcher_mark ON outbox_events FOR UPDATE TO app_dispatcher
  USING (dispatched_at IS NULL)
  WITH CHECK (dispatched_at IS NOT NULL);
--> statement-breakpoint

-- pg-boss installs and migrates its own tables here when the worker starts.
-- No other role is given anything in this schema.
CREATE SCHEMA pgboss;
--> statement-breakpoint
GRANT USAGE, CREATE ON SCHEMA pgboss TO app_queue;
