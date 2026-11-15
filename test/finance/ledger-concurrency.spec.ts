import { sql } from 'drizzle-orm';
import pg from 'pg';
import { ledgerSchools, userLedger } from '../../db/seed.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { LedgerService } from '../../src/finance/ledger.service.js';
import { failureOf, refused, runtimePool } from '../support/db.js';
import {
  balancedPair,
  Books,
  createInvoice,
  insertEntry,
  setUpBooks,
} from '../support/ledger.js';

const school = ledgerSchools.concurrency;
const lockTimeout = { code: '55P03' };

// One school, written only by this file. The period lock tests use October
// and November 2025; the others use December 2025 and January 2026.
describe('ledger under concurrency', () => {
  let pool: pg.Pool;
  let books: Books;
  let tenantDb: TenantDb;
  let ledger: LedgerService;

  beforeAll(async () => {
    pool = runtimePool(6);
    books = await setUpBooks(pool, school.id, userLedger.id);
    tenantDb = new TenantDb(pool);
    ledger = new LedgerService(tenantDb);
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

  // The tests below go through the ledger service.
  const S = school.students.s;
  const run = <R>(fn: () => Promise<R>) =>
    tenantDb.run(userLedger.id, school.id, fn);

  // Runs fn in a service transaction and keeps that transaction open until
  // release() is called.
  function held<R>(fn: () => Promise<R>) {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (ready = resolve));
    const done = run(async () => {
      const result = await fn();
      ready();
      await gate;
      return result;
    });
    done.catch(() => ready());
    return { started, release, done };
  }

  // Runs fn in a service transaction that gives up after waiting 300ms for a lock.
  const impatient = <R>(fn: () => Promise<R>) =>
    run(async () => {
      await tenantDb.db.execute(
        sql`select set_config('lock_timeout', '300ms', true)`,
      );
      return fn();
    });

  const settle = <R>(promise: Promise<R>) =>
    promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

  const receive = (currency: 'BHD' | 'SAR', date: string, amount: string) =>
    ledger.convert({
      periodId: books.periods.jan2026,
      date,
      kind: 'payment',
      currency,
      foreignAccountId:
        currency === 'BHD' ? books.accounts.bankBhd : books.accounts.bankSar,
      foreignAmount: amount,
      baseAccountId: books.accounts.receivables,
      studentId: S,
    });

  const revalue = (currency: 'BHD' | 'SAR', date: string) =>
    ledger.revalue({ currency, periodId: books.periods.jan2026, date });

  async function revaluationEntries(currency: string): Promise<number> {
    const client = await begin();
    try {
      const { rows } = await client.query(
        `select count(*)::int as n from ledger_entries
          where kind = 'fx_revaluation' and fx_currency = $1`,
        [currency],
      );
      return rows[0].n;
    } finally {
      await end(client, 'rollback');
    }
  }

  describe('revaluing a position', () => {
    it('makes a second revaluation of the same currency wait, and books the difference once', async () => {
      // 100.000 BHD at 9.7500, revalued at 9.8000: one gain of 5.00.
      await run(() => receive('BHD', '2026-01-08', '100.000'));

      const first = held(() => revalue('BHD', '2026-01-20'));
      await first.started;
      const second = await settle(
        impatient(() => revalue('BHD', '2026-01-20')),
      );
      first.release();
      const firstEntry = await first.done;
      const third = await run(() => revalue('BHD', '2026-01-20'));

      expect(await revaluationEntries('BHD')).toBe(1);
      expect(second).toMatchObject({
        ok: false,
        error: { cause: lockTimeout },
      });
      expect(firstEntry).toEqual(expect.any(String));
      expect(third).toBeNull();
      expect(
        await run(() => ledger.accountBalance(books.accounts.fxGainLoss)),
      ).toBe('-5.00');
    });

    it('makes a conversion in that currency wait until the revaluation commits', async () => {
      // 1,000.00 SAR at 0.9800, revalued at 0.9790.
      await run(() => receive('SAR', '2026-01-12', '1000.00'));

      const revaluation = held(() => revalue('SAR', '2026-01-31'));
      await revaluation.started;

      const gaveUp = await settle(
        impatient(() => receive('SAR', '2026-01-31', '100.00')),
      );

      // A conversion with no timeout keeps waiting until the revaluation is decided.
      let finished = false;
      const patient = run(() => receive('SAR', '2026-01-31', '100.00')).then(
        (entryId) => {
          finished = true;
          return entryId;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      const finishedWhileHeld = finished;

      revaluation.release();
      await revaluation.done;
      await patient;

      expect(gaveUp).toMatchObject({
        ok: false,
        error: { cause: lockTimeout },
      });
      expect(finishedWhileHeld).toBe(false);
      expect(finished).toBe(true);
      // One conversion went through, and the position is still exact:
      // 1,100.00 SAR at 0.9790 on both sides.
      expect(await run(() => ledger.accountBalance(books.accounts.fxSar))).toBe(
        '-1100.00',
      );
      expect(
        await run(() => ledger.accountBalance(books.accounts.fxSarAed)),
      ).toBe('1076.90');
      expect(await run(() => revalue('SAR', '2026-01-31'))).toBeNull();
    });
  });

  describe('posting an invoice', () => {
    it('makes an update of that invoice wait, then refuses it once the posting commits', async () => {
      const invoiceId = await createInvoice(pool, books, S, '400.00');
      const update = (client: pg.PoolClient) =>
        client.query('update invoices set amount = $2 where id = $1', [
          invoiceId,
          '1.00',
        ]);

      const posting = held(() =>
        ledger.postInvoice(invoiceId, {
          periodId: books.periods.dec2025,
          date: '2025-12-10',
          receivableAccountId: books.accounts.receivables,
          incomeAccountId: books.accounts.tuition,
        }),
      );
      await posting.started;

      // The posting has not committed, so the invoice cannot be changed yet.
      const early = await begin(300);
      const waited = await failureOf(() => update(early));
      await end(early, 'rollback');

      posting.release();
      const entryId = await posting.done;

      const late = await begin();
      const afterwards = await failureOf(() => update(late));
      await end(late, 'rollback');

      const reader = await begin();
      const { rows } = await reader.query(
        `select i.amount::text as invoice, l.amount::text as posted
           from invoices i
           join ledger_lines l on l.entry_id = $2 and l.line_no = 1
          where i.id = $1`,
        [invoiceId, entryId],
      );
      await end(reader, 'rollback');

      expect(waited).toMatchObject(lockTimeout);
      expect(afterwards).toMatchObject(
        refused('posted invoice cannot be changed'),
      );
      expect(rows).toEqual([{ invoice: '400.0000', posted: '400.0000' }]);
    });
  });
});
