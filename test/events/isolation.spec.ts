import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { eventSchools, userEvents } from '../../db/seed.js';
import { EventRef } from '../../src/events/event-types.js';
import { runtimePool } from '../support/db.js';
import {
  emitEvent,
  handlerOf,
  NOVEMBER,
  setEndpoint,
  startWorker,
  TestWorker,
} from '../support/events.js';

const one = eventSchools.isolationOne;
const two = eventSchools.isolationTwo;

// Two schools, each with a student, an event and an endpoint, written only by
// this file.
describe('a handler and the event’s school', () => {
  let pool: pg.Pool;
  let w: TestWorker;
  let refOne: EventRef;
  let refTwo: EventRef;

  beforeAll(async () => {
    pool = runtimePool();
    w = await startWorker();
    refOne = await emitEvent(pool, one);
    refTwo = await emitEvent(pool, two);
    await setEndpoint(one.id, 'http://127.0.0.1:9/one', 'whsec_one');
    await setEndpoint(two.id, 'http://127.0.0.1:9/two', 'whsec_two');
  });

  afterAll(async () => {
    await w?.stop();
    await pool.end();
  });

  it('runs with the event’s school and the user who caused the event', async () => {
    const seen = await w.tenantDb.runForEvent(refOne, async (event) => {
      const { rows } = await w.tenantDb.db.execute(sql`
        select current_setting('app.tenant_id') as tenant,
               current_setting('app.user_id') as "user",
               current_user::text as role`);
      return { event, settings: rows[0] };
    });
    expect(seen.settings).toEqual({
      tenant: one.id,
      user: userEvents.id,
      role: 'app_runtime',
    });
    expect(seen.event).toMatchObject({
      id: refOne.eventId,
      type: 'student.accepted',
      actorUserId: userEvents.id,
      payload: { studentId: one.student, acceptedAt: NOVEMBER },
    });
  });

  it.each([
    ['students', 'tenant_id'],
    ['outbox_events', 'tenant_id'],
    ['webhook_endpoints', 'tenant_id'],
    ['finance_settings', 'tenant_id'],
    ['tenants', 'id'],
  ])('sees only its own school in %s', async (table, column) => {
    const schoolsSeen = await w.tenantDb.runForEvent(refOne, async () => {
      const { rows } = await w.tenantDb.db.execute(
        sql`select distinct ${sql.identifier(column)}::text as school
              from ${sql.identifier(table)}`,
      );
      return rows.map((row) => row.school);
    });
    expect(schoolsSeen).toEqual([one.id]);
  });

  it('cannot read the other school’s event by its id', async () => {
    const rows = await w.tenantDb.runForEvent(refOne, async () => {
      const result = await w.tenantDb.db.execute(
        sql`select id from outbox_events where id = ${refTwo.eventId}`,
      );
      return result.rows;
    });
    expect(rows).toEqual([]);
  });

  it('never starts when the job names another school for the event', async () => {
    let called = false;
    const attempt = w.tenantDb.runForEvent(
      { eventId: refOne.eventId, tenantId: two.id },
      async () => {
        called = true;
      },
    );
    await expect(attempt).rejects.toThrow(
      `Event ${refOne.eventId} is not in school ${two.id}`,
    );
    expect(called).toBe(false);
  });

  it('never starts for an event that does not exist', async () => {
    let called = false;
    const eventId = randomUUID();
    const attempt = w.tenantDb.runForEvent(
      { eventId, tenantId: one.id },
      async () => {
        called = true;
      },
    );
    await expect(attempt).rejects.toThrow(
      `Event ${eventId} is not in school ${one.id}`,
    );
    expect(called).toBe(false);
  });

  it('records nothing in either school when the runner is given such a job', async () => {
    const forged = { eventId: refOne.eventId, tenantId: two.id };
    await expect(w.runner.handle(forged)).rejects.toThrow('is not in school');
    await expect(w.sender.deliver(forged)).rejects.toThrow('is not in school');

    expect(await handlerOf(pool, refOne)).toEqual([]);
    expect(await handlerOf(pool, forged)).toEqual([]);
  });

  it('gives a handle that fails after the event’s transaction has ended', async () => {
    const kept = await w.tenantDb.runForEvent(
      refOne,
      async () => w.tenantDb.db,
    );
    await expect(kept.execute(sql`select 1`)).rejects.toThrow();
  });
});
