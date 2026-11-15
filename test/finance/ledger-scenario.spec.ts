import pg from 'pg';
import { ledgerSchools, userLedger } from '../../db/seed.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { LedgerService } from '../../src/finance/ledger.service.js';
import { committed, inScope, runtimePool } from '../support/db.js';
import {
  AccountKey,
  Books,
  createInvoice,
  setUpBooks,
} from '../support/ledger.js';

const school = ledgerSchools.scenario;
const S = school.students.s;
const T = school.students.t;

// One school, base currency AED, written only by this file. The steps run in
// order and each one builds on the one before.
describe('ledger netting scenario', () => {
  let pool: pg.Pool;
  let ledger: LedgerService;
  let books: Books;
  let run: <R>(fn: (ledger: LedgerService) => Promise<R>) => Promise<R>;
  const entries: Record<string, string> = {};

  beforeAll(async () => {
    pool = runtimePool();
    const tenantDb = new TenantDb(pool);
    ledger = new LedgerService(tenantDb);
    run = (fn) => tenantDb.run(userLedger.id, school.id, () => fn(ledger));
    books = await setUpBooks(pool, school.id, userLedger.id);
  });

  afterAll(async () => {
    await pool.end();
  });

  const account = (key: AccountKey) => books.accounts[key];
  const balance = (key: AccountKey) =>
    run((l) => l.accountBalance(account(key)));
  const scope = () => ({ userId: userLedger.id, tenantId: school.id });

  async function owes(): Promise<Record<string, string>> {
    const rows = await run((l) => l.studentBalances());
    return Object.fromEntries(
      rows.map((row) => [`${row.studentId} ${row.currency}`, row.balance]),
    );
  }

  async function linesOf(entryId: string) {
    const { rows } = await inScope(pool, scope(), (client) =>
      client.query(
        `select a.code, l.currency, l.amount::text as amount, l.student_id
           from ledger_lines l
           join ledger_accounts a on a.id = l.account_id
          where l.entry_id = $1
          order by l.line_no`,
        [entryId],
      ),
    );
    return rows.map(
      (row) =>
        `${row.code} ${row.currency} ${row.amount}${row.student_id ? ` ${row.student_id}` : ''}`,
    );
  }

  async function expectEveryCurrencyToSumToZero(currencies: string[]) {
    const totals = await run((l) => l.currencyTotals());
    expect(totals.map((row) => row.currency).sort()).toEqual(currencies);
    for (const { total } of totals) expect(total).toMatch(/^0\.0+$/);
  }

  it('1. posts an invoice of 1,000.00 for S in December 2025', async () => {
    const invoiceId = await createInvoice(pool, books, S, '1000.00');
    entries.invoiceS = await run((l) =>
      l.postInvoice(invoiceId, {
        periodId: books.periods.dec2025,
        date: '2025-12-10',
        receivableAccountId: account('receivables'),
        incomeAccountId: account('tuition'),
      }),
    );
    entries.invoiceSDocument = invoiceId;

    expect(await linesOf(entries.invoiceS)).toEqual([
      `1100 AED 1000.0000 ${S}`,
      '4000 AED -1000.0000',
    ]);
    expect(await owes()).toEqual({ [`${S} AED`]: '1000.00' });
    await expectEveryCurrencyToSumToZero(['AED']);
  });

  it('2. posts a sibling discount of 100.00 for S', async () => {
    entries.discount = await run((l) =>
      l.post({
        periodId: books.periods.dec2025,
        date: '2025-12-10',
        kind: 'discount',
        invoiceId: entries.invoiceSDocument,
        lines: [
          { accountId: account('discounts'), amount: '100.00' },
          {
            accountId: account('receivables'),
            amount: '-100.00',
            studentId: S,
          },
        ],
      }),
    );
    expect(await owes()).toEqual({ [`${S} AED`]: '900.00' });
  });

  it('3. posts an invoice of 500.00 for T', async () => {
    const invoiceId = await createInvoice(pool, books, T, '500.00');
    entries.invoiceT = await run((l) =>
      l.postInvoice(invoiceId, {
        periodId: books.periods.dec2025,
        date: '2025-12-10',
        receivableAccountId: account('receivables'),
        incomeAccountId: account('tuition'),
      }),
    );
    expect(await owes()).toEqual({
      [`${S} AED`]: '900.00',
      [`${T} AED`]: '500.00',
    });
  });

  it('4. receives 100.000 BHD from S in January 2026 at 9.7500', async () => {
    entries.paymentS = await run((l) =>
      l.convert({
        periodId: books.periods.jan2026,
        date: '2026-01-08',
        kind: 'payment',
        currency: 'BHD',
        foreignAccountId: account('bankBhd'),
        foreignAmount: '100.000',
        baseAccountId: account('receivables'),
        studentId: S,
      }),
    );

    expect(await linesOf(entries.paymentS)).toEqual([
      '1020 BHD 100.0000',
      '1901 BHD -100.0000',
      `1100 AED -975.0000 ${S}`,
      '1902 AED 975.0000',
    ]);
    expect(await owes()).toMatchObject({ [`${S} AED`]: '-75.00' });
    await expectEveryCurrencyToSumToZero(['AED', 'BHD']);
  });

  it('5. receives 300.00 SAR from T at 0.9800, which stays open', async () => {
    entries.paymentT = await run((l) =>
      l.convert({
        periodId: books.periods.jan2026,
        date: '2026-01-12',
        kind: 'payment',
        currency: 'SAR',
        foreignAccountId: account('bankSar'),
        foreignAmount: '300.00',
        baseAccountId: account('receivables'),
        studentId: T,
      }),
    );

    expect(await linesOf(entries.paymentT)).toEqual([
      '1030 SAR 300.0000',
      '1903 SAR -300.0000',
      `1100 AED -294.0000 ${T}`,
      '1904 AED 294.0000',
    ]);
    expect(await owes()).toEqual({
      [`${S} AED`]: '-75.00',
      [`${T} AED`]: '206.00',
    });
    await expectEveryCurrencyToSumToZero(['AED', 'BHD', 'SAR']);
  });

  it('6. posts a late fee back into December 2025 while 2026 already has entries', async () => {
    entries.lateFee = await run((l) =>
      l.post({
        periodId: books.periods.dec2025,
        date: '2025-12-31',
        kind: 'late_fee',
        invoiceId: entries.invoiceSDocument,
        lines: [
          { accountId: account('receivables'), amount: '50.00', studentId: S },
          { accountId: account('lateFees'), amount: '-50.00' },
        ],
      }),
    );
    expect(await owes()).toMatchObject({ [`${S} AED`]: '-25.00' });

    // Both financial years are open at once: this entry is in 2025 and was
    // posted after an entry in 2026.
    const { rows } = await inScope(pool, scope(), (client) =>
      client.query(
        `select e.id, y.name as year, e.posted_at
           from ledger_entries e
           join ledger_periods p on p.id = e.period_id
           join financial_years y on y.id = p.year_id
          where e.id = any ($1)`,
        [[entries.paymentS, entries.lateFee]],
      ),
    );
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[entries.paymentS].year).toBe('FY2026');
    expect(byId[entries.lateFee].year).toBe('FY2025');
    expect(
      byId[entries.lateFee].posted_at >= byId[entries.paymentS].posted_at,
    ).toBe(true);
  });

  it('7. corrects the late fee with a reversing entry and leaves the original as it was', async () => {
    const original = await linesOf(entries.lateFee);
    entries.lateFeeReversal = await run((l) =>
      l.reverse(entries.lateFee, {
        periodId: books.periods.jan2026,
        date: '2026-01-25',
      }),
    );

    expect(await linesOf(entries.lateFee)).toEqual(original);
    expect(await linesOf(entries.lateFeeReversal)).toEqual([
      `1100 AED -50.0000 ${S}`,
      '4100 AED 50.0000',
    ]);
    const { rows } = await inScope(pool, scope(), (client) =>
      client.query(
        'select kind, reverses_entry_id from ledger_entries where id = $1',
        [entries.lateFeeReversal],
      ),
    );
    expect(rows).toEqual([
      { kind: 'reversal', reverses_entry_id: entries.lateFee },
    ]);
    expect(await owes()).toMatchObject({ [`${S} AED`]: '-75.00' });
    expect(await balance('lateFees')).toBe('0.00');
  });

  it('8. refunds 75.00 AED to S, paid as 7.653 BHD at 9.8000', async () => {
    entries.refund = await run((l) =>
      l.convert({
        periodId: books.periods.jan2026,
        date: '2026-01-26',
        kind: 'refund',
        currency: 'BHD',
        foreignAccountId: account('bankBhd'),
        baseAccountId: account('receivables'),
        baseAmount: '75.00',
        studentId: S,
      }),
    );

    expect(await linesOf(entries.refund)).toEqual([
      '1020 BHD -7.6530',
      '1901 BHD 7.6530',
      `1100 AED 75.0000 ${S}`,
      '1902 AED -75.0000',
    ]);
    expect(await owes()).toEqual({
      [`${S} AED`]: '0.00',
      [`${T} AED`]: '206.00',
    });
  });

  it('9. converts the remaining 92.347 BHD to 905.00 AED at the bank', async () => {
    expect(await balance('bankBhd')).toBe('92.347');
    entries.bankConversion = await run((l) =>
      l.convert({
        periodId: books.periods.jan2026,
        date: '2026-01-28',
        kind: 'fx_conversion',
        currency: 'BHD',
        foreignAccountId: account('bankBhd'),
        foreignAmount: '-92.347',
        baseAccountId: account('bankAed'),
      }),
    );

    expect(await linesOf(entries.bankConversion)).toEqual([
      '1020 BHD -92.3470',
      '1901 BHD 92.3470',
      '1010 AED 905.0000',
      '1902 AED -905.0000',
    ]);
    expect(await balance('bankBhd')).toBe('0.000');
    expect(await balance('fxBhd')).toBe('0.000');
    expect(await balance('fxBhdAed')).toBe('-5.00');
  });

  it('10. closes the BHD position by revaluing it, without touching SAR', async () => {
    const sarBefore = [await balance('fxSar'), await balance('fxSarAed')];
    expect(sarBefore).toEqual(['-300.00', '294.00']);

    entries.bhdRevaluation = (await run((l) =>
      l.revalue({
        currency: 'BHD',
        periodId: books.periods.jan2026,
        date: '2026-01-28',
      }),
    ))!;

    expect(await linesOf(entries.bhdRevaluation)).toEqual([
      '1902 AED 5.0000',
      '7900 AED -5.0000',
    ]);
    expect(await balance('fxBhdAed')).toBe('0.00');
    expect([await balance('fxSar'), await balance('fxSarAed')]).toEqual(
      sarBefore,
    );
    // Everything in FX gain or loss so far comes from BHD.
    expect(await balance('fxGainLoss')).toBe('-5.00');
  });

  it('11. revalues the open SAR position at the January closing rate of 0.9790', async () => {
    entries.sarRevaluation = (await run((l) =>
      l.revalue({
        currency: 'SAR',
        periodId: books.periods.jan2026,
        date: '2026-01-31',
      }),
    ))!;

    expect(await linesOf(entries.sarRevaluation)).toEqual([
      '1904 AED -0.3000',
      '7900 AED 0.3000',
    ]);
    // 300.00 SAR held, translated at 0.9790.
    expect(await balance('bankSar')).toBe('300.00');
    expect(await balance('fxSarAed')).toBe('293.70');
    expect(await balance('fxGainLoss')).toBe('-4.70');
  });

  it('posts nothing when the closed BHD position is revalued again at period end', async () => {
    const count = async () =>
      (
        await inScope(pool, scope(), (client) =>
          client.query('select count(*)::int as n from ledger_entries'),
        )
      ).rows[0].n;
    const before = await count();

    const entryId = await run((l) =>
      l.revalue({
        currency: 'BHD',
        periodId: books.periods.jan2026,
        date: '2026-01-31',
      }),
    );

    expect(entryId).toBeNull();
    expect(await count()).toBe(before);
  });

  describe('at the end', () => {
    it('every currency sums to zero', async () => {
      await expectEveryCurrencyToSumToZero(['AED', 'BHD', 'SAR']);
    });

    it('the foreign balances are what is actually held', async () => {
      expect(await balance('bankBhd')).toBe('0.000');
      expect(await balance('fxBhd')).toBe('0.000');
      expect(await balance('bankSar')).toBe('300.00');
      expect(await balance('fxSar')).toBe('-300.00');
    });

    it('the AED ledger balances on its own', async () => {
      const aed: Record<string, string> = {};
      const keys: AccountKey[] = [
        'bankAed',
        'receivables',
        'fxBhdAed',
        'fxSarAed',
        'discounts',
        'lateFees',
        'tuition',
        'fxGainLoss',
      ];
      for (const key of keys) aed[key] = await balance(key);

      expect(aed).toEqual({
        bankAed: '905.00',
        receivables: '206.00',
        fxBhdAed: '0.00',
        fxSarAed: '293.70',
        discounts: '100.00',
        lateFees: '0.00',
        tuition: '-1500.00',
        fxGainLoss: '-4.70',
      });
      const sum = Object.values(aed)
        .map((value) => BigInt(value.replace('.', '')))
        .reduce((total, value) => total + value, 0n);
      expect(sum).toBe(0n);
    });

    it('the student sub-ledger equals the receivables control account', async () => {
      expect(await owes()).toEqual({
        [`${S} AED`]: '0.00',
        [`${T} AED`]: '206.00',
      });

      // The control account balance, read without the service.
      const { rows } = await inScope(pool, scope(), (client) =>
        client.query(
          `select sum(l.amount)::text as balance
             from ledger_lines l
            where l.account_id = $1`,
          [account('receivables')],
        ),
      );
      expect(rows).toEqual([{ balance: '206.0000' }]);
    });

    it('each conversion kept the rate it was posted at', async () => {
      const { rows } = await inScope(pool, scope(), (client) =>
        client.query(
          `select id, fx_currency, fx_rate::text as fx_rate
             from ledger_entries
            where id = any ($1)`,
          [
            [
              entries.paymentS,
              entries.paymentT,
              entries.refund,
              entries.sarRevaluation,
            ],
          ],
        ),
      );
      const stored = Object.fromEntries(
        rows.map((row) => [row.id, `${row.fx_currency} ${row.fx_rate}`]),
      );
      expect(stored).toEqual({
        [entries.paymentS]: 'BHD 9.75000000',
        [entries.paymentT]: 'SAR 0.98000000',
        [entries.refund]: 'BHD 9.80000000',
        [entries.sarRevaluation]: 'SAR 0.97900000',
      });
    });
  });

  describe('locking December 2025', () => {
    const transfer = (period: 'dec2025' | 'jan2026', date: string) =>
      run((l) =>
        l.post({
          periodId: books.periods[period],
          date,
          kind: 'adjustment',
          lines: [
            { accountId: account('bankAed'), amount: '1.00' },
            { accountId: account('tuition'), amount: '-1.00' },
          ],
        }),
      );

    it('refuses a posting into the locked period and still accepts January', async () => {
      await run((l) => l.lockPeriod(books.periods.dec2025));

      await expect(transfer('dec2025', '2025-12-15')).rejects.toMatchObject({
        cause: { message: expect.stringContaining('period is locked') },
      });
      await expect(transfer('jan2026', '2026-01-31')).resolves.toEqual(
        expect.any(String),
      );
    });

    it('lets an entry of the locked period be corrected with a reversal in January', async () => {
      const reversal = await run((l) =>
        l.reverse(entries.invoiceT, {
          periodId: books.periods.jan2026,
          date: '2026-01-31',
        }),
      );
      expect(await linesOf(reversal)).toEqual([
        `1100 AED -500.0000 ${T}`,
        '4000 AED 500.0000',
      ]);

      // The December entry itself is unchanged and still in its locked period.
      const { rows } = await committed(pool, scope(), (client) =>
        client.query(
          `select p.status from ledger_entries e
             join ledger_periods p on p.id = e.period_id
            where e.id = $1`,
          [entries.invoiceT],
        ),
      );
      expect(rows).toEqual([{ status: 'locked' }]);
    });
  });
});
