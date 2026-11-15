-- The permission to read a school's admission applications and what became
-- of an acceptance. Written by hand. A school admin holds it; staff do not.
INSERT INTO permissions (key) VALUES ('admissions:read');
--> statement-breakpoint
INSERT INTO role_permissions (role, permission) VALUES ('school_admin', 'admissions:read');
