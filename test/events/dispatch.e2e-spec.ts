import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { applications, eventSchools, userEvents } from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { EventRef } from '../../src/events/event-types.js';
import { asOwnerOf, inScope, runtimePool, until } from '../support/db.js';
import {
  deliveryStatus,
  emitEvent,
  FEE,
  feeEntries,
  setEndpoint,
  setFee,
  startWorker,
  studentBalance,
  TestWorker,
} from '../support/events.js';
import { FakeReceiver } from '../support/fake-receiver.js';
import { setUpBooks } from '../support/ledger.js';
import { tokenFor } from '../support/tokens.js';

// The dispatcher takes every undispatched event in the database, so the
// checks below look only at this file's own events and schools.
describe('the dispatcher', () => {
  const school = eventSchools.dispatch;
  let pool: pg.Pool;
  let w: TestWorker;
  let ref: EventRef;

  const dispatchedAt = async (event: EventRef) => {
    const rows = await inScope(
      pool,
      { tenantId: event.tenantId },
      async (c) =>
        (
          await c.query<{ dispatched_at: Date | null }>(
            'select dispatched_at from outbox_events where id = $1',
            [event.eventId],
          )
        ).rows,
    );
    return rows[0].dispatched_at;
  };

  const jobOf = (event: EventRef) =>
    w.queue.boss.getJobById<EventRef>(w.queue.names.events, event.eventId);

  beforeAll(async () => {
    pool = runtimePool();
    w = await startWorker();
    await setFee(await setUpBooks(pool, school.id, userEvents.id));
  });

  afterAll(async () => {
    await w?.stop();
    await pool.end();
  });

  it('does not see an event whose transaction has not committed', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('app.user_id', $1, true)", [
        userEvents.id,
      ]);
      await client.query("select set_config('app.tenant_id', $1, true)", [
        school.id,
      ]);
      const { rows } = await client.query<{ id: string }>(
        `insert into outbox_events (type, payload)
         values ('student.accepted', '{}') returning id`,
      );
      const uncommitted = { eventId: rows[0].id, tenantId: school.id };

      await w.dispatcher.dispatchOnce();
      expect(await jobOf(uncommitted)).toBeNull();

      await client.query('rollback');
      await w.dispatcher.dispatchOnce();
      expect(await jobOf(uncommitted)).toBeNull();
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('enqueues a committed event and marks it dispatched', async () => {
    ref = await emitEvent(pool, school);
    expect(await dispatchedAt(ref)).toBeNull();
    expect(await jobOf(ref)).toBeNull();

    await w.dispatcher.dispatchOnce();

    expect(await dispatchedAt(ref)).toBeInstanceOf(Date);
    expect((await jobOf(ref))?.state).toBe('created');
  });

  it('puts only the event id and the school id in the job', async () => {
    expect((await jobOf(ref))?.data).toEqual({
      eventId: ref.eventId,
      tenantId: school.id,
    });
  });

  it('does not enqueue it again on the next pass', async () => {
    const before = await jobOf(ref);
    await w.dispatcher.dispatchOnce();
    const after = await jobOf(ref);
    expect(after?.createdOn).toEqual(before?.createdOn);
    expect(after?.state).toBe('created');
  });

  it('sends it again after a crash between the send and the mark, without a second job or a second charge', async () => {
    const before = await jobOf(ref);
    // What the crash leaves behind: the job exists and the event is unmarked.
    await asOwnerOf(school.id, async (client) => {
      await client.query(
        'update outbox_events set dispatched_at = null where id = $1',
        [ref.eventId],
      );
    });

    await w.dispatcher.dispatchOnce();
    expect(await dispatchedAt(ref)).toBeInstanceOf(Date);
    expect((await jobOf(ref))?.createdOn).toEqual(before?.createdOn);

    await w.worker.work();
    await until(async () => (await jobOf(ref))?.state === 'completed');
    await w.worker.stop();

    expect(await studentBalance(pool, school)).toBe(FEE);
    expect(await feeEntries(pool, school.id)).toHaveLength(1);
  }, 40_000);
});

describe('from an accepted student to the school’s own system', () => {
  const school = eventSchools.endToEnd;
  let app: INestApplication<App>;
  let pool: pg.Pool;
  let w: TestWorker;
  let receiver: FakeReceiver;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    pool = runtimePool();
    w = await startWorker();
    receiver = new FakeReceiver();
    await setEndpoint(school.id, await receiver.start(), receiver.secret);
  });

  afterAll(async () => {
    await w?.stop();
    await receiver?.stop();
    await app?.close();
    await pool.end();
  });

  it('delivers a signed student.accepted webhook, with the dispatcher and the workers running on their own', async () => {
    await w.worker.start();

    const response = await request(app.getHttpServer())
      .post(
        `/schools/${school.id}/admissions/applications/${applications.endToEnd.id}/accept`,
      )
      .set('Authorization', `Bearer ${await tokenFor(userEvents.id)}`)
      .expect(201);

    await until(() => receiver.accepted.length === 1, 40_000);
    const [received] = receiver.accepted;
    const body = JSON.parse(received.body);
    await until(
      async () =>
        (await deliveryStatus(pool, {
          eventId: body.id,
          tenantId: school.id,
        })) === 'delivered',
    );
    await w.worker.stop();

    expect(body).toMatchObject({
      type: 'student.accepted',
      schoolId: school.id,
      data: {
        applicationId: applications.endToEnd.id,
        studentId: response.body.studentId,
      },
    });
    expect(received.id).toBe(body.id);
    expect(received.signatureValid).toBe(true);
    expect(receiver.requests).toHaveLength(1);
  }, 80_000);
});
