import { Injectable } from '@nestjs/common';
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db.js';
import { EventHandler, HandlesEvent } from '../events/event-handler.js';
import { OutboxEvent } from '../events/event-types.js';
import { ledgerPeriods, registrationFees } from './ledger.schema.js';
import { LedgerService } from './ledger.service.js';
import { fromMinor, isCurrency, negate, toMinor } from './money.js';

// Charges the school's registration fee to a student who was accepted. The
// runner calls it at most once per event, and only where finance is on.
@Injectable()
@HandlesEvent('student.accepted', 'finance')
export class RegistrationFeeHandler implements EventHandler {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly ledger: LedgerService,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const { studentId, acceptedAt } = event.payload as {
      studentId?: unknown;
      acceptedAt?: unknown;
    };
    if (typeof studentId !== 'string' || typeof acceptedAt !== 'string') {
      throw new Error(`Event ${event.id} has no student or acceptance time`);
    }
    const db = this.tenantDb.db;

    const [fee] = await db.select().from(registrationFees);
    if (!fee) throw new Error('No registration fee is configured');
    if (!isCurrency(fee.currency)) {
      throw new Error(`Unknown currency ${fee.currency}`);
    }

    // The business date of the acceptance: its instant, seen in the school's
    // timezone. Not the day this handler happens to run.
    const { rows } = await db.execute<{ date: string }>(sql`
      select ((${acceptedAt}::timestamptz) at time zone tenants.timezone)::date::text as date
        from tenants`);
    const date = rows[0].date;

    const [period] = await db
      .select({ id: ledgerPeriods.id })
      .from(ledgerPeriods)
      .where(
        and(
          eq(ledgerPeriods.status, 'open'),
          lte(ledgerPeriods.startDate, date),
          gte(ledgerPeriods.endDate, date),
        ),
      );
    if (!period) throw new Error(`No open period for ${date}`);

    const amount = fromMinor(toMinor(fee.amount, fee.currency), fee.currency);
    await this.ledger.post({
      periodId: period.id,
      date,
      kind: 'registration_fee',
      description: 'Registration fee',
      lines: [
        { accountId: fee.receivableAccountId, amount, studentId },
        {
          accountId: fee.incomeAccountId,
          amount: negate(amount, fee.currency),
        },
      ],
    });
  }
}
