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
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
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
