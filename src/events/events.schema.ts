import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from '../core/core.schema.js';
import { currentTenant } from '../db/current-tenant.js';

const tenantId = () => uuid('tenant_id').notNull().default(currentTenant);
const instant = (name: string) => timestamp(name, { withTimezone: true });

// Written in the transaction that causes the event, and never changed except
// for dispatched_at, which the dispatcher sets once.
export const outboxEvents = pgTable(
  'outbox_events',
  {
    tenantId: tenantId().references(() => tenants.id),
    id: uuid().notNull().defaultRandom(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    actorUserId: uuid('actor_user_id')
      .notNull()
      .default(sql`NULLIF(current_setting('app.user_id', true), '')::uuid`),
    createdAt: instant('created_at').notNull().defaultNow(),
    dispatchedAt: instant('dispatched_at'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('outbox_events_undispatched')
      .on(t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
    check('outbox_events_type', sql`${t.type} in ('student.accepted')`),
  ],
);

// Which handler took an event. The key allows one per event, and the row is
// written in the same transaction as that handler's effect.
export const processedEvents = pgTable(
  'processed_events',
  {
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    handler: text().notNull(),
    processedAt: instant('processed_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.eventId] }),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [outboxEvents.tenantId, outboxEvents.id],
    }),
    check(
      'processed_events_handler',
      sql`${t.handler} in ('finance', 'webhook')`,
    ),
  ],
);

// An event whose job used all its retries without being handled. Written by
// the worker on the events queue's dead-letter queue, once per event.
export const eventFailures = pgTable(
  'event_failures',
  {
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    failedAt: instant('failed_at').notNull().defaultNow(),
    error: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.eventId] }),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [outboxEvents.tenantId, outboxEvents.id],
    }),
  ],
);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  tenantId: tenantId()
    .primaryKey()
    .references(() => tenants.id),
  url: text().notNull(),
  secret: text().notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
});

// One per event that went to the webhook. Pending until it is delivered or
// has failed for good.
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    status: text().notNull().default('pending'),
    createdAt: instant('created_at').notNull().defaultNow(),
    finishedAt: instant('finished_at'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.eventId] }),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [processedEvents.tenantId, processedEvents.eventId],
    }),
    check(
      'webhook_deliveries_status',
      sql`${t.status} in ('pending', 'delivered', 'failed')`,
    ),
    check(
      'webhook_deliveries_finished',
      sql`(${t.status} = 'pending') = (${t.finishedAt} is null)`,
    ),
  ],
);

// One per HTTP request, with the answer or the reason there was none.
export const webhookAttempts = pgTable(
  'webhook_attempts',
  {
    tenantId: tenantId(),
    eventId: uuid('event_id').notNull(),
    attemptNo: integer('attempt_no').notNull(),
    startedAt: instant('started_at').notNull(),
    responseStatus: integer('response_status'),
    error: text(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.eventId, t.attemptNo] }),
    foreignKey({
      columns: [t.tenantId, t.eventId],
      foreignColumns: [webhookDeliveries.tenantId, webhookDeliveries.eventId],
    }),
    check(
      'webhook_attempts_outcome',
      sql`(${t.responseStatus} is null) <> (${t.error} is null)`,
    ),
  ],
);
