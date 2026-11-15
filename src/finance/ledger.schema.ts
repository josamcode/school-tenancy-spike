import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { students, tenants } from '../core/core.schema.js';
import { currentTenant } from '../db/current-tenant.js';
import { invoices } from './finance.schema.js';

const tenantId = () => uuid('tenant_id').notNull().default(currentTenant);
const currency = (name = 'currency') =>
  char(name, { length: 3 }).references(() => currencies.code);

// Global catalog. The minor units decide how many decimals a line may carry.
export const currencies = pgTable('currencies', {
  code: char({ length: 3 }).primaryKey(),
  minorUnits: smallint('minor_units').notNull(),
});

// One row per school, written once at provisioning and never changed.
export const financeSettings = pgTable(
  'finance_settings',
  {
    tenantId: tenantId()
      .primaryKey()
      .references(() => tenants.id),
    baseCurrency: currency('base_currency').notNull(),
  },
  (t) => [unique().on(t.tenantId, t.baseCurrency)],
);

export const financialYears = pgTable(
  'financial_years',
  {
    tenantId: tenantId(),
    id: uuid().notNull().defaultRandom(),
    name: text().notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    check('financial_years_dates', sql`${t.endDate} >= ${t.startDate}`),
  ],
);

// A year is open while any of its periods is open, so several years can be
// open at once.
export const ledgerPeriods = pgTable(
  'ledger_periods',
  {
    tenantId: tenantId(),
    id: uuid().notNull().defaultRandom(),
    yearId: uuid('year_id').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text().notNull().default('open'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.yearId],
      foreignColumns: [financialYears.tenantId, financialYears.id],
    }),
    check('ledger_periods_dates', sql`${t.endDate} >= ${t.startDate}`),
    check('ledger_periods_status', sql`${t.status} in ('open', 'locked')`),
  ],
);

// An account has exactly one currency. A control account is one whose balance
// is explained by a sub-ledger: every line on it names a student.
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    tenantId: tenantId(),
    id: uuid().notNull().defaultRandom(),
    code: text().notNull(),
    name: text().notNull(),
    type: text().notNull(),
    currency: currency().notNull(),
    isControl: boolean('is_control').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    unique().on(t.tenantId, t.code),
    // Lets a line's foreign key require the account's own currency.
    unique().on(t.tenantId, t.id, t.currency),
    check(
      'ledger_accounts_type',
      sql`${t.type} in ('asset', 'liability', 'equity', 'income', 'expense')`,
    ),
  ],
);

// One unit of the currency is worth `rate` units of the school's base currency.
export const fxRates = pgTable(
  'fx_rates',
  {
    tenantId: tenantId(),
    currency: currency().notNull(),
    rateDate: date('rate_date').notNull(),
    rate: numeric({ precision: 18, scale: 8 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.currency, t.rateDate] }),
    check('fx_rates_positive', sql`${t.rate} > 0`),
  ],
);

// The position a school holds in one foreign currency: an account in that
// currency and an account in the base currency. Neither is shared with another
// currency. The gain or loss account may be.
export const fxPositions = pgTable(
  'fx_positions',
  {
    tenantId: tenantId(),
    currency: currency().notNull(),
    baseCurrency: char('base_currency', { length: 3 }).notNull(),
    foreignAccountId: uuid('foreign_account_id').notNull(),
    baseAccountId: uuid('base_account_id').notNull(),
    gainLossAccountId: uuid('gain_loss_account_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.currency] }),
    unique().on(t.tenantId, t.foreignAccountId),
    unique().on(t.tenantId, t.baseAccountId),
    check('fx_positions_foreign', sql`${t.currency} <> ${t.baseCurrency}`),
    foreignKey({
      name: 'fx_positions_base_currency_fk',
      columns: [t.tenantId, t.baseCurrency],
      foreignColumns: [financeSettings.tenantId, financeSettings.baseCurrency],
    }),
    foreignKey({
      name: 'fx_positions_foreign_account_fk',
      columns: [t.tenantId, t.foreignAccountId, t.currency],
      foreignColumns: [
        ledgerAccounts.tenantId,
        ledgerAccounts.id,
        ledgerAccounts.currency,
      ],
    }),
    foreignKey({
      name: 'fx_positions_base_account_fk',
      columns: [t.tenantId, t.baseAccountId, t.baseCurrency],
      foreignColumns: [
        ledgerAccounts.tenantId,
        ledgerAccounts.id,
        ledgerAccounts.currency,
      ],
    }),
    foreignKey({
      name: 'fx_positions_gain_loss_account_fk',
      columns: [t.tenantId, t.gainLossAccountId, t.baseCurrency],
      foreignColumns: [
        ledgerAccounts.tenantId,
        ledgerAccounts.id,
        ledgerAccounts.currency,
      ],
    }),
  ],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    tenantId: tenantId(),
    id: uuid().notNull().defaultRandom(),
    periodId: uuid('period_id').notNull(),
    entryDate: date('entry_date').notNull(),
    kind: text().notNull(),
    description: text(),
    invoiceId: uuid('invoice_id'),
    reversesEntryId: uuid('reverses_entry_id'),
    // The rate is copied here, so a later change to fx_rates cannot alter it.
    fxCurrency: currency('fx_currency'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    postedAt: timestamp('posted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    postedBy: uuid('posted_by').default(
      sql`NULLIF(current_setting('app.user_id', true), '')::uuid`,
    ),
    postedTxid: bigint('posted_txid', { mode: 'bigint' })
      .notNull()
      .default(sql`txid_current()`),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({
      columns: [t.tenantId, t.periodId],
      foreignColumns: [ledgerPeriods.tenantId, ledgerPeriods.id],
    }),
    foreignKey({
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }),
    foreignKey({
      name: 'ledger_entries_reverses_fk',
      columns: [t.tenantId, t.reversesEntryId],
      foreignColumns: [t.tenantId, t.id],
    }),
    // An entry is reversed at most once, and an invoice is posted at most once.
    unique().on(t.tenantId, t.reversesEntryId),
    uniqueIndex('ledger_entries_one_per_invoice')
      .on(t.tenantId, t.invoiceId)
      .where(sql`${t.kind} = 'invoice'`),
    check(
      'ledger_entries_kind',
      sql`${t.kind} in ('invoice', 'discount', 'late_fee', 'payment', 'refund', 'fx_conversion', 'fx_revaluation', 'reversal', 'adjustment')`,
    ),
    check(
      'ledger_entries_fx',
      sql`(${t.fxCurrency} is null) = (${t.fxRate} is null)`,
    ),
  ],
);

// One signed amount: positive is a debit, negative is a credit.
export const ledgerLines = pgTable(
  'ledger_lines',
  {
    tenantId: tenantId(),
    entryId: uuid('entry_id').notNull(),
    lineNo: integer('line_no').notNull(),
    accountId: uuid('account_id').notNull(),
    currency: currency().notNull(),
    amount: numeric({ precision: 19, scale: 4 }).notNull(),
    studentId: uuid('student_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.entryId, t.lineNo] }),
    foreignKey({
      columns: [t.tenantId, t.entryId],
      foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id],
    }),
    foreignKey({
      name: 'ledger_lines_account_currency_fk',
      columns: [t.tenantId, t.accountId, t.currency],
      foreignColumns: [
        ledgerAccounts.tenantId,
        ledgerAccounts.id,
        ledgerAccounts.currency,
      ],
    }),
    foreignKey({
      columns: [t.tenantId, t.studentId],
      foreignColumns: [students.tenantId, students.id],
    }),
    check('ledger_lines_not_zero', sql`${t.amount} <> 0`),
  ],
);
