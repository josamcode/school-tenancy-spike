import pg from 'pg';
import { eventSchools, userEvents } from '../../db/seed.js';
import { runtimePool } from '../support/db.js';
import {
  emitEvent,
  feeEntries,
  setFee,
  startWorker,
  TestWorker,
} from '../support/events.js';
import { Books, setUpBooks } from '../support/ledger.js';

const school = eventSchools.feeDate;

// One school in Asia/Dubai (UTC+4) with finance on, written only by this file.
// Its books have December 2025 and January 2026 open.
describe('the date of a registration fee', () => {
  let pool: pg.Pool;
  let w: TestWorker;
  let books: Books;

  beforeAll(async () => {
    pool = runtimePool();
    w = await startWorker();
    books = await setUpBooks(pool, school.id, userEvents.id);
    await setFee(books);
  });

  afterAll(async () => {
    await w?.stop();
    await pool.end();
  });

  it('is the acceptance’s date in the school’s timezone: 21:30 UTC on 31 December is 1 January in Dubai', async () => {
    const ref = await emitEvent(pool, school, '2025-12-31T21:30:00Z');
    await w.runner.handle(ref);

    const entries = await feeEntries(pool, school.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      date: '2026-01-01',
      periodId: books.periods.jan2026,
    });
  });

  it('stays on 31 December for an acceptance at 19:30 UTC, which is 23:30 in Dubai', async () => {
    const ref = await emitEvent(pool, school, '2025-12-31T19:30:00Z');
    await w.runner.handle(ref);

    const entries = await feeEntries(pool, school.id);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      date: '2025-12-31',
      periodId: books.periods.dec2025,
    });
  });

  it('fails, and records nothing, when no open period holds that date', async () => {
    const ref = await emitEvent(pool, school, '2027-03-01T08:00:00Z');
    await expect(w.runner.handle(ref)).rejects.toThrow(
      'No open period for 2027-03-01',
    );
    expect(await feeEntries(pool, school.id)).toHaveLength(2);
  });
});
