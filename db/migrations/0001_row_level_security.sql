-- Grants, row-level security and policies. Written by hand so they are easy to review.

-- The runtime role must not be able to create a relation, temporary ones included.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
END
$$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_runtime;
--> statement-breakpoint

GRANT SELECT ON tenants, users, memberships, tenant_modules TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON students, invoices TO app_runtime;
--> statement-breakpoint

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_modules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenant_modules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE students FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Tenant data: one policy for reads and writes, for every role including the owner.
CREATE POLICY tenant_isolation ON students
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invoices
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant_modules
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- A school sees its own tenant row.
CREATE POLICY own_tenant ON tenants FOR SELECT
  USING (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- A user sees their own row and their own memberships. The membership lookup
-- runs before the tenant is confirmed, so it cannot depend on app.tenant_id.
CREATE POLICY own_user ON users FOR SELECT
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY own_memberships ON memberships FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint

-- Provisioning: only the owner role creates schools, users and memberships.
-- The runtime role has no INSERT privilege on these tables.
CREATE POLICY provisioning_insert ON tenants FOR INSERT TO app_owner WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY provisioning_insert ON users FOR INSERT TO app_owner WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY provisioning_insert ON memberships FOR INSERT TO app_owner WITH CHECK (true);
