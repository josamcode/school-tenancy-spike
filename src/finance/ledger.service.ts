import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db.js';
import { invoices } from './finance.schema.js';
import {
  fxPositions,
  fxRates,
  ledgerAccounts,
  ledgerEntries,
  ledgerLines,
  ledgerPeriods,
} from './ledger.schema.js';
import {
  Currency,
  fromBase,
  fromMinor,
  isCurrency,
  negate,
  subtract,
  toBase,
  toMinor,
} from './money.js';

export type EntryKind =
  | 'invoice'
  | 'discount'
  | 'late_fee'
  | 'payment'
  | 'refund'
  | 'fx_conversion'
  | 'fx_revaluation'
  | 'reversal'
  | 'adjustment';

// A positive amount is a debit and a negative amount is a credit.
export interface LineInput {
  accountId: string;
  amount: string;
  studentId?: string | null;
}

export interface Posting {
  periodId: string;
  date: string;
}

export interface EntryInput extends Posting {
  kind: EntryKind;
  description?: string;
  invoiceId?: string | null;
  reversesEntryId?: string;
  fx?: { currency: string; rate: string };
  lines: LineInput[];
}

export interface ConversionInput extends Posting {
  kind: EntryKind;
  currency: string;
  // Where the foreign money sits, such as a bank account in that currency.
  foreignAccountId: string;
  // What it is exchanged against in the base currency.
  baseAccountId: string;
  studentId?: string;
  // Exactly one of the two. The other is computed from the rate.
  foreignAmount?: string;
  baseAmount?: string;
}

function currencyOrThrow(value: string): Currency {
  if (!isCurrency(value)) throw new Error(`Unknown currency ${value}`);
  return value;
}

// Every method must be called inside a tenant transaction. The database, not
// this class, guarantees that entries balance, that posted lines cannot change
// and that nothing posts into a locked period.
@Injectable()
export class LedgerService {
  constructor(private readonly tenantDb: TenantDb) {}

  async post(input: EntryInput): Promise<string> {
    if (input.lines.length === 0) throw new Error('An entry needs lines');
    const db = this.tenantDb.db;

    const accountIds = [...new Set(input.lines.map((line) => line.accountId))];
    const accounts = await db
      .select({ id: ledgerAccounts.id, currency: ledgerAccounts.currency })
      .from(ledgerAccounts)
      .where(inArray(ledgerAccounts.id, accountIds));
    const currencyOf = new Map(accounts.map((a) => [a.id, a.currency]));

    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        periodId: input.periodId,
        entryDate: input.date,
        kind: input.kind,
        description: input.description,
        invoiceId: input.invoiceId,
        reversesEntryId: input.reversesEntryId,
        fxCurrency: input.fx?.currency,
        fxRate: input.fx?.rate,
      })
      .returning({ id: ledgerEntries.id });

    await db.insert(ledgerLines).values(
      input.lines.map((line, index) => {
        const currency = currencyOf.get(line.accountId);
        if (!currency) throw new Error(`Unknown account ${line.accountId}`);
        return {
          entryId: entry.id,
          lineNo: index + 1,
          accountId: line.accountId,
          currency,
          amount: line.amount,
          studentId: line.studentId ?? null,
        };
      }),
    );
    return entry.id;
  }

  async postInvoice(
    invoiceId: string,
    target: Posting & { receivableAccountId: string; incomeAccountId: string },
  ): Promise<string> {
    // The share lock makes a concurrent change to the invoice wait until this
    // posting commits. The invoice trigger then sees the entry and refuses it.
    const [invoice] = await this.tenantDb.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .for('share');
    if (!invoice) throw new Error(`Unknown invoice ${invoiceId}`);

    const currency = currencyOrThrow(invoice.currency);
    const amount = fromMinor(toMinor(invoice.amount, currency), currency);
    return this.post({
      periodId: target.periodId,
      date: target.date,
      kind: 'invoice',
      invoiceId,
      lines: [
        {
          accountId: target.receivableAccountId,
          amount,
          studentId: invoice.studentId,
        },
        { accountId: target.incomeAccountId, amount: negate(amount, currency) },
      ],
    });
  }

  // A correction is a new entry that negates the original line for line. The
  // original is never touched, and it can be reversed only once.
  async reverse(entryId: string, target: Posting): Promise<string> {
    const db = this.tenantDb.db;
    const [original] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, entryId));
    if (!original) throw new Error(`Unknown entry ${entryId}`);
    const lines = await db
      .select()
      .from(ledgerLines)
      .where(eq(ledgerLines.entryId, entryId))
      .orderBy(ledgerLines.lineNo);

    return this.post({
      periodId: target.periodId,
      date: target.date,
      kind: 'reversal',
      reversesEntryId: entryId,
      invoiceId: original.invoiceId,
      fx:
        original.fxCurrency && original.fxRate
          ? { currency: original.fxCurrency, rate: original.fxRate }
          : undefined,
      lines: lines.map((line) => ({
        accountId: line.accountId,
        amount: line.amount.startsWith('-')
          ? line.amount.slice(1)
          : `-${line.amount}`,
        studentId: line.studentId,
      })),
    });
  }

  // Exchanges an amount between a foreign currency and the base currency.
  // Each pair of lines goes through that currency's own position accounts, so
  // each currency balances by itself.
  async convert(input: ConversionInput): Promise<string> {
    const position = await this.positionOf(input.currency);
    await this.lockPosition(input.currency, 'shared');
    const rate = await this.rateOn(input.currency, input.date);
    const foreign = currencyOrThrow(input.currency);
    const base = currencyOrThrow(position.baseCurrency);

    let foreignAmount: string;
    let baseAmount: string;
    if (input.foreignAmount !== undefined && input.baseAmount === undefined) {
      foreignAmount = input.foreignAmount;
      baseAmount = negate(toBase(foreignAmount, foreign, base, rate), base);
    } else if (
      input.baseAmount !== undefined &&
      input.foreignAmount === undefined
    ) {
      baseAmount = input.baseAmount;
      foreignAmount = negate(
        fromBase(baseAmount, base, foreign, rate),
        foreign,
      );
    } else {
      throw new Error('Give either the foreign amount or the base amount');
    }

    return this.post({
      periodId: input.periodId,
      date: input.date,
      kind: input.kind,
      fx: { currency: foreign, rate },
      lines: [
        { accountId: input.foreignAccountId, amount: foreignAmount },
        {
          accountId: position.foreignAccountId,
          amount: negate(foreignAmount, foreign),
        },
        {
          accountId: input.baseAccountId,
          amount: baseAmount,
          studentId: input.studentId,
        },
        { accountId: position.baseAccountId, amount: negate(baseAmount, base) },
      ],
    });
  }

  // Sets the base side of a position to what its foreign side is worth at the
  // rate of the date: target = -(foreign-side balance as of the date) x rate,
  // rounded half away from zero to the base currency's minor units. The difference goes to
  // FX gain or loss. Closing a position is the same operation with a foreign
  // balance of zero. Returns null, and posts nothing, when there is no
  // difference.
  async revalue(input: Posting & { currency: string }): Promise<string | null> {
    const position = await this.positionOf(input.currency);
    // Taken before the balances are read, and held until this transaction
    // ends, so two revaluations cannot both book the same difference.
    await this.lockPosition(input.currency, 'exclusive');
    const rate = await this.rateOn(input.currency, input.date);
    const foreign = currencyOrThrow(input.currency);
    const base = currencyOrThrow(position.baseCurrency);

    // Both sides as of the revaluation date. Entries dated later belong to a
    // later revaluation, even when they were posted first.
    const foreignBalance = await this.accountBalance(
      position.foreignAccountId,
      input.date,
    );
    const target = toBase(negate(foreignBalance, foreign), foreign, base, rate);
    const current = await this.accountBalance(
      position.baseAccountId,
      input.date,
    );
    const difference = subtract(target, current, base);
    if (toMinor(difference, base) === 0n) return null;

    return this.post({
      periodId: input.periodId,
      date: input.date,
      kind: 'fx_revaluation',
      fx: { currency: foreign, rate },
      lines: [
        { accountId: position.baseAccountId, amount: difference },
        {
          accountId: position.gainLossAccountId,
          amount: negate(difference, base),
        },
      ],
    });
  }

  async lockPeriod(periodId: string): Promise<void> {
    const locked = await this.tenantDb.db
      .update(ledgerPeriods)
      .set({ status: 'locked' })
      .where(eq(ledgerPeriods.id, periodId))
      .returning({ id: ledgerPeriods.id });
    if (locked.length === 0) throw new Error(`Unknown period ${periodId}`);
  }

  // With asOf, only lines whose entry is dated on or before that date count.
  async accountBalance(accountId: string, asOf?: string): Promise<string> {
    const db = this.tenantDb.db;
    const [account] = await db
      .select({ currency: ledgerAccounts.currency })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId));
    if (!account) throw new Error(`Unknown account ${accountId}`);

    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerLines.amount}), 0)` })
      .from(ledgerLines)
      .innerJoin(
        ledgerEntries,
        and(
          eq(ledgerEntries.tenantId, ledgerLines.tenantId),
          eq(ledgerEntries.id, ledgerLines.entryId),
        ),
      )
      .where(
        and(
          eq(ledgerLines.accountId, accountId),
          asOf === undefined ? undefined : lte(ledgerEntries.entryDate, asOf),
        ),
      );
    const currency = currencyOrThrow(account.currency);
    return fromMinor(toMinor(row.total, currency), currency);
  }

  // The student sub-ledger: derived from the lines on control accounts, per
  // student and currency, and never stored.
  async studentBalances(): Promise<
    { studentId: string; currency: string; balance: string }[]
  > {
    const rows = await this.tenantDb.db
      .select({
        studentId: ledgerLines.studentId,
        currency: ledgerLines.currency,
        total: sql<string>`sum(${ledgerLines.amount})`,
      })
      .from(ledgerLines)
      .innerJoin(
        ledgerAccounts,
        and(
          eq(ledgerAccounts.tenantId, ledgerLines.tenantId),
          eq(ledgerAccounts.id, ledgerLines.accountId),
        ),
      )
      .where(eq(ledgerAccounts.isControl, true))
      .groupBy(ledgerLines.studentId, ledgerLines.currency)
      .orderBy(ledgerLines.studentId, ledgerLines.currency);

    return rows.map((row) => {
      const currency = currencyOrThrow(row.currency);
      return {
        studentId: row.studentId!,
        currency,
        balance: fromMinor(toMinor(row.total, currency), currency),
      };
    });
  }

  // The sum of every line, per currency. It is zero for each one.
  async currencyTotals(): Promise<{ currency: string; total: string }[]> {
    const rows = await this.tenantDb.db
      .select({
        currency: ledgerLines.currency,
        total: sql<string>`sum(${ledgerLines.amount})`,
      })
      .from(ledgerLines)
      .groupBy(ledgerLines.currency)
      .orderBy(ledgerLines.currency);

    return rows.map((row) => {
      const currency = currencyOrThrow(row.currency);
      return {
        currency,
        total: fromMinor(toMinor(row.total, currency), currency),
      };
    });
  }

  // The latest rate on or before the date. The caller copies it onto the entry.
  private async rateOn(currency: string, date: string): Promise<string> {
    const [row] = await this.tenantDb.db
      .select({ rate: fxRates.rate })
      .from(fxRates)
      .where(and(eq(fxRates.currency, currency), lte(fxRates.rateDate, date)))
      .orderBy(desc(fxRates.rateDate))
      .limit(1);
    if (!row) throw new Error(`No ${currency} rate on or before ${date}`);
    return row.rate;
  }

  // One advisory lock per school and currency, released when the transaction
  // ends. A revaluation takes it exclusively and a conversion takes it shared,
  // so conversions do not block each other but neither can run while the
  // position is being revalued. It is an advisory lock because the runtime
  // role has no UPDATE on fx_positions and so cannot lock its rows.
  private async lockPosition(
    currency: string,
    mode: 'shared' | 'exclusive',
  ): Promise<void> {
    const key = sql`hashtextextended(current_setting('app.tenant_id') || ':fx:' || ${currency}, 0)`;
    await this.tenantDb.db.execute(
      mode === 'exclusive'
        ? sql`select pg_advisory_xact_lock(${key})`
        : sql`select pg_advisory_xact_lock_shared(${key})`,
    );
  }

  private async positionOf(currency: string) {
    const [position] = await this.tenantDb.db
      .select()
      .from(fxPositions)
      .where(eq(fxPositions.currency, currency));
    if (!position) throw new Error(`No FX position for ${currency}`);
    return position;
  }
}
