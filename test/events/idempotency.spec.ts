import pg from 'pg';
import { eventSchools, userEvents } from '../../db/seed.js';
import { EventRef } from '../../src/events/event-types.js';
import { runtimePool, until } from '../support/db.js';
import {
  emitEvent,
  FEE,
  feeEntries,
  handlerOf,
  setFee,
  startWorker,
  studentBalance,
  TestWorker,
} from '../support/events.js';
import { setUpBooks } from '../support/ledger.js';

const schools = [
  eventSchools.financeTwice,
  eventSchools.financeAtOnce,
  eventSchools.financeCrash,
];

// Three schools with finance on and a registration fee of 500.00 AED, each
// written by one test.
describe('an event delivered more than once', () => {
  let pool: pg.Pool;
  let w: TestWorker;

  beforeAll(async () => {
    pool = runtimePool();
    w = await startWorker();
    for (const school of schools) {
      await setFee(await setUpBooks(pool, school.id, userEvents.id));
    }
  });

  afterAll(async () => {
    await w?.stop();
    await pool.end();
  });

  const chargedOnce = async (
    school: { id: string; student: string },
    ref: EventRef,
  ) => {
    expect(await studentBalance(pool, school)).toBe(FEE);
    expect(await feeEntries(pool, school.id)).toHaveLength(1);
    expect(await handlerOf(pool, ref)).toEqual(['finance']);
  };

  it('charges once when the same event is delivered twice', async () => {
    const school = eventSchools.financeTwice;
    const ref = await emitEvent(pool, school);

    await w.runner.handle(ref);
    await chargedOnce(school, ref);

    await w.runner.handle(ref);
    await chargedOnce(school, ref);
  });

  it('posts the charge in the name of the user who accepted the student', async () => {
    const [entry] = await feeEntries(pool, eventSchools.financeTwice.id);
    expect(entry.postedBy).toBe(userEvents.id);
  });

  it('charges once when it is delivered twice at the same moment', async () => {
    const school = eventSchools.financeAtOnce;
    const ref = await emitEvent(pool, school);

    await Promise.all([w.runner.handle(ref), w.runner.handle(ref)]);
    await chargedOnce(school, ref);
  });

  it('does not repeat the charge when the worker dies after the effect commits and before the job is marked done', async () => {
    const school = eventSchools.financeCrash;
    const { boss, names } = w.queue;
    const ref = await emitEvent(pool, school);
    await w.queue.sendEvent(ref);

    // A worker takes the job and runs the handler, which commits.
    const [job] = await boss.fetch<EventRef>(names.events);
    expect(job.data).toEqual(ref);
    await w.runner.handle(job.data);
    await chargedOnce(school, ref);

    // It dies before completing the job. pg-boss fails an active job whose
    // worker is gone once it expires; failing it here is that same
    // transition without the wait.
    await boss.fail(names.events, job.id, { reason: 'worker died' });
    expect((await boss.getJobById(names.events, job.id))?.state).toBe('retry');

    await w.worker.work();
    await until(
      async () =>
        (await boss.getJobById(names.events, job.id))?.state === 'completed',
    );
    await w.worker.stop();

    await chargedOnce(school, ref);
  }, 40_000);
});
