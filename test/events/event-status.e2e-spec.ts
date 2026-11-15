import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import pg from 'pg';
import request from 'supertest';
import { App } from 'supertest/types.js';
import {
  applications,
  eventSchools,
  userA,
  userEvents,
} from '../../db/seed.js';
import { AppModule } from '../../src/app.module.js';
import { EventRef } from '../../src/events/event-types.js';
import { committed, runtimePool } from '../support/db.js';
import {
  FEE,
  setEndpoint,
  setFee,
  startWorker,
  studentBalance,
  TestWorker,
} from '../support/events.js';
import { FakeReceiver } from '../support/fake-receiver.js';
import { setUpBooks } from '../support/ledger.js';
import { tokenFor } from '../support/tokens.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// Two schools that only this file writes. Nothing polls: each step of the
// delivery is run by hand, so every state in between can be read.
describe('GET /schools/:schoolId/admissions/applications/:applicationId/event', () => {
  const feeSchool = eventSchools.statusFee;
  const hookSchool = eventSchools.statusHook;
  let app: INestApplication<App>;
  let pool: pg.Pool;
  let w: TestWorker;
  let receiver: FakeReceiver;
  const tokens: Record<string, string> = {};

  const path = (school: { id: string }, application: { id: string }) =>
    `/schools/${school.id}/admissions/applications/${application.id}`;
  const accept = (school: { id: string }, application: { id: string }) =>
    request(app.getHttpServer())
      .post(`${path(school, application)}/accept`)
      .set('Authorization', `Bearer ${tokens[userEvents.id]}`)
      .expect(201);
  const status = (
    school: { id: string },
    application: { id: string },
    user = userEvents,
  ) =>
    request(app.getHttpServer())
      .get(`${path(school, application)}/event`)
      .set('Authorization', `Bearer ${tokens[user.id]}`);
  const refOf = (school: { id: string }, body: { event: { id: string } }) =>
    ({ eventId: body.event.id, tenantId: school.id }) satisfies EventRef;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    pool = runtimePool();
    w = await startWorker();
    for (const user of [userEvents, userA]) {
      tokens[user.id] = await tokenFor(user.id);
    }
    await setFee(await setUpBooks(pool, feeSchool.id, userEvents.id));
    // The fee is dated by the acceptance, which happens today, so the books
    // need an open period around today.
    await committed(
      pool,
      { userId: userEvents.id, tenantId: feeSchool.id },
      async (client) => {
        const { rows } = await client.query<{ id: string }>(
          `insert into financial_years (name, start_date, end_date)
           values ('Today', current_date - 1, current_date + 1) returning id`,
        );
        await client.query(
          `insert into ledger_periods (year_id, start_date, end_date)
           values ($1, current_date - 1, current_date + 1)`,
          [rows[0].id],
        );
      },
    );
    receiver = new FakeReceiver();
    await setEndpoint(hookSchool.id, await receiver.start(), receiver.secret);
  });

  afterAll(async () => {
    await w?.stop();
    await receiver?.stop();
    await app?.close();
    await pool.end();
  });

  describe('where finance is on', () => {
    const application = applications.statusFee;
    let ref: EventRef;

    it('has no event before the application is accepted', async () => {
      const response = await status(feeSchool, application);
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('No event for this application');
    });

    it('shows the event written and not yet dispatched, right after the acceptance', async () => {
      await accept(feeSchool, application);

      const response = await status(feeSchool, application);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        event: {
          id: expect.any(String),
          type: 'student.accepted',
          createdAt: expect.stringMatching(ISO),
          dispatchedAt: null,
        },
        routedTo: null,
        routedAt: null,
        delivery: null,
        failure: null,
      });
      ref = refOf(feeSchool, response.body);
    });

    it('shows when the dispatcher took it', async () => {
      await w.dispatcher.dispatchOnce();

      const response = await status(feeSchool, application);
      expect(response.body.event.dispatchedAt).toMatch(ISO);
      expect(response.body.routedTo).toBeNull();
    });

    it('shows it routed to finance once it is handled, with no delivery', async () => {
      await w.runner.handle(ref);

      const response = await status(feeSchool, application);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        routedTo: 'finance',
        routedAt: expect.stringMatching(ISO),
        delivery: null,
        failure: null,
      });
      expect(
        await studentBalance(pool, {
          id: feeSchool.id,
          student: (await accepted(feeSchool, application)).studentId,
        }),
      ).toBe(FEE);
    });

    it('has no event for an application that is still pending', async () => {
      const response = await status(feeSchool, applications.statusPending);
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('No event for this application');
    });
  });

  describe('where finance is off and the school has a webhook', () => {
    it('shows the delivery pending, then delivered with its one attempt', async () => {
      const application = applications.statusHook;
      await accept(hookSchool, application);
      const first = await status(hookSchool, application);
      const ref = refOf(hookSchool, first.body);

      await w.runner.handle(ref);
      const pending = await status(hookSchool, application);
      expect(pending.body).toMatchObject({
        routedTo: 'webhook',
        routedAt: expect.stringMatching(ISO),
        delivery: {
          status: 'pending',
          url: receiver.url,
          finishedAt: null,
          attempts: [],
        },
        failure: null,
      });

      await w.sender.deliver(ref);
      const delivered = await status(hookSchool, application);
      expect(delivered.body.delivery).toEqual({
        status: 'delivered',
        url: receiver.url,
        finishedAt: expect.stringMatching(ISO),
        attempts: [
          {
            attemptNo: 1,
            startedAt: expect.stringMatching(ISO),
            responseStatus: 200,
            error: null,
          },
        ],
      });
      expect(receiver.accepted).toHaveLength(1);
      expect(receiver.accepted[0].id).toBe(ref.eventId);
      expect(receiver.accepted[0].signatureValid).toBe(true);
    });

    it('lists every attempt when the receiver fails first', async () => {
      const application = applications.statusHookRetry;
      await accept(hookSchool, application);
      const first = await status(hookSchool, application);
      const ref = refOf(hookSchool, first.body);
      await w.runner.handle(ref);

      receiver.failNext(1);
      await expect(w.sender.deliver(ref)).rejects.toThrow('HTTP 500');
      const failedOnce = await status(hookSchool, application);
      expect(failedOnce.body.delivery).toMatchObject({
        status: 'pending',
        attempts: [{ attemptNo: 1, responseStatus: 500, error: null }],
      });

      await w.sender.deliver(ref);
      const delivered = await status(hookSchool, application);
      expect(delivered.body.delivery.status).toBe('delivered');
      expect(
        delivered.body.delivery.attempts.map(
          (attempt: { attemptNo: number; responseStatus: number }) => [
            attempt.attemptNo,
            attempt.responseStatus,
          ],
        ),
      ).toEqual([
        [1, 500],
        [2, 200],
      ]);
    });

    it('never returns the endpoint’s secret', async () => {
      const response = await status(hookSchool, applications.statusHook);
      expect(response.status).toBe(200);
      const text = JSON.stringify(response.body);
      expect(text).toContain(receiver.url);
      expect(text).not.toContain(receiver.secret);
      expect(text).not.toContain(receiver.secret.replace('whsec_', ''));
      expect(text.toLowerCase()).not.toContain('secret');
    });
  });

  describe('for someone else', () => {
    it('answers the plain 403 to a user of another school', async () => {
      const response = await status(hookSchool, applications.statusHook, userA);
      expect(response.status).toBe(403);
      expect(response.body.code).toBeUndefined();
    });

    it('does not find an accepted application through another school', async () => {
      // It has an event in its own school.
      const own = await status(hookSchool, applications.statusHook);
      expect(own.status).toBe(200);

      const response = await status(feeSchool, applications.statusHook);
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('Application not found');
    });
  });

  // The student the acceptance created, read from the applications list.
  async function accepted(school: { id: string }, application: { id: string }) {
    const response = await request(app.getHttpServer())
      .get(`/schools/${school.id}/admissions/applications`)
      .set('Authorization', `Bearer ${tokens[userEvents.id]}`)
      .expect(200);
    const found = response.body.find(
      (row: { id: string }) => row.id === application.id,
    );
    expect(found).toMatchObject({ status: 'accepted' });
    expect(found.acceptedAt).toMatch(ISO);
    return found as { studentId: string };
  }
});
