import pg from 'pg';
import { ledgerSchools, userLedger } from '../../db/seed.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { LedgerService } from '../../src/finance/ledger.service.js';
import { inScope, runtimePool } from '../support/db.js';
import {
  AccountKey,
  Books,
  createInvoice,
  setUpBooks,
} from '../support/ledger.js';

const school = ledgerSchools.fx;
const S = school.students.s;
const T = school.students.t;

// One school, base currency AED, written only by this file. The tests run in
// order and share the balances they build.
describe('FX positions and the student sub-ledger', () => {
  let pool: pg.Pool;
  let books: Books;
  let run: <R>(fn: (ledger: LedgerService) => Promise<R>) => Promise<R>;
  const scope = { userId: userLedger.id, tenantId: school.id };

  beforeAll(async () => {
    pool = runtimePool();
    const tenantDb = new TenantDb(pool);
    const ledger = new LedgerService(tenantDb);
    run = (fn) => tenantDb.run(userLedger.id, school.id, () => fn(ledger));
    books = await setUpBooks(pool, school.id, userLedger.id);
  });

  afterAll(async () => {
    await pool.end();
  });

  const account = (key: AccountKey) => books.accounts[key];
  const balance = (key: AccountKey) =>
    run((l) => l.accountBalance(account(key)));
  const entryCount = async () =>
    (
      await inScope(pool, scope, (client) =>
        client.query('select count(*)::int as n from ledger_entries'),
      )
    ).rows[0].n;
  const revalue = (currency: 'BHD' | 'SAR', date: string) =>
    run((l) => l.revalue({ currency, periodId: books.periods.jan2026, date }));

  describe('the sub-ledger with receivables in two currencies', () => {
    it('keeps each student’s AED and SAR balances apart', async () => {
      const invoice = (student: string, amount: string, currency: string) =>
        createInvoice(pool, books, student, amount, currency);
      const post = (
        invoiceId: string,
        receivable: AccountKey,
        income: AccountKey,
      ) =>
        run((l) =>
          l.postInvoice(invoiceId, {
            periodId: books.periods.dec2025,
            date: '2025-12-10',
            receivableAccountId: account(receivable),
            incomeAccountId: account(income),
          }),
        );

      await post(await invoice(S, '300.00', 'AED'), 'receivables', 'tuition');
      await post(
        await invoice(S, '200.00', 'SAR'),
        'receivablesSar',
        'tuitionSar',
      );
      await post(await invoice(T, '100.00', 'AED'), 'receivables', 'tuition');

      const rows = await run((l) => l.studentBalances());
      expect(
        rows
          .map((row) => `${row.studentId} ${row.currency} ${row.balance}`)
          .sort(),
      ).toEqual(
        [`${S} AED 300.00`, `${S} SAR 200.00`, `${T} AED 100.00`].sort(),
      );
    });

    it('reconciles with the control accounts, currency by currency', async () => {
      const rows = await run((l) => l.studentBalances());
      const perCurrency: Record<string, bigint> = {};
      for (const row of rows) {
        perCurrency[row.currency] =
          (perCurrency[row.currency] ?? 0n) +
          BigInt(row.balance.replace('.', ''));
      }

      // The control account balances, read without the service.
      const control = await inScope(pool, scope, (client) =>
        client.query(
          `select a.currency, sum(l.amount) as balance
             from ledger_lines l
             join ledger_accounts a on a.id = l.account_id
            where a.is_control
            group by a.currency
            order by a.currency`,
        ),
      );
      expect(control.rows).toEqual([
        { currency: 'AED', balance: '400.0000' },
        { currency: 'SAR', balance: '200.0000' },
      ]);
      expect(perCurrency).toEqual({ AED: 40000n, SAR: 20000n });
    });
  });

  describe('revaluation', () => {
    it('brings the base side up to the foreign balance when the rate rises', async () => {
      await run((l) =>
        l.convert({
          periodId: books.periods.jan2026,
          date: '2026-01-08',
          kind: 'payment',
          currency: 'BHD',
          foreignAccountId: account('bankBhd'),
          foreignAmount: '20.000',
          baseAccountId: account('receivables'),
          studentId: S,
        }),
      );
      // 20.000 BHD booked at 9.7500.
      expect(await balance('fxBhd')).toBe('-20.000');
      expect(await balance('fxBhdAed')).toBe('195.00');

      // Revalued at 9.8000: the target is -(-20.000) x 9.8000 = 196.00.
      expect(await revalue('BHD', '2026-01-20')).toEqual(expect.any(String));
      expect(await balance('fxBhdAed')).toBe('196.00');
      expect(await balance('fxGainLoss')).toBe('-1.00');
      expect(await balance('fxBhd')).toBe('-20.000');
    });

    it('brings the base side down to the foreign balance when the rate falls', async () => {
      await run((l) =>
        l.convert({
          periodId: books.periods.jan2026,
          date: '2026-01-12',
          kind: 'payment',
          currency: 'SAR',
          foreignAccountId: account('bankSar'),
          foreignAmount: '1000.00',
          baseAccountId: account('receivables'),
          studentId: T,
        }),
      );
      // 1,000.00 SAR booked at 0.9800.
      expect(await balance('fxSar')).toBe('-1000.00');
      expect(await balance('fxSarAed')).toBe('980.00');

      // Revalued at 0.9790: the target is -(-1000.00) x 0.9790 = 979.00.
      expect(await revalue('SAR', '2026-01-31')).toEqual(expect.any(String));
      expect(await balance('fxSarAed')).toBe('979.00');
      expect(await balance('fxGainLoss')).toBe('0.00');
    });

    it('posts no entry when there is no difference', async () => {
      const before = await entryCount();
      expect(await revalue('SAR', '2026-01-31')).toBeNull();
      expect(await revalue('BHD', '2026-01-20')).toBeNull();
      expect(await entryCount()).toBe(before);
    });

    it('stores the currency and the rate on the revaluation entry', async () => {
      const { rows } = await inScope(pool, scope, (client) =>
        client.query(
          `select fx_currency, fx_rate::text as fx_rate
             from ledger_entries
            where kind = 'fx_revaluation'
            order by entry_date`,
        ),
      );
      expect(rows).toEqual([
        { fx_currency: 'BHD', fx_rate: '9.80000000' },
        { fx_currency: 'SAR', fx_rate: '0.97900000' },
      ]);
    });
  });

  describe('closing one position', () => {
    it('leaves the other currency’s two accounts untouched and puts none of its amount in FX gain or loss', async () => {
      const sarBefore = [await balance('fxSar'), await balance('fxSarAed')];
      const gainBefore = await balance('fxGainLoss');

      // Sell every BHD at 9.8000, the rate the position was last valued at.
      await run((l) =>
        l.convert({
          periodId: books.periods.jan2026,
          date: '2026-01-28',
          kind: 'fx_conversion',
          currency: 'BHD',
          foreignAccountId: account('bankBhd'),
          foreignAmount: '-20.000',
          baseAccountId: account('bankAed'),
        }),
      );
      expect(await balance('fxBhd')).toBe('0.000');
      expect(await balance('fxBhdAed')).toBe('0.00');
      expect(await revalue('BHD', '2026-01-28')).toBeNull();

      expect([await balance('fxSar'), await balance('fxSarAed')]).toEqual(
        sarBefore,
      );
      expect(await balance('fxGainLoss')).toBe(gainBefore);
    });

    it('still sums to zero in every currency', async () => {
      const totals = await run((l) => l.currencyTotals());
      expect(totals.map((row) => row.currency).sort()).toEqual([
        'AED',
        'BHD',
        'SAR',
      ]);
      for (const { total } of totals) expect(total).toMatch(/^0\.0+$/);
    });
  });
});
