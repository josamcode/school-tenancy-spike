import pg from 'pg';
import { eventSchools, userEvents } from '../../db/seed.js';
import { EventRef } from '../../src/events/event-types.js';
import { RegistrationFeeHandler } from '../../src/finance/registration-fee.handler.js';
import { ownerPool, runtimePool, until } from '../support/db.js';
import {
  deliveryStatus,
  emitEvent,
  FEE,
  feeEntries,
  handlerOf,
  setEndpoint,
  setFee,
  setFinance,
  startWorker,
  studentBalance,
  TestWorker,
} from '../support/events.js';
import { FakeReceiver } from '../support/fake-receiver.js';
import { setUpBooks } from '../support/ledger.js';

type School = { id: string; student: string };

// Six schools, each with an endpoint, books and a registration fee, so both
// routes could act in every one of them. Each is written by one test.
describe('routing an event to finance or to the webhook', () => {
  let pool: pg.Pool;
  let w: TestWorker;
  const receivers = new Map<string, FakeReceiver>();

  const receiverOf = (school: School) => receivers.get(school.id)!;

  // Runs the events job, then the delivery job it may have sent.
  const deliver = async (ref: EventRef) => {
    await w.runner.handle(ref);
    await w.sender.deliver(ref);
  };

  const wentToFinance = async (school: School, ref: EventRef) => {
    expect(await handlerOf(pool, ref)).toEqual(['finance']);
    expect(await deliveryStatus(pool, ref)).toBeUndefined();
    expect(receiverOf(school).requests.map((r) => r.id)).not.toContain(
      ref.eventId,
    );
  };

  const wentToWebhook = async (school: School, ref: EventRef) => {
    expect(await handlerOf(pool, ref)).toEqual(['webhook']);
    expect(await deliveryStatus(pool, ref)).toBe('delivered');
    expect(receiverOf(school).accepted.map((r) => r.id)).toContain(ref.eventId);
  };

  beforeAll(async () => {
    pool = runtimePool();
    w = await startWorker();
    for (const school of [
      eventSchools.routeOff,
      eventSchools.routeOn,
      eventSchools.switchOnOff,
      eventSchools.switchOffOn,
      eventSchools.switchWaits,
      eventSchools.switchAfter,
    ]) {
      const receiver = new FakeReceiver();
      await setEndpoint(school.id, await receiver.start(), receiver.secret);
      receivers.set(school.id, receiver);
      await setFee(await setUpBooks(pool, school.id, userEvents.id));
    }
  });

  afterAll(async () => {
    await w?.stop();
    for (const receiver of receivers.values()) await receiver.stop();
    await pool.end();
  });

  it('sends the event to the webhook, and not to finance, when finance is off', async () => {
    const school = eventSchools.routeOff;
    const handler = w.module.get(RegistrationFeeHandler, { strict: false });
    const handle = vi.spyOn(handler, 'handle');
    const ref = await emitEvent(pool, school);

    await deliver(ref);

    await wentToWebhook(school, ref);
    expect(handle).not.toHaveBeenCalled();
    expect(await feeEntries(pool, school.id)).toEqual([]);
    expect(await studentBalance(pool, school)).toBe('0.00');
    handle.mockRestore();
  });

  it('sends the event to finance, and not to the webhook, when finance is on', async () => {
    const school = eventSchools.routeOn;
    const ref = await emitEvent(pool, school);

    await deliver(ref);

    await wentToFinance(school, ref);
    expect(await studentBalance(pool, school)).toBe(FEE);
    expect(receiverOf(school).requests).toEqual([]);
  });

  describe('a switch between emission and delivery', () => {
    it('on, then off: the webhook takes it and finance posts nothing', async () => {
      const school = eventSchools.switchOnOff;
      const ref = await emitEvent(pool, school);
      await setFinance(school.id, false);

      await deliver(ref);

      await wentToWebhook(school, ref);
      expect(await feeEntries(pool, school.id)).toEqual([]);
    });

    it('off, then on: finance charges and no webhook is sent', async () => {
      const school = eventSchools.switchOffOn;
      const ref = await emitEvent(pool, school);
      await setFinance(school.id, true);

      await deliver(ref);

      await wentToFinance(school, ref);
      expect(await studentBalance(pool, school)).toBe(FEE);
      expect(receiverOf(school).requests).toEqual([]);
    });
  });

  it('waits for a switch that has not committed, then follows what it committed', async () => {
    const school = eventSchools.switchWaits;
    const ref = await emitEvent(pool, school);
    const owner = ownerPool();
    const switcher = await owner.connect();
    let handled = false;
    try {
      await switcher.query('begin');
      await switcher.query("select set_config('app.tenant_id', $1, true)", [
        school.id,
      ]);
      await switcher.query(
        `update tenant_modules set enabled = false where module = 'finance'`,
      );
      const holder = await switcher.query<{ pid: number }>(
        'select pg_backend_pid() as pid',
      );

      const handling = w.runner.handle(ref).then(() => {
        handled = true;
      });
      // No fixed wait: the handler is known to have reached its decision once
      // a backend waits for a lock that the switch's transaction holds, or
      // once the decision is there because nothing made it wait.
      await until(async () => {
        const blocked = await pool.query(
          'select 1 from pg_stat_activity where $1::int = any (pg_blocking_pids(pid))',
          [holder.rows[0].pid],
        );
        return (
          blocked.rows.length > 0 || (await handlerOf(pool, ref)).length > 0
        );
      });
      expect(await handlerOf(pool, ref)).toEqual([]);
      expect(handled).toBe(false);

      await switcher.query('commit');
      await handling;
    } finally {
      await switcher.query('rollback');
      switcher.release();
      await owner.end();
    }
    await w.sender.deliver(ref);

    await wentToWebhook(school, ref);
    expect(await feeEntries(pool, school.id)).toEqual([]);
  });

  describe('a switch after the decision', () => {
    const school = eventSchools.switchAfter;

    it('does not move a charged event to the webhook', async () => {
      const ref = await emitEvent(pool, school);
      await deliver(ref);
      await wentToFinance(school, ref);

      await setFinance(school.id, false);
      await deliver(ref);

      await wentToFinance(school, ref);
      expect(await feeEntries(pool, school.id)).toHaveLength(1);
    });

    it('does not charge for an event the webhook already took', async () => {
      // Finance is off now, from the test above.
      const ref = await emitEvent(pool, school);
      await deliver(ref);
      await wentToWebhook(school, ref);

      await setFinance(school.id, true);
      await deliver(ref);

      await wentToWebhook(school, ref);
      expect(receiverOf(school).requests).toHaveLength(1);
      expect(await feeEntries(pool, school.id)).toHaveLength(1);
      expect(await studentBalance(pool, school)).toBe(FEE);
    });
  });
});
