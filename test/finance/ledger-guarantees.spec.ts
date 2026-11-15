import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {
  ledgerSchools,
  schoolA,
  studentsA,
  userLedger,
} from '../../db/seed.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { LedgerService } from '../../src/finance/ledger.service.js';
import {
  checkViolation,
  committed,
  exclusionViolation,
  failureOf,
  foreignKeyViolation,
  inScope,
  ownerPool,
  permissionDenied,
  refused,
  runtimePool,
  uniqueViolation,
} from '../support/db.js';
import {
  balancedPair,
  Books,
  createInvoice,
  insertEntry,
  RawLine,
  setUpBooks,
} from '../support/ledger.js';

const school = ledgerSchools.guarantees;
const S = school.students.s;

// One school, written only by this file. Every attempt below is made with
// plain SQL, so nothing here depends on the ledger service being correct.
describe('ledger guarantees enforced by the database', () => {
  let runtime: pg.Pool;
  let owner: pg.Pool;
  let books: Books;
  let posted: string;
  const scope = { userId: userLedger.id, tenantId: school.id };

  // Tries to commit an entry and returns why the database refused it.
  const commitEntry = (
    pool: pg.Pool,
    lines: RawLine[],
    period: 'oct2025' | 'nov2025' | 'dec2025' | 'jan2026' = 'dec2025',
    date = '2025-12-05',
  ) =>
    failureOf(() =>
      committed(pool, scope, (client) =>
        insertEntry(client, books, { period, date, lines }),
      ),
    );

  const attempt = (pool: pg.Pool, sql: string, params: unknown[] = []) =>
    inScope(pool, scope, (client) =>
      failureOf(() => client.query(sql, params)),
    );

  beforeAll(async () => {
    runtime = runtimePool();
    owner = ownerPool();
    books = await setUpBooks(runtime, school.id, userLedger.id);
    posted = await committed(runtime, scope, (client) =>
      insertEntry(client, books, {
        period: 'dec2025',
        date: '2025-12-01',
        lines: balancedPair('100.00'),
      }),
    );
  });

  afterAll(async () => {
    await runtime.end();
    await owner.end();
  });

  describe('1. every entry balances when its transaction commits', () => {
    it('accepts a balanced entry', async () => {
      expect(await commitEntry(runtime, balancedPair())).toBeNull();
    });

    it.each([
      ['the runtime role', () => runtime],
      ['the owner role', () => owner],
    ])('refuses an unbalanced entry from %s', async (_, pool) => {
      const failure = await commitEntry(pool(), [
        { account: 'bankAed', amount: '100.00' },
        { account: 'tuition', amount: '-90.00' },
      ]);
      expect(failure).toMatchObject(refused('does not balance in AED'));
    });

    it('refuses an entry with no lines', async () => {
      expect(await commitEntry(runtime, [])).toMatchObject(
        refused('at least two lines'),
      );
    });

    it('refuses an entry with one line', async () => {
      const failure = await commitEntry(runtime, [
        { account: 'bankAed', amount: '100.00' },
      ]);
      expect(failure).toMatchObject(refused('at least two lines'));
    });

    it('refuses an entry that sums to zero overall but not in each currency', async () => {
      const failure = await commitEntry(runtime, [
        { account: 'bankAed', amount: '100.00' },
        { account: 'bankBhd', amount: '-100.000' },
      ]);
      expect(failure).toMatchObject(refused('does not balance in'));
    });

    it('refuses a zero line', async () => {
      const failure = await commitEntry(runtime, [
        { account: 'bankAed', amount: '0.00' },
        { account: 'tuition', amount: '0.00' },
      ]);
      expect(failure).toMatchObject(checkViolation);
    });

    it('leaves nothing behind when a commit is refused', async () => {
      const count = async () =>
        (
          await inScope(runtime, scope, (client) =>
            client.query('select count(*)::int as n from ledger_entries'),
          )
        ).rows[0].n;
      const before = await count();
      await commitEntry(runtime, [
        { account: 'bankAed', amount: '5.00' },
        { account: 'tuition', amount: '-4.00' },
      ]);
      expect(await count()).toBe(before);
    });
  });

  describe('2. posted entries and lines cannot be updated or deleted', () => {
    const statements = [
      ['update ledger_lines set amount = -amount'],
      ['delete from ledger_lines'],
      ['truncate ledger_lines'],
      ['update ledger_entries set description = null'],
      ['delete from ledger_entries'],
      ['truncate ledger_entries cascade'],
    ];

    it.each(statements)('refuses the runtime role: %s', async (sql) => {
      expect(await attempt(runtime, sql)).toMatchObject(permissionDenied);
    });

    it.each(statements)('refuses the owner role too: %s', async (sql) => {
      expect(await attempt(owner, sql)).toMatchObject(refused('append-only'));
    });

    it('refuses lines added to an entry that was posted in an earlier transaction', async () => {
      const failure = await failureOf(() =>
        committed(runtime, scope, async (client) => {
          for (const [lineNo, account, amount] of [
            [3, 'bankAed', '5.00'],
            [4, 'tuition', '-5.00'],
          ] as const) {
            await client.query(
              `insert into ledger_lines (entry_id, line_no, account_id, currency, amount)
               values ($1, $2, $3, 'AED', $4)`,
              [posted, lineNo, books.accounts[account], amount],
            );
          }
        }),
      );
      expect(failure).toMatchObject(
        refused('in the transaction that posts their entry'),
      );
    });

    it('still has the original entry exactly as it was posted', async () => {
      const { rows } = await inScope(runtime, scope, (client) =>
        client.query(
          `select amount::text as amount from ledger_lines
            where entry_id = $1 order by line_no`,
          [posted],
        ),
      );
      expect(rows).toEqual([{ amount: '100.0000' }, { amount: '-100.0000' }]);
    });
  });

  describe('3. nothing posts into a locked period', () => {
    beforeAll(async () => {
      await committed(runtime, scope, (client) =>
        client.query(
          "update ledger_periods set status = 'locked' where id = $1",
          [books.periods.nov2025],
        ),
      );
    });

    it.each([
      ['the runtime role', () => runtime],
      ['the owner role', () => owner],
    ])('refuses a posting into the locked period from %s', async (_, pool) => {
      const failure = await commitEntry(
        pool(),
        balancedPair(),
        'nov2025',
        '2025-11-15',
      );
      expect(failure).toMatchObject(refused('period is locked'));
    });

    it('still accepts a posting into an open period', async () => {
      expect(
        await commitEntry(runtime, balancedPair(), 'dec2025', '2025-12-06'),
      ).toBeNull();
    });

    it('refuses an entry dated outside its period', async () => {
      const failure = await commitEntry(
        runtime,
        balancedPair(),
        'dec2025',
        '2026-01-02',
      );
      expect(failure).toMatchObject(refused('outside its period'));
    });

    it.each([
      ['the runtime role', () => runtime],
      ['the owner role', () => owner],
    ])('refuses to reopen a locked period for %s', async (_, pool) => {
      const failure = await attempt(
        pool(),
        "update ledger_periods set status = 'open' where id = $1",
        [books.periods.nov2025],
      );
      expect(failure).toMatchObject(refused('cannot be reopened'));
    });

    it('does not let the runtime role move a period’s dates', async () => {
      const failure = await attempt(
        runtime,
        "update ledger_periods set end_date = '2025-12-15' where id = $1",
        [books.periods.dec2025],
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it('does not let the owner role move a period’s dates either', async () => {
      const failure = await attempt(
        owner,
        "update ledger_periods set end_date = '2025-12-15' where id = $1",
        [books.periods.dec2025],
      );
      expect(failure).toMatchObject(refused('only the status of a period'));
    });

    it('refuses a period that overlaps another period of the same school', async () => {
      const failure = await attempt(
        runtime,
        `insert into ledger_periods (id, year_id, start_date, end_date)
         values ($1, $2, '2025-12-15', '2025-12-20')`,
        [randomUUID(), books.years.fy2025],
      );
      expect(failure).toMatchObject(exclusionViolation);
    });

    it('refuses a period that lies outside its financial year', async () => {
      const failure = await attempt(
        runtime,
        `insert into ledger_periods (id, year_id, start_date, end_date)
         values ($1, $2, '2026-02-01', '2026-02-28')`,
        [randomUUID(), books.years.fy2025],
      );
      expect(failure).toMatchObject(refused('outside its financial year'));
    });
  });

  describe('amounts follow the currency’s minor units', () => {
    const line = (lines: RawLine[]) =>
      inScope(runtime, scope, (client) =>
        failureOf(() =>
          insertEntry(client, books, {
            period: 'dec2025',
            date: '2025-12-05',
            lines,
          }),
        ),
      );

    it('refuses a third decimal in AED', async () => {
      const failure = await line([{ account: 'bankAed', amount: '12.345' }]);
      expect(failure).toMatchObject(refused('more decimals than AED allows'));
    });

    it('accepts a third decimal in BHD', async () => {
      expect(await line([{ account: 'bankBhd', amount: '12.345' }])).toBeNull();
    });

    it('refuses a fourth decimal in BHD', async () => {
      const failure = await line([{ account: 'bankBhd', amount: '12.3456' }]);
      expect(failure).toMatchObject(refused('more decimals than BHD allows'));
    });
  });

  describe('accounts and lines', () => {
    const line = (lines: RawLine[]) =>
      inScope(runtime, scope, (client) =>
        failureOf(() =>
          insertEntry(client, books, {
            period: 'dec2025',
            date: '2025-12-05',
            lines,
          }),
        ),
      );

    it('refuses a BHD line on an AED account', async () => {
      const failure = await line([
        { account: 'bankAed', amount: '10.000', currency: 'BHD' },
      ]);
      expect(failure).toMatchObject(foreignKeyViolation);
    });

    it('refuses a line on a control account with no student', async () => {
      const failure = await line([{ account: 'receivables', amount: '10.00' }]);
      expect(failure).toMatchObject(refused('needs a student'));
    });

    it('refuses a student on an account that is not a control account', async () => {
      const failure = await line([
        { account: 'bankAed', amount: '10.00', student: S },
      ]);
      expect(failure).toMatchObject(refused('only a control account'));
    });

    it('refuses a control line for a student of another school', async () => {
      const failure = await line([
        { account: 'receivables', amount: '10.00', student: studentsA[0].id },
      ]);
      expect(failure).toMatchObject(foreignKeyViolation);
    });

    it('does not let the runtime role change an account', async () => {
      const failure = await attempt(
        runtime,
        'update ledger_accounts set is_control = true where id = $1',
        [books.accounts.bankAed],
      );
      expect(failure).toMatchObject(permissionDenied);
    });
  });

  describe('base currency', () => {
    it('is set for the school and is AED', async () => {
      const { rows } = await inScope(runtime, scope, (client) =>
        client.query('select base_currency from finance_settings'),
      );
      expect(rows).toEqual([{ base_currency: 'AED' }]);
    });

    it('cannot be changed by the runtime role', async () => {
      const failure = await attempt(
        runtime,
        "update finance_settings set base_currency = 'SAR'",
      );
      expect(failure).toMatchObject(permissionDenied);
    });

    it('cannot be changed by the owner role either', async () => {
      const failure = await attempt(
        owner,
        "update finance_settings set base_currency = 'SAR'",
      );
      expect(failure).toMatchObject(refused('base currency cannot be changed'));
    });
  });

  describe('FX positions', () => {
    const newAccount = async (client: pg.PoolClient, currency: string) => {
      const id = randomUUID();
      await client.query(
        `insert into ledger_accounts (id, code, name, type, currency)
         values ($1, $2, 'Scratch', 'asset', $3)`,
        [id, `9${id.slice(0, 5)}`, currency],
      );
      return id;
    };
    const position = (
      build: (client: pg.PoolClient) => Promise<[string, string, string]>,
    ) =>
      inScope(runtime, scope, (client) =>
        failureOf(async () => {
          const [currency, foreign, base] = await build(client);
          await client.query(
            `insert into fx_positions
               (currency, base_currency, foreign_account_id, base_account_id, gain_loss_account_id)
             values ($1, 'AED', $2, $3, $4)`,
            [currency, foreign, base, books.accounts.fxGainLoss],
          );
        }),
      );

    it('accepts a position with its own two accounts and the shared gain or loss account', async () => {
      const failure = await position(async (client) => [
        'QAR',
        await newAccount(client, 'QAR'),
        await newAccount(client, 'AED'),
      ]);
      expect(failure).toBeNull();
    });

    it('refuses a foreign-side account that already serves another position', async () => {
      const failure = await position(async (client) => [
        'QAR',
        books.accounts.fxBhd,
        await newAccount(client, 'AED'),
      ]);
      expect(failure).toMatchObject(uniqueViolation);
    });

    it('refuses a base-side account that already serves another position', async () => {
      const failure = await position(async (client) => [
        'QAR',
        await newAccount(client, 'QAR'),
        books.accounts.fxBhdAed,
      ]);
      expect(failure).toMatchObject(uniqueViolation);
    });

    it('refuses a foreign-side account that is not in the position’s currency', async () => {
      const failure = await position(async (client) => [
        'QAR',
        await newAccount(client, 'OMR'),
        await newAccount(client, 'AED'),
      ]);
      expect(failure).toMatchObject(foreignKeyViolation);
    });

    it('refuses a base-side account that is not in the school’s base currency', async () => {
      const failure = await position(async (client) => [
        'QAR',
        await newAccount(client, 'QAR'),
        await newAccount(client, 'OMR'),
      ]);
      expect(failure).toMatchObject(foreignKeyViolation);
    });

    it('refuses a position in the base currency itself', async () => {
      const failure = await position(async (client) => [
        'AED',
        await newAccount(client, 'AED'),
        await newAccount(client, 'AED'),
      ]);
      expect(failure).toMatchObject(checkViolation);
    });

    it('refuses a position that names another base currency than the school’s', async () => {
      const failure = await inScope(runtime, scope, (client) =>
        failureOf(async () => {
          await client.query(
            `insert into fx_positions
               (currency, base_currency, foreign_account_id, base_account_id, gain_loss_account_id)
             values ('QAR', 'SAR', $1, $2, $3)`,
            [
              await newAccount(client, 'QAR'),
              await newAccount(client, 'SAR'),
              books.accounts.tuitionSar,
            ],
          );
        }),
      );
      expect(failure).toMatchObject(foreignKeyViolation);
    });
  });

  describe('isolation', () => {
    const ledgerTables = [
      'finance_settings',
      'financial_years',
      'ledger_periods',
      'ledger_accounts',
      'fx_rates',
      'fx_positions',
      'ledger_entries',
      'ledger_lines',
    ];

    it.each(ledgerTables)(
      '%s shows this school only its own rows',
      async (table) => {
        const { rows } = await inScope(runtime, scope, (client) =>
          client.query(`select tenant_id from ${table}`),
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((row) => row.tenant_id === school.id)).toBe(true);
      },
    );

    it.each(ledgerTables)(
      '%s returns zero rows with no tenant set',
      async (table) => {
        const { rows } = await inScope(runtime, {}, (client) =>
          client.query(`select * from ${table}`),
        );
        expect(rows).toEqual([]);
      },
    );

    it.each(ledgerTables)(
      '%s returns zero rows to another school',
      async (table) => {
        const { rows } = await inScope(
          runtime,
          { tenantId: schoolA.id },
          (client) => client.query(`select * from ${table}`),
        );
        expect(rows).toEqual([]);
      },
    );

    it('refuses an entry written for another school', async () => {
      const failure = await attempt(
        runtime,
        `insert into ledger_entries (tenant_id, id, period_id, entry_date, kind)
         values ($1, $2, $3, '2025-12-05', 'adjustment')`,
        [schoolA.id, randomUUID(), books.periods.dec2025],
      );
      // The period trigger runs before the policy check and cannot see a
      // period of that school, so either of them may be the one that refuses.
      expect(['P0001', '42501']).toContain(failure?.code);
    });

    it('refuses a line written for another school', async () => {
      const failure = await attempt(
        runtime,
        `insert into ledger_lines (tenant_id, entry_id, line_no, account_id, currency, amount)
         values ($1, $2, 9, $3, 'AED', 1)`,
        [schoolA.id, posted, books.accounts.bankAed],
      );
      expect(['P0001', '42501']).toContain(failure?.code);
    });

    it('refuses another school posting a line into this school’s entry', async () => {
      const failure = await inScope(
        runtime,
        { userId: userLedger.id, tenantId: schoolA.id },
        (client) =>
          failureOf(() =>
            client.query(
              `insert into ledger_lines (entry_id, line_no, account_id, currency, amount)
               values ($1, 9, $2, 'AED', 1)`,
              [posted, books.accounts.bankAed],
            ),
          ),
      );
      expect(failure).not.toBeNull();
    });
  });

  // These go through the ledger service.
  describe('reversals, rates and invoices', () => {
    let ledger: LedgerService;
    let run: <R>(fn: (ledger: LedgerService) => Promise<R>) => Promise<R>;
    const linesOf = async (entryId: string) =>
      (
        await inScope(runtime, scope, (client) =>
          client.query(
            `select account_id, currency, amount::text as amount, student_id
               from ledger_lines where entry_id = $1 order by line_no`,
            [entryId],
          ),
        )
      ).rows;

    beforeAll(() => {
      const tenantDb = new TenantDb(runtime);
      ledger = new LedgerService(tenantDb);
      run = (fn) => tenantDb.run(userLedger.id, school.id, () => fn(ledger));
    });

    it('reverses an entry with the same lines negated and a link to the original', async () => {
      const original = await run((l) =>
        l.post({
          periodId: books.periods.dec2025,
          date: '2025-12-07',
          kind: 'late_fee',
          lines: [
            {
              accountId: books.accounts.receivables,
              amount: '40.00',
              studentId: S,
            },
            { accountId: books.accounts.lateFees, amount: '-40.00' },
          ],
        }),
      );
      const reversal = await run((l) =>
        l.reverse(original, {
          periodId: books.periods.jan2026,
          date: '2026-01-03',
        }),
      );

      const before = await linesOf(original);
      const after = await linesOf(reversal);
      expect(after).toEqual(
        before.map((row) => ({
          ...row,
          amount: row.amount.startsWith('-')
            ? row.amount.slice(1)
            : `-${row.amount}`,
        })),
      );

      // A second reversal of the same entry is refused by the database.
      await expect(
        run((l) =>
          l.reverse(original, {
            periodId: books.periods.jan2026,
            date: '2026-01-04',
          }),
        ),
      ).rejects.toMatchObject({ cause: uniqueViolation });
    });

    it('keeps the rate of a posted conversion when the rate table changes later', async () => {
      const entryId = await run((l) =>
        l.convert({
          periodId: books.periods.jan2026,
          date: '2026-01-08',
          kind: 'payment',
          currency: 'BHD',
          foreignAccountId: books.accounts.bankBhd,
          foreignAmount: '10.000',
          baseAccountId: books.accounts.receivables,
          studentId: S,
        }),
      );
      const read = async () => ({
        lines: await linesOf(entryId),
        entry: (
          await inScope(runtime, scope, (client) =>
            client.query(
              `select fx_currency, fx_rate::text as fx_rate
                 from ledger_entries where id = $1`,
              [entryId],
            ),
          )
        ).rows[0],
      });
      const before = await read();
      expect(before.entry).toEqual({
        fx_currency: 'BHD',
        fx_rate: '9.75000000',
      });

      // A different rate, dated before the entry, arrives afterwards.
      await committed(runtime, scope, (client) =>
        client.query(
          'insert into fx_rates (currency, rate_date, rate) values ($1, $2, $3)',
          ['BHD', '2026-01-05', '9.9000'],
        ),
      );

      expect(await read()).toEqual(before);
    });

    it('refuses a conversion on a date with no rate', async () => {
      await expect(
        run((l) =>
          l.convert({
            periodId: books.periods.dec2025,
            date: '2025-12-10',
            kind: 'payment',
            currency: 'BHD',
            foreignAccountId: books.accounts.bankBhd,
            foreignAmount: '10.000',
            baseAccountId: books.accounts.receivables,
            studentId: S,
          }),
        ),
      ).rejects.toThrow(/No BHD rate/);
    });

    it('refuses a conversion in a currency that has no position', async () => {
      await expect(
        run((l) =>
          l.convert({
            periodId: books.periods.jan2026,
            date: '2026-01-08',
            kind: 'payment',
            currency: 'QAR',
            foreignAccountId: books.accounts.bankBhd,
            foreignAmount: '10.00',
            baseAccountId: books.accounts.receivables,
            studentId: S,
          }),
        ),
      ).rejects.toThrow(/No FX position for QAR/);
    });

    it('posts an invoice once and refuses to post it again', async () => {
      const invoiceId = await createInvoice(runtime, books, S, '250.00');
      const post = () =>
        run((l) =>
          l.postInvoice(invoiceId, {
            periodId: books.periods.dec2025,
            date: '2025-12-08',
            receivableAccountId: books.accounts.receivables,
            incomeAccountId: books.accounts.tuition,
          }),
        );

      await expect(post()).resolves.toEqual(expect.any(String));
      await expect(post()).rejects.toMatchObject({ cause: uniqueViolation });
    });

    it('refuses a change to a posted invoice and still allows one that is not posted', async () => {
      const postedInvoice = await createInvoice(runtime, books, S, '300.00');
      const draft = await createInvoice(runtime, books, S, '300.00');
      await run((l) =>
        l.postInvoice(postedInvoice, {
          periodId: books.periods.dec2025,
          date: '2025-12-09',
          receivableAccountId: books.accounts.receivables,
          incomeAccountId: books.accounts.tuition,
        }),
      );

      const change = (pool: pg.Pool, id: string) =>
        attempt(pool, 'update invoices set amount = $2 where id = $1', [
          id,
          '1.00',
        ]);

      expect(await change(runtime, postedInvoice)).toMatchObject(
        refused('posted invoice cannot be changed'),
      );
      expect(await change(owner, postedInvoice)).toMatchObject(
        refused('posted invoice cannot be changed'),
      );
      expect(
        await attempt(owner, 'delete from invoices where id = $1', [
          postedInvoice,
        ]),
      ).toMatchObject(refused('posted invoice cannot be changed'));
      expect(await change(runtime, draft)).toBeNull();
    });
  });
});
