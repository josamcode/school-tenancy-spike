import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { committed } from './db.js';

const accountDefinitions = {
  bankAed: ['1010', 'Bank AED', 'asset', 'AED', false],
  bankBhd: ['1020', 'Bank BHD', 'asset', 'BHD', false],
  bankSar: ['1030', 'Bank SAR', 'asset', 'SAR', false],
  receivables: ['1100', 'Receivables control', 'asset', 'AED', true],
  receivablesSar: ['1110', 'Receivables control SAR', 'asset', 'SAR', true],
  fxBhd: ['1901', 'FX position BHD', 'asset', 'BHD', false],
  fxBhdAed: ['1902', 'FX position BHD (AED)', 'asset', 'AED', false],
  fxSar: ['1903', 'FX position SAR', 'asset', 'SAR', false],
  fxSarAed: ['1904', 'FX position SAR (AED)', 'asset', 'AED', false],
  tuition: ['4000', 'Tuition income', 'income', 'AED', false],
  tuitionSar: ['4010', 'Tuition income SAR', 'income', 'SAR', false],
  lateFees: ['4100', 'Late fee income', 'income', 'AED', false],
  discounts: ['4900', 'Sibling discounts', 'expense', 'AED', false],
  fxGainLoss: ['7900', 'FX gain or loss', 'income', 'AED', false],
} as const;

export type AccountKey = keyof typeof accountDefinitions;

const periodDefinitions = {
  oct2025: ['fy2025', '2025-10-01', '2025-10-31'],
  nov2025: ['fy2025', '2025-11-01', '2025-11-30'],
  dec2025: ['fy2025', '2025-12-01', '2025-12-31'],
  jan2026: ['fy2026', '2026-01-01', '2026-01-31'],
} as const;

export type PeriodKey = keyof typeof periodDefinitions;

export interface Books {
  schoolId: string;
  userId: string;
  years: { fy2025: string; fy2026: string };
  periods: Record<PeriodKey, string>;
  accounts: Record<AccountKey, string>;
  currencyOf: (account: AccountKey) => string;
}

// AED per unit of the foreign currency.
export const rates = [
  ['BHD', '2026-01-01', '9.7500'],
  ['BHD', '2026-01-15', '9.8000'],
  ['SAR', '2026-01-01', '0.9800'],
  ['SAR', '2026-01-31', '0.9790'],
] as const;

// Creates two open financial years, four periods, a chart of accounts, BHD and
// SAR positions and rates, as the runtime role, for a school whose base
// currency is AED.
export async function setUpBooks(
  pool: pg.Pool,
  schoolId: string,
  userId: string,
): Promise<Books> {
  const years = { fy2025: randomUUID(), fy2026: randomUUID() };
  const periods = Object.fromEntries(
    Object.keys(periodDefinitions).map((key) => [key, randomUUID()]),
  ) as Record<PeriodKey, string>;
  const accounts = Object.fromEntries(
    Object.keys(accountDefinitions).map((key) => [key, randomUUID()]),
  ) as Record<AccountKey, string>;

  await committed(pool, { userId, tenantId: schoolId }, async (client) => {
    await client.query(
      `insert into financial_years (id, name, start_date, end_date)
       values ($1, 'FY2025', '2025-01-01', '2025-12-31'),
              ($2, 'FY2026', '2026-01-01', '2026-12-31')`,
      [years.fy2025, years.fy2026],
    );
    for (const [key, [year, start, end]] of Object.entries(periodDefinitions)) {
      await client.query(
        `insert into ledger_periods (id, year_id, start_date, end_date)
         values ($1, $2, $3, $4)`,
        [periods[key as PeriodKey], years[year], start, end],
      );
    }
    for (const [key, definition] of Object.entries(accountDefinitions)) {
      const [code, name, type, currency, isControl] = definition;
      await client.query(
        `insert into ledger_accounts (id, code, name, type, currency, is_control)
         values ($1, $2, $3, $4, $5, $6)`,
        [accounts[key as AccountKey], code, name, type, currency, isControl],
      );
    }
    for (const [currency, date, rate] of rates) {
      await client.query(
        'insert into fx_rates (currency, rate_date, rate) values ($1, $2, $3)',
        [currency, date, rate],
      );
    }
    const positions = [
      ['BHD', accounts.fxBhd, accounts.fxBhdAed],
      ['SAR', accounts.fxSar, accounts.fxSarAed],
    ];
    for (const [currency, foreign, base] of positions) {
      await client.query(
        `insert into fx_positions
           (currency, base_currency, foreign_account_id, base_account_id, gain_loss_account_id)
         values ($1, 'AED', $2, $3, $4)`,
        [currency, foreign, base, accounts.fxGainLoss],
      );
    }
  });

  return {
    schoolId,
    userId,
    years,
    periods,
    accounts,
    currencyOf: (account) => accountDefinitions[account][3],
  };
}

export interface RawLine {
  account: AccountKey;
  amount: string;
  student?: string;
  currency?: string;
}

// Inserts an entry and its lines with plain SQL, without the ledger service.
export async function insertEntry(
  client: pg.PoolClient,
  books: Books,
  entry: { period: PeriodKey; date: string; lines: RawLine[]; kind?: string },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into ledger_entries (id, period_id, entry_date, kind)
     values ($1, $2, $3, $4)`,
    [id, books.periods[entry.period], entry.date, entry.kind ?? 'adjustment'],
  );
  let lineNo = 1;
  for (const line of entry.lines) {
    await client.query(
      `insert into ledger_lines
         (entry_id, line_no, account_id, currency, amount, student_id)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        lineNo++,
        books.accounts[line.account],
        line.currency ?? books.currencyOf(line.account),
        line.amount,
        line.student ?? null,
      ],
    );
  }
  return id;
}

export const balancedPair = (amount = '10.00'): RawLine[] => [
  { account: 'bankAed', amount },
  { account: 'tuition', amount: `-${amount}` },
];

export async function createInvoice(
  pool: pg.Pool,
  books: Books,
  studentId: string,
  amount: string,
  currency = 'AED',
): Promise<string> {
  const id = randomUUID();
  await committed(
    pool,
    { userId: books.userId, tenantId: books.schoolId },
    (client) =>
      client.query(
        `insert into invoices (id, student_id, amount, currency)
         values ($1, $2, $3, $4)`,
        [id, studentId, amount, currency],
      ),
  );
  return id;
}
