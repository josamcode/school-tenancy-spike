import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { students } from '../core/core.schema.js';
import { currentTenant } from '../db/current-tenant.js';
import { I18nText, isI18nText } from '../db/i18n-text.js';

export const invoices = pgTable(
  'invoices',
  {
    tenantId: uuid('tenant_id').notNull().default(currentTenant),
    id: uuid().notNull().defaultRandom(),
    studentId: uuid('student_id').notNull(),
    amount: numeric({ precision: 19, scale: 4 }).notNull(),
    currency: char({ length: 3 }).notNull(),
    // These three are set by a trigger on insert and never change. The number
    // counts up per school. The date is issued_at in the school's timezone.
    number: bigint({ mode: 'number' }).notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date'),
    description: jsonb().$type<I18nText>(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    // Composite, because foreign key checks bypass row-level security.
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    unique().on(t.tenantId, t.number),
    check('invoices_due_date', sql`${t.dueDate} >= ${t.issueDate}`),
    check('invoices_description', isI18nText(t.description)),
  ],
);
