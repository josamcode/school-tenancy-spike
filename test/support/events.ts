import { randomBytes, randomUUID } from 'node:crypto';
import { Provider } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import pg from 'pg';
import { inject } from 'vitest';
import { userEvents } from '../../db/seed.js';
import { PG_POOL } from '../../src/db/pg-pool.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { Dispatcher } from '../../src/events/dispatcher.js';
import { EventQueue } from '../../src/events/event-queue.js';
import { EventRunner } from '../../src/events/event-runner.js';
import { EventRef } from '../../src/events/event-types.js';
import { EventWorker } from '../../src/events/event-worker.js';
import { WebhookSender } from '../../src/events/webhook-sender.js';
import { WorkerConfig } from '../../src/events/worker.config.js';
import { WorkerModule } from '../../src/events/worker.module.js';
import { asOwnerOf, committed, inScope } from './db.js';
import { Books } from './ledger.js';

export interface TestWorker {
  module: TestingModule;
  config: WorkerConfig;
  tenantDb: TenantDb;
  runner: EventRunner;
  sender: WebhookSender;
  dispatcher: Dispatcher;
  queue: EventQueue;
  worker: EventWorker;
  // The runtime pool, when the test chose its size.
  pool?: pg.Pool;
  stop: () => Promise<void>;
}

export interface WorkerOptions {
  events?: Partial<WorkerConfig['events']>;
  webhook?: Partial<WorkerConfig['webhook']>;
  // Size of the runtime role's pool. The default is the application's own.
  poolMax?: number;
  providers?: Provider[];
}

// Builds the worker's module the way src/worker.ts does. Nothing polls until
// worker.start() is called, so a test can drive each step itself. Every
// instance has queues of its own, so a job is only ever taken by the test
// that sent it.
export async function startWorker(
  options: WorkerOptions = {},
): Promise<TestWorker> {
  const config: WorkerConfig = {
    dispatcherUrl: inject('dispatcherDatabaseUrl'),
    queueUrl: inject('queueDatabaseUrl'),
    queuePrefix: `t${randomBytes(4).toString('hex')}-`,
    pollingIntervalSeconds: 0.5,
    dispatchIntervalMs: 200,
    events: { retryLimit: 5, retryDelaySeconds: 1, ...options.events },
    webhook: {
      retryLimit: 2,
      retryDelaySeconds: 1,
      timeoutMs: 1000,
      ...options.webhook,
    },
  };
  let builder = Test.createTestingModule({
    imports: [WorkerModule.register(config)],
    providers: options.providers ?? [],
  });
  let pool: pg.Pool | undefined;
  if (options.poolMax !== undefined) {
    pool = new pg.Pool({
      connectionString: inject('databaseUrl'),
      max: options.poolMax,
    });
    builder = builder.overrideProvider(PG_POOL).useValue(pool);
  }
  const module = await builder.compile();
  await module.init();
  const get = <T>(token: new (...args: never[]) => T): T =>
    module.get(token, { strict: false });
  const worker = get(EventWorker);
  return {
    module,
    config,
    tenantDb: get(TenantDb),
    runner: get(EventRunner),
    sender: get(WebhookSender),
    dispatcher: get(Dispatcher),
    queue: get(EventQueue),
    worker,
    pool,
    stop: async () => {
      await worker.stop();
      await module.close();
    },
  };
}

export const NOVEMBER = '2025-11-10T08:00:00Z';

// Commits a student.accepted event as the runtime role, the way the
// acceptance does, and leaves it undispatched.
export async function emitEvent(
  pool: pg.Pool,
  school: { id: string; student: string },
  acceptedAt = NOVEMBER,
): Promise<EventRef> {
  const payload = {
    applicationId: randomUUID(),
    studentId: school.student,
    acceptedAt,
  };
  const { rows } = await committed(
    pool,
    { userId: userEvents.id, tenantId: school.id },
    (client) =>
      client.query<{ id: string }>(
        `insert into outbox_events (type, payload)
         values ('student.accepted', $1) returning id`,
        [JSON.stringify(payload)],
      ),
  );
  return { eventId: rows[0].id, tenantId: school.id };
}

export const setEndpoint = (schoolId: string, url: string, secret: string) =>
  asOwnerOf(schoolId, async (client) => {
    await client.query(
      `insert into webhook_endpoints (url, secret) values ($1, $2)
       on conflict (tenant_id) do update
         set url = excluded.url, secret = excluded.secret`,
      [url, secret],
    );
  });

export const setFinance = (schoolId: string, enabled: boolean) =>
  asOwnerOf(schoolId, async (client) => {
    await client.query(
      `insert into tenant_modules (module, enabled) values ('finance', $1)
       on conflict (tenant_id, module) do update set enabled = excluded.enabled`,
      [enabled],
    );
  });

export const FEE = '500.00';

// A registration fee of 500.00 AED, receivable from the student.
export const setFee = (books: Books) =>
  asOwnerOf(books.schoolId, async (client) => {
    await client.query(
      `insert into registration_fees
         (amount, currency, receivable_account_id, income_account_id)
       values ($1, 'AED', $2, $3)`,
      [FEE, books.accounts.receivables, books.accounts.tuition],
    );
  });

const read = async <R extends pg.QueryResultRow>(
  pool: pg.Pool,
  schoolId: string,
  text: string,
  values: unknown[] = [],
): Promise<R[]> =>
  inScope(pool, { tenantId: schoolId }, async (client) => {
    const { rows } = await client.query<R>(text, values);
    return rows;
  });

export interface FeeEntry {
  date: string;
  periodId: string;
  postedBy: string;
}

export const feeEntries = (pool: pg.Pool, schoolId: string) =>
  read<FeeEntry>(
    pool,
    schoolId,
    `select entry_date::text as date, period_id as "periodId",
            posted_by as "postedBy"
       from ledger_entries where kind = 'registration_fee'
      order by posted_at`,
  );

// What the student owes, from the lines that name them.
export async function studentBalance(
  pool: pg.Pool,
  school: { id: string; student: string },
): Promise<string> {
  const [row] = await read<{ total: string }>(
    pool,
    school.id,
    `select coalesce(sum(amount), 0)::numeric(19, 2)::text as total
       from ledger_lines where student_id = $1`,
    [school.student],
  );
  return row.total;
}

export async function handlerOf(
  pool: pg.Pool,
  ref: EventRef,
): Promise<string[]> {
  const rows = await read<{ handler: string }>(
    pool,
    ref.tenantId,
    'select handler from processed_events where event_id = $1',
    [ref.eventId],
  );
  return rows.map((row) => row.handler);
}

export async function deliveryStatus(
  pool: pg.Pool,
  ref: EventRef,
): Promise<string | undefined> {
  const [row] = await read<{ status: string }>(
    pool,
    ref.tenantId,
    'select status from webhook_deliveries where event_id = $1',
    [ref.eventId],
  );
  return row?.status;
}

export interface Attempt {
  attemptNo: number;
  responseStatus: number | null;
  error: string | null;
}

export const attemptsOf = (pool: pg.Pool, ref: EventRef) =>
  read<Attempt>(
    pool,
    ref.tenantId,
    `select attempt_no as "attemptNo", response_status as "responseStatus", error
       from webhook_attempts where event_id = $1 order by attempt_no`,
    [ref.eventId],
  );

export interface EventFailure {
  eventId: string;
  error: string;
  failedAt: Date;
}

// The events of a school that used all their retries.
export const failuresOf = (pool: pg.Pool, schoolId: string) =>
  read<EventFailure>(
    pool,
    schoolId,
    `select event_id as "eventId", error, failed_at as "failedAt"
       from event_failures order by failed_at`,
  );
