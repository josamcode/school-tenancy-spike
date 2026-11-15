import pg from 'pg';
import { ledgerSchools, userLedger } from '../../db/seed.js';
import { failureOf, refused, runtimePool } from '../support/db.js';
import {
  balancedPair,
  Books,
  insertEntry,
  setUpBooks,
} from '../support/ledger.js';

const school = ledgerSchools.concurrency;
const lockTimeout = { code: '55P03' };

// One school, written only by this file. Each test uses a period of its own.
describe('period lock under concurrency', () => {
  let pool: pg.Pool;
  let books: Books;

  beforeAll(async () => {
    pool = runtimePool(4);
    books = await setUpBooks(pool, school.id, userLedger.id);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function begin(timeoutMs?: number): Promise<pg.PoolClient> {
    const client = await pool.connect();
    await client.query('begin');
    await client.query("select set_config('app.user_id', $1, true)", [
      userLedger.id,
    ]);
    await client.query("select set_config('app.tenant_id', $1, true)", [
      school.id,
    ]);
    if (timeoutMs) {
      await client.query("select set_config('lock_timeout', $1, true)", [
        `${timeoutMs}ms`,
      ]);
    }
    return client;
  }

  async function end(client: pg.PoolClient, how: 'commit' | 'rollback') {
    try {
      await client.query(how);
    } finally {
      client.release();
    }
  }

  const lockPeriod = (client: pg.PoolClient, periodId: string) =>
    client.query("update ledger_periods set status = 'locked' where id = $1", [
      periodId,
    ]);

  async function entriesIn(periodId: string): Promise<number> {
    const client = await begin();
    try {
      const { rows } = await client.query(
        'select count(*)::int as n from ledger_entries where period_id = $1',
        [periodId],
      );
      return rows[0].n;
    } finally {
      await end(client, 'rollback');
    }
  }

  async function statusOf(periodId: string): Promise<string> {
    const client = await begin();
    try {
      const { rows } = await client.query(
        'select status from ledger_periods where id = $1',
        [periodId],
      );
      return rows[0].status;
    } finally {
      await end(client, 'rollback');
    }
  }

  it('makes a lock wait for a posting that is still open, then the lock succeeds and the entry is in the period', async () => {
    const period = books.periods.oct2025;

    const posting = await begin();
    await insertEntry(posting, books, {
      period: 'oct2025',
      date: '2025-10-10',
      lines: balancedPair(),
    });

    // The posting has not committed, so the lock cannot be taken yet.
    const impatient = await begin(300);
    const waited = await failureOf(() => lockPeriod(impatient, period));
    await end(impatient, 'rollback');
    expect(waited).toMatchObject(lockTimeout);

    await end(posting, 'commit');

    const locker = await begin();
    await lockPeriod(locker, period);
    await end(locker, 'commit');

    expect(await statusOf(period)).toBe('locked');
    expect(await entriesIn(period)).toBe(1);
  });

  it('makes a posting wait for a lock that is still open, then refuses it once the lock commits', async () => {
    const period = books.periods.nov2025;
    const post = (client: pg.PoolClient) =>
      insertEntry(client, books, {
        period: 'nov2025',
        date: '2025-11-10',
        lines: balancedPair(),
      });

    const locker = await begin();
    await lockPeriod(locker, period);

    // The lock has not committed, so the posting cannot go ahead yet.
    const impatient = await begin(300);
    const waited = await failureOf(() => post(impatient));
    await end(impatient, 'rollback');
    expect(waited).toMatchObject(lockTimeout);

    // A posting with no timeout keeps waiting until the lock is decided.
    const patient = await begin();
    const pending = failureOf(() => post(patient));
    await waitUntilBlocked(patient);

    await end(locker, 'commit');
    const outcome = await pending;
    await end(patient, 'rollback');

    expect(outcome).toMatchObject(refused('period is locked'));
    expect(await statusOf(period)).toBe('locked');
    expect(await entriesIn(period)).toBe(0);
  });

  // Polls pg_locks until the given connection is waiting for a lock.
  async function waitUntilBlocked(blocked: pg.PoolClient): Promise<void> {
    const pid = (blocked as unknown as { processID: number }).processID;
    const observer = await pool.connect();
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        const { rows } = await observer.query(
          'select 1 from pg_locks where pid = $1 and not granted',
          [pid],
        );
        if (rows.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('the posting never started waiting for the lock');
    } finally {
      observer.release();
    }
  }
});
