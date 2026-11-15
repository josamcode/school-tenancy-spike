import { Logger } from '@nestjs/common';
import pg from 'pg';
import { eventSchools, userEvents } from '../../db/seed.js';
import { EventRef } from '../../src/events/event-types.js';
import { runtimePool, until } from '../support/db.js';
import {
  emitEvent,
  failuresOf,
  FEE,
  feeEntries,
  handlerOf,
  setFee,
  startWorker,
  studentBalance,
  TestWorker,
} from '../support/events.js';
import { setUpBooks } from '../support/ledger.js';

const broken = eventSchools.failNoFee;
const healthy = eventSchools.failOther;

// Two schools with finance on, written only by this file. The first has no
// registration fee configured, so its handler fails every time. The events
// queue is given one retry, two seconds or more after the first run.
describe('an event whose handler keeps failing', () => {
  let pool: pg.Pool;
  let w: TestWorker;
  let failed: EventRef;

  const stateOf = async (ref: EventRef) =>
    (await w.queue.boss.getJobById(w.queue.names.events, ref.eventId))?.state;

  beforeAll(async () => {
    pool = runtimePool();
    w = await startWorker({ events: { retryLimit: 1, retryDelaySeconds: 2 } });
    await setUpBooks(pool, broken.id, userEvents.id);
    await setFee(await setUpBooks(pool, healthy.id, userEvents.id));
  });

  afterAll(async () => {
    await w?.stop();
    await pool.end();
  });

  it('ends as one failure row in its school, while another school’s event is handled meanwhile', async () => {
    await w.worker.work();
    failed = await emitEvent(pool, broken);
    await w.queue.sendEvent(failed);
    // Its first run has failed and it is waiting for its retry.
    await until(async () => (await stateOf(failed)) === 'retry');

    const handled = await emitEvent(pool, healthy);
    await w.queue.sendEvent(handled);
    await until(async () => (await studentBalance(pool, healthy)) === FEE);
    // The first school's event has not reached its end yet.
    expect(await stateOf(failed)).not.toBe('failed');

    // The last retry fails too, and the job is failed for good in pg-boss.
    await until(async () => (await stateOf(failed)) === 'failed', 100_000);
    const failures = await until(async () => {
      const rows = await failuresOf(pool, broken.id);
      return rows.length > 0 ? rows : null;
    }, 10_000);
    await w.worker.stop();

    expect(failures).toEqual([
      {
        eventId: failed.eventId,
        error: 'No registration fee is configured',
        failedAt: expect.any(Date),
      },
    ]);
    expect(await failuresOf(pool, healthy.id)).toEqual([]);
  }, 130_000);

  it('left nothing in the ledger and no decision for that event', async () => {
    expect(await feeEntries(pool, broken.id)).toEqual([]);
    expect(await studentBalance(pool, broken)).toBe('0.00');
    expect(await handlerOf(pool, failed)).toEqual([]);
  });

  it('adds no second row when the dead-letter job runs again for the same event', async () => {
    const [before] = await failuresOf(pool, broken.id);

    await w.runner.recordFailure(failed, 'A later error');

    expect(await failuresOf(pool, broken.id)).toEqual([before]);
  });

  it('is logged, fails the dead-letter job and is recorded nowhere when the event is not in the job’s school', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const forged = { eventId: failed.eventId, tenantId: healthy.id };

    await expect(w.runner.recordFailure(forged, 'An error')).rejects.toThrow(
      `Event ${failed.eventId} is not in school ${healthy.id}`,
    );

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        `Could not record the failure of event ${failed.eventId}`,
      ),
    );
    log.mockRestore();
    expect(await failuresOf(pool, healthy.id)).toEqual([]);
    expect(await failuresOf(pool, broken.id)).toHaveLength(1);
  });
});
