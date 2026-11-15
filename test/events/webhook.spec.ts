import pg from 'pg';
import { eventSchools, userEvents } from '../../db/seed.js';
import { EventRef } from '../../src/events/event-types.js';
import { runtimePool, until } from '../support/db.js';
import {
  attemptsOf,
  deliveryStatus,
  emitEvent,
  FEE,
  handlerOf,
  NOVEMBER,
  setEndpoint,
  setFee,
  startWorker,
  studentBalance,
  TestWorker,
} from '../support/events.js';
import {
  expectedSignature,
  FakeReceiver,
  newSecret,
  Received,
  signatureMatches,
} from '../support/fake-receiver.js';
import { setUpBooks } from '../support/ledger.js';

// Schools with finance off and an endpoint of their own, each written by one
// test, plus two with finance on to show that fees post meanwhile.
describe('webhook delivery', () => {
  let pool: pg.Pool;
  let w: TestWorker;
  const receivers: FakeReceiver[] = [];

  const receiverFor = async (school: { id: string }) => {
    const receiver = new FakeReceiver();
    await setEndpoint(school.id, await receiver.start(), receiver.secret);
    receivers.push(receiver);
    return receiver;
  };

  const post = (
    receiver: FakeReceiver,
    message: Pick<Received, 'id' | 'timestamp' | 'signature' | 'body'>,
  ) =>
    fetch(receiver.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': message.id,
        'webhook-timestamp': message.timestamp,
        'webhook-signature': message.signature,
      },
      body: message.body,
    });

  beforeAll(async () => {
    pool = runtimePool();
    w = await startWorker();
  });

  afterAll(async () => {
    await w?.stop();
    for (const receiver of receivers) await receiver.stop();
    await pool.end();
  });

  describe('a delivery', () => {
    const school = eventSchools.hookSigned;
    let receiver: FakeReceiver;
    let ref: EventRef;
    let received: Received;

    beforeAll(async () => {
      receiver = await receiverFor(school);
      ref = await emitEvent(pool, school);
      await w.runner.handle(ref);
      await w.sender.deliver(ref);
      received = receiver.requests[0];
    });

    it('arrives once and passes the receiver’s checks', () => {
      expect(receiver.requests).toHaveLength(1);
      expect(received.verdict).toBe('accepted');
    });

    it('is signed with the school’s own secret', () => {
      expect(signatureMatches(receiver.secret, received)).toBe(true);
      expect(signatureMatches(newSecret(), received)).toBe(false);
      expect(received.signature).toBe(
        expectedSignature(
          receiver.secret,
          received.id,
          received.timestamp,
          received.body,
        ),
      );
    });

    it('carries the event id as its idempotency key', () => {
      expect(received.id).toBe(ref.eventId);
    });

    it('carries the time it was sent, in whole seconds', () => {
      expect(received.timestamp).toMatch(/^\d+$/);
      expect(
        Math.abs(Date.now() / 1000 - Number(received.timestamp)),
      ).toBeLessThan(60);
    });

    it('is the event as JSON', () => {
      expect(received.contentType).toBe('application/json');
      expect(JSON.parse(received.body)).toEqual({
        id: ref.eventId,
        type: 'student.accepted',
        schoolId: school.id,
        occurredAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
        data: {
          applicationId: expect.any(String),
          studentId: school.student,
          acceptedAt: NOVEMBER,
        },
      });
    });

    it('is recorded as delivered, with its one attempt', async () => {
      expect(await handlerOf(pool, ref)).toEqual(['webhook']);
      expect(await deliveryStatus(pool, ref)).toBe('delivered');
      expect(await attemptsOf(pool, ref)).toEqual([
        { attemptNo: 1, responseStatus: 200, error: null },
      ]);
    });

    it('is not sent again by another run of its job', async () => {
      await w.sender.deliver(ref);
      await w.runner.handle(ref);
      expect(receiver.requests).toHaveLength(1);
    });

    describe('replayed to the receiver', () => {
      it('is not processed a second time', async () => {
        const response = await post(receiver, received);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ verdict: 'duplicate' });
        expect(receiver.accepted).toHaveLength(1);
      });

      it('fails the signature when its timestamp is moved forward', async () => {
        const response = await post(receiver, {
          ...received,
          timestamp: String(Number(received.timestamp) + 600),
        });
        expect(response.status).toBe(401);
      });

      it('fails the signature when its body is changed', async () => {
        const response = await post(receiver, {
          ...received,
          body: received.body.replace(
            school.student,
            eventSchools.hookRetry.student,
          ),
        });
        expect(response.status).toBe(401);
      });

      it('is refused as stale when it is correctly signed but ten minutes old', async () => {
        const old = String(Math.floor(Date.now() / 1000) - 600);
        const id = 'e5000000-0000-4000-8000-00000000dead';
        const response = await post(receiver, {
          id,
          timestamp: old,
          body: received.body,
          signature: expectedSignature(receiver.secret, id, old, received.body),
        });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ verdict: 'stale' });
      });
    });
  });

  describe('an endpoint that fails twice and then answers', () => {
    const school = eventSchools.hookRetry;
    let receiver: FakeReceiver;
    let ref: EventRef;

    beforeAll(async () => {
      receiver = await receiverFor(school);
      receiver.failNext(2);
      ref = await emitEvent(pool, school);
      await w.queue.sendEvent(ref);
      await w.worker.work();
      await until(
        async () => (await deliveryStatus(pool, ref)) === 'delivered',
        40_000,
      );
      await w.worker.stop();
    }, 60_000);

    it('is tried three times and delivered on the third', async () => {
      expect(receiver.requests.map((r) => r.verdict)).toEqual([
        'failed_on_purpose',
        'failed_on_purpose',
        'accepted',
      ]);
      expect(await attemptsOf(pool, ref)).toEqual([
        { attemptNo: 1, responseStatus: 500, error: null },
        { attemptNo: 2, responseStatus: 500, error: null },
        { attemptNo: 3, responseStatus: 200, error: null },
      ]);
    });

    it('carries the same idempotency key every time, freshly signed', () => {
      expect(receiver.requests.map((r) => r.id)).toEqual([
        ref.eventId,
        ref.eventId,
        ref.eventId,
      ]);
      expect(receiver.requests.every((r) => r.signatureValid)).toBe(true);
      const timestamps = receiver.requests.map((r) => Number(r.timestamp));
      expect(timestamps[2]).toBeGreaterThan(timestamps[0]);
    });

    it('backs off: the queue is configured for it and each wait has a higher floor', async () => {
      const { boss, names } = w.queue;
      expect(await boss.getQueue(names.deliveries)).toMatchObject({
        retryLimit: 2,
        retryDelay: 1,
        retryBackoff: true,
        deadLetter: names.dead,
      });
      const [first, second, third] = receiver.requests.map((r) => r.receivedAt);
      expect(second - first).toBeGreaterThanOrEqual(500);
      expect(third - second).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('an endpoint that keeps failing', () => {
    const stuckSchool = eventSchools.hookFails;
    const passingSchool = eventSchools.hookPasses;
    const feeSchool = eventSchools.hookFee;
    let failing: FakeReceiver;
    let passing: FakeReceiver;
    let stuck: EventRef;

    it('ends failed after its retries, while another school’s webhook and a third school’s fee go through', async () => {
      failing = await receiverFor(stuckSchool);
      failing.alwaysFail();
      passing = await receiverFor(passingSchool);
      await setFee(await setUpBooks(pool, feeSchool.id, userEvents.id));
      await w.worker.work();

      stuck = await emitEvent(pool, stuckSchool);
      await w.queue.sendEvent(stuck);
      await until(() => failing.requests.length >= 1);

      const delivered = await emitEvent(pool, passingSchool);
      const charged = await emitEvent(pool, feeSchool);
      await w.queue.sendEvent(delivered);
      await w.queue.sendEvent(charged);
      await until(
        async () =>
          (await deliveryStatus(pool, delivered)) === 'delivered' &&
          (await studentBalance(pool, feeSchool)) === FEE,
      );
      // The failing school is still between retries at this point.
      expect(await deliveryStatus(pool, stuck)).toBe('pending');
      expect(passing.accepted.map((r) => r.id)).toEqual([delivered.eventId]);

      await until(
        async () => (await deliveryStatus(pool, stuck)) === 'failed',
        40_000,
      );
      await w.worker.stop();
    }, 80_000);

    it('was tried once and retried twice, and every attempt is on record', async () => {
      expect(failing.requests).toHaveLength(3);
      expect(await attemptsOf(pool, stuck)).toEqual([
        { attemptNo: 1, responseStatus: 500, error: null },
        { attemptNo: 2, responseStatus: 500, error: null },
        { attemptNo: 3, responseStatus: 500, error: null },
      ]);
      expect(await handlerOf(pool, stuck)).toEqual(['webhook']);
    });

    it('is not tried again once it has failed', async () => {
      await w.sender.deliver(stuck);
      await w.runner.handle(stuck);
      expect(failing.requests).toHaveLength(3);
      expect(await deliveryStatus(pool, stuck)).toBe('failed');
    });
  });

  describe('a delivery job that dies each time before the sender records anything', () => {
    it('still ends failed, through the dead-letter queue', async () => {
      const school = eventSchools.hookDead;
      const receiver = await receiverFor(school);
      const { boss, names } = w.queue;
      const ref = await emitEvent(pool, school);
      await w.runner.handle(ref);

      // Each time the job becomes available, a worker takes it and dies.
      for (let run = 0; run <= w.config.webhook.retryLimit; run++) {
        const [job] = await until(async () => {
          const jobs = await boss.fetch<EventRef>(names.deliveries);
          return jobs.length > 0 ? jobs : null;
        }, 30_000);
        expect(job.data).toEqual(ref);
        await boss.fail(names.deliveries, job.id, { reason: 'worker died' });
      }
      expect(await deliveryStatus(pool, ref)).toBe('pending');

      await w.worker.work();
      await until(async () => (await deliveryStatus(pool, ref)) === 'failed');
      await w.worker.stop();

      expect(receiver.requests).toEqual([]);
      expect(await attemptsOf(pool, ref)).toEqual([]);
    }, 80_000);
  });

  describe('a school with finance off and no endpoint', () => {
    it('keeps the event as a pending delivery whose attempts say why, until its retries end', async () => {
      const ref = await emitEvent(pool, eventSchools.hookNoEndpoint);
      await w.runner.handle(ref);

      await expect(w.sender.deliver(ref)).rejects.toThrow(
        'No webhook endpoint is configured',
      );
      expect(await deliveryStatus(pool, ref)).toBe('pending');
      expect(await attemptsOf(pool, ref)).toEqual([
        {
          attemptNo: 1,
          responseStatus: null,
          error: 'No webhook endpoint is configured',
        },
      ]);

      // What the dead-letter worker does once the job has used its retries.
      await w.sender.markFailed(ref);
      expect(await deliveryStatus(pool, ref)).toBe('failed');
    });
  });

  describe('a worker that dies after the routing commits and before the delivery job is sent', () => {
    const school = eventSchools.hookHandoff;
    let receiver: FakeReceiver;
    let ref: EventRef;

    it('leaves the decision recorded, a pending delivery and no delivery job', async () => {
      receiver = await receiverFor(school);
      ref = await emitEvent(pool, school);
      const send = vi
        .spyOn(w.queue, 'sendDelivery')
        .mockRejectedValueOnce(new Error('worker died before the send'));

      await expect(w.runner.handle(ref)).rejects.toThrow(
        'worker died before the send',
      );
      send.mockRestore();

      expect(await handlerOf(pool, ref)).toEqual(['webhook']);
      expect(await deliveryStatus(pool, ref)).toBe('pending');
      expect(
        await w.queue.boss.getJobById(w.queue.names.deliveries, ref.eventId),
      ).toBeNull();
      expect(receiver.requests).toEqual([]);
    });

    it('sends the delivery job when the events job runs again, and the webhook arrives exactly once with the same id', async () => {
      await w.queue.sendEvent(ref);
      await w.worker.work();
      await until(() => receiver.accepted.length === 1);
      await until(
        async () => (await deliveryStatus(pool, ref)) === 'delivered',
      );

      // Further runs of the events job send nothing more.
      await w.runner.handle(ref);
      await w.runner.handle(ref);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await w.worker.stop();

      expect(receiver.requests).toHaveLength(1);
      expect(receiver.requests[0].id).toBe(ref.eventId);
      expect(await attemptsOf(pool, ref)).toHaveLength(1);
    }, 40_000);
  });

  describe('an endpoint that hangs until the timeout', () => {
    const TIMEOUT_MS = 1500;
    let slow: TestWorker;

    afterAll(async () => {
      await slow?.stop();
    });

    it('holds no database connection while it hangs, so another school’s fee posts meanwhile', async () => {
      const hangSchool = eventSchools.hookHangs;
      const feeSchool = eventSchools.hookHangFee;
      // One runtime connection for the whole worker: anything that kept it
      // across the HTTP call would make the fee wait for the timeout.
      slow = await startWorker({
        poolMax: 1,
        webhook: { timeoutMs: TIMEOUT_MS },
      });
      const hanging = await receiverFor(hangSchool);
      hanging.hang();
      await setFee(await setUpBooks(pool, feeSchool.id, userEvents.id));

      const stuck = await emitEvent(pool, hangSchool);
      await slow.runner.handle(stuck);
      await slow.worker.work();
      await until(() => hanging.open === 1);
      const sentAt = hanging.requests[0].receivedAt;
      expect(slow.pool!.totalCount - slow.pool!.idleCount).toBe(0);

      const charged = await emitEvent(pool, feeSchool);
      await slow.runner.handle(charged);
      const postedAfter = Date.now() - sentAt;

      expect(await studentBalance(pool, feeSchool)).toBe(FEE);
      // The first school's request is still unanswered.
      expect(hanging.open).toBe(1);
      expect(postedAfter).toBeLessThan(TIMEOUT_MS);

      const [attempt] = await until(async () => {
        const attempts = await attemptsOf(pool, stuck);
        return attempts.length > 0 ? attempts : null;
      });
      await slow.worker.stop();
      expect(attempt).toMatchObject({ attemptNo: 1, responseStatus: null });
      expect(attempt.error).toBe(`Timed out after ${TIMEOUT_MS}ms`);
      expect(await deliveryStatus(pool, stuck)).toBe('pending');
      // The sender gave up at the timeout, not earlier and not much later.
      const recordedAfter = Date.now() - sentAt;
      expect(recordedAfter).toBeGreaterThanOrEqual(TIMEOUT_MS);
    }, 60_000);
  });
});
