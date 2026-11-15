-- Grants, row-level security and policies for the access tables. Written by hand.

-- The runtime role reads only what the permission check needs. It gets no
-- privilege on permissions, roles, groups, group_schools or group_admins.
GRANT SELECT ON role_permissions, grants TO app_runtime;
--> statement-breakpoint

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Reference data, the same for every school, with no tenant or user column.
CREATE POLICY reference_read ON role_permissions FOR SELECT USING (true);
--> statement-breakpoint

-- A user sees their own grants. Like the membership lookup, this runs before
-- the tenant is confirmed, so it cannot depend on app.tenant_id.
CREATE POLICY own_grants ON grants FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint

-- Provisioning: only the owner role writes memberships, grants and role
-- permissions. Revoking has to find and delete a row, so the insert-only
-- policy on memberships is replaced by a full one.
DROP POLICY provisioning_insert ON memberships;
--> statement-breakpoint
CREATE POLICY provisioning ON memberships TO app_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY provisioning ON grants TO app_owner USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY provisioning ON role_permissions TO app_owner USING (true) WITH CHECK (true);
