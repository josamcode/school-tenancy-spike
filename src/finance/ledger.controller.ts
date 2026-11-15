import { Controller, Get } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { students } from '../core/core.schema.js';
import { TenantDb } from '../db/tenant-db.js';
import { RequiresPermission } from '../entitlements/decorators.js';
import { financeSettings, fxPositions } from './ledger.schema.js';
import { LedgerService } from './ledger.service.js';
import { isCurrency, negate } from './money.js';

interface PeriodRow extends Record<string, unknown> {
  year: string;
  start_date: string;
  end_date: string;
  status: string;
}

// Reads only. No route posts to the ledger: entries come from the ledger
// service, which the event handlers call.
@Controller('schools/:schoolId/ledger')
@RequiresPermission('finance:read')
export class LedgerController {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly ledger: LedgerService,
  ) {}

  // The school's books at a glance, read in one transaction.
  @Get()
  async overview() {
    const db = this.tenantDb.db;
    const [settings] = await db
      .select({ baseCurrency: financeSettings.baseCurrency })
      .from(financeSettings);

    const balances = await this.ledger.studentBalances();
    const ids = [...new Set(balances.map((row) => row.studentId))];
    const named =
      ids.length === 0
        ? []
        : await db
            .select({ id: students.id, fullName: students.fullName })
            .from(students)
            .where(inArray(students.id, ids));
    const nameOf = new Map(
      named.map((student) => [student.id, student.fullName]),
    );

    const positions = await db
      .select()
      .from(fxPositions)
      .orderBy(fxPositions.currency);
    const fxPositionsNow = [];
    for (const position of positions) {
      const foreign = await this.ledger.accountBalance(
        position.foreignAccountId,
      );
      fxPositionsNow.push({
        currency: position.currency,
        // The position account mirrors the money held, so its sign is turned.
        held: isCurrency(position.currency)
          ? negate(foreign, position.currency)
          : foreign,
        baseCurrency: position.baseCurrency,
        bookValue: await this.ledger.accountBalance(position.baseAccountId),
      });
    }
    // Gain or loss accounts are income accounts: a credit balance is a gain.
    const fxGainLoss = [];
    for (const accountId of new Set(
      positions.map((position) => position.gainLossAccountId),
    )) {
      const { baseCurrency } = positions.find(
        (position) => position.gainLossAccountId === accountId,
      )!;
      const balance = await this.ledger.accountBalance(accountId);
      fxGainLoss.push({
        currency: baseCurrency,
        gain: isCurrency(baseCurrency)
          ? negate(balance, baseCurrency)
          : balance,
      });
    }

    const periods = await db.execute<PeriodRow>(sql`
      select y.name as year,
             p.start_date::text as start_date,
             p.end_date::text as end_date,
             p.status
        from ledger_periods p
        join financial_years y on y.tenant_id = p.tenant_id and y.id = p.year_id
       order by p.start_date`);

    return {
      baseCurrency: settings?.baseCurrency ?? null,
      currencyTotals: await this.ledger.currencyTotals(),
      studentBalances: balances.map((row) => ({
        studentId: row.studentId,
        fullName: nameOf.get(row.studentId) ?? null,
        currency: row.currency,
        balance: row.balance,
      })),
      fxPositions: fxPositionsNow,
      fxGainLoss,
      periods: periods.rows.map((row) => ({
        year: row.year,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
      })),
    };
  }
}
