import { sql } from 'drizzle-orm';
import pg from 'pg';
import { ledgerSchools, userLedger } from '../../db/seed.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { LedgerService } from '../../src/finance/ledger.service.js';
import { committed, runtimePool } from '../support/db.js';
import { Books, setUpBooks } from '../support/ledger.js';

const school = ledgerSchools.revaluation;
const S = school.students.s;

class RolledBack extends Error {
  constructor(readonly lines: string[]) {
    super('rolled back on purpose');
  }
}

// One school, base currency AED, written only by this file.
describe('revaluation as of its date', () => {
  let pool: pg.Pool;
  let tenantDb: TenantDb;
  let ledger: LedgerService;
  let books: Books;

  beforeAll(async () => {
    pool = runtimePool();
    tenantDb = new TenantDb(pool);
    ledger = new LedgerService(tenantDb);
    books = await setUpBooks(pool, school.id, userLedger.id);
    // 9.7500 from 1 January (set up above), 9.7000 from 10 January and
    // 9.8000 from 15 January (set up above).
    await committed(
      pool,
      { userId: userLedger.id, tenantId: school.id },
      (client) =>
        client.query(
          'insert into fx_rates (currency, rate_date, rate) values ($1, $2, $3)',
          ['BHD', '2026-01-10', '9.7000'],
        ),
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  const run = <R>(fn: () => Promise<R>) =>
    tenantDb.run(userLedger.id, school.id, fn);

  const receive = (date: string, foreignAmount: string) =>
    run(() =>
      ledger.convert({
        periodId: books.periods.jan2026,
        date,
        kind: 'payment',
        currency: 'BHD',
        foreignAccountId: books.accounts.bankBhd,
        foreignAmount,
        baseAccountId: books.accounts.receivables,
        studentId: S,
      }),
    );

  const revalueOn = (date: string) =>
    ledger.revalue({
      currency: 'BHD',
      periodId: books.periods.jan2026,
      date,
    });

  const linesOf = async (entryId: string | null): Promise<string[]> => {
    if (entryId === null) return [];
    const result = await tenantDb.db.execute<{ line: string }>(sql`
      select a.code || ' ' || l.currency || ' ' || l.amount::text as line
        from ledger_lines l
        join ledger_accounts a on a.id = l.account_id
       where l.entry_id = ${entryId}
       order by l.line_no
    `);
    return result.rows.map((row) => row.line);
  };

  // Revalues inside a transaction that is rolled back, and returns the lines
  // it would have posted.
  async function revaluationThatWouldBePosted(date: string): Promise<string[]> {
    try {
      await run(async () => {
        throw new RolledBack(await linesOf(await revalueOn(date)));
      });
    } catch (error) {
      if (error instanceof RolledBack) return error.lines;
      throw error;
    }
    throw new Error('the transaction was not rolled back');
  }

  it('ignores a conversion dated after the revaluation date', async () => {
    // 100.000 BHD received on 8 January at 9.7500: the base side is 975.00.
    await receive('2026-01-08', '100.000');

    // Revalued as of 10 January at 9.7000: the target is 970.00, a loss of 5.00.
    const without = await revaluationThatWouldBePosted('2026-01-10');
    expect(without).toEqual(['1902 AED -5.0000', '7900 AED 5.0000']);

    // 50.000 BHD received on 20 January at 9.8000, after the revaluation date.
    await receive('2026-01-20', '50.000');

    const withLaterConversion = await run(async () =>
      linesOf(await revalueOn('2026-01-10')),
    );
    expect(withLaterConversion).toEqual(without);
  });

  it('finds no difference when the same date is revalued again', async () => {
    expect(await run(() => revalueOn('2026-01-10'))).toBeNull();
  });

  it('counts the later conversion once the revaluation date reaches it', async () => {
    // As of 31 January at 9.8000: 150.000 BHD are worth 1,470.00, and the
    // base side is 975.00 - 5.00 + 490.00 = 1,460.00, a gain of 10.00.
    const lines = await run(async () => linesOf(await revalueOn('2026-01-31')));
    expect(lines).toEqual(['1902 AED 10.0000', '7900 AED -10.0000']);
  });
});
