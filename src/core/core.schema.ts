import { sql } from 'drizzle-orm';
import {
  boolean,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { currentTenant } from '../db/current-tenant.js';

export const tenants = pgTable('tenants', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
});

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
  },
  (t) => [uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`)],
);

// Catalogs. A misspelt permission or role cannot be stored anywhere.
export const permissions = pgTable('permissions', {
  key: text().primaryKey(),
});

export const roles = pgTable('roles', {
  key: text().primaryKey(),
});

// Which permissions a role holds. Global: the same for every school.
export const rolePermissions = pgTable(
  'role_permissions',
  {
    role: text()
      .notNull()
      .references(() => roles.key),
    permission: text()
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [primaryKey({ columns: [t.role, t.permission] })],
);

export const memberships = pgTable(
  'memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .default(currentTenant)
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: text()
      .notNull()
      .references(() => roles.key),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

// One permission in one school for a user who need not be a member of it.
export const grants = pgTable(
  'grants',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .default(currentTenant)
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    permission: text()
      .notNull()
      .references(() => permissions.key),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.permission] })],
);

// A group is an administrative link only. None of these rows gives access to a school.
export const groups = pgTable('groups', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
});

export const groupSchools = pgTable(
  'group_schools',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.tenantId] })],
);

export const groupAdmins = pgTable(
  'group_admins',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

// Catalog of sellable modules. Core is always on and is never listed here.
export const modules = pgTable('modules', {
  key: text().primaryKey(),
});

export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .default(currentTenant)
      .references(() => tenants.id),
    module: text()
      .notNull()
      .references(() => modules.key),
    enabled: boolean().notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.module] })],
);

export const students = pgTable(
  'students',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .default(currentTenant)
      .references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    fullName: text('full_name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
