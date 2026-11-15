import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { students, tenants } from '../core/core.schema.js';
import { currentTenant } from '../db/current-tenant.js';

// Accepting an application creates its student, so the two are set together.
export const admissionApplications = pgTable(
  'admission_applications',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .default(currentTenant)
      .references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    applicantName: text('applicant_name').notNull(),
    status: text().notNull().default('pending'),
    studentId: uuid('student_id'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    unique().on(t.tenantId, t.studentId),
    check(
      'admission_applications_status',
      sql`${t.status} in ('pending', 'accepted')`,
    ),
    check(
      'admission_applications_accepted',
      sql`(${t.status} = 'accepted') = (${t.studentId} is not null)
          and (${t.status} = 'accepted') = (${t.acceptedAt} is not null)
          and (${t.status} = 'accepted') = (${t.acceptedBy} is not null)`,
    ),
  ],
);
