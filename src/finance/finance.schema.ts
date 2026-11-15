import {
  char,
  foreignKey,
  numeric,
  pgTable,
  primaryKey,
  uuid,
} from 'drizzle-orm/pg-core';
import { students } from '../core/core.schema.js';
import { currentTenant } from '../db/current-tenant.js';

export const invoices = pgTable(
  'invoices',
  {
    tenantId: uuid('tenant_id').notNull().default(currentTenant),
    id: uuid().notNull().defaultRandom(),
    studentId: uuid('student_id').notNull(),
    amount: numeric({ precision: 19, scale: 4 }).notNull(),
    currency: char({ length: 3 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Composite, because foreign key checks bypass row-level security.
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
  ],
);
