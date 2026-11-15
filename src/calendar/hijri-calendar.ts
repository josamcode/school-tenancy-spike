import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db.js';
import {
  HijriDate,
  HijriOverrideError,
  MonthOverride,
  resolveHijri,
} from './hijri.js';

interface Rules {
  country: string | null;
  overrides: MonthOverride[];
}

// Hijri dates as the current school's country counts them: the official month
// starts of that country first, the calculated calendar otherwise.
@Injectable()
export class HijriCalendar {
  private readonly logger = new Logger(HijriCalendar.name);

  constructor(private readonly tenantDb: TenantDb) {}

  // Throws when the date cannot be converted.
  async toHijri(date: string): Promise<HijriDate> {
    const { country, overrides } = await this.rules();
    return resolveHijri(date, country, overrides);
  }

  // For something that only shows the date. The stored date is Gregorian, so
  // a Hijri date that cannot be worked out must not stop what shows it: the
  // answer is null and the reason is logged. Only the conversion is caught.
  // A failed query still fails, because the transaction is over by then.
  async forDisplay(date: string): Promise<HijriDate | null> {
    const { country, overrides } = await this.rules();
    try {
      return resolveHijri(date, country, overrides);
    } catch (error) {
      const where = country ?? 'a school with no country';
      const override =
        error instanceof HijriOverrideError
          ? `, month ${error.month}, override ${error.startsOn}`
          : '';
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `No Hijri date for ${date} in ${where}${override}: ${reason}`,
      );
      return null;
    }
  }

  private async rules(): Promise<Rules> {
    // Row-level security leaves one row: the current school.
    const school = await this.tenantDb.db.execute<{ country: string | null }>(
      sql`select country from tenants`,
    );
    const country = school.rows[0]?.country ?? null;
    if (country === null) return { country, overrides: [] };

    const overrides = await this.tenantDb.db.execute<
      MonthOverride & Record<string, unknown>
    >(sql`
      select hijri_year as "hijriYear",
             hijri_month as "hijriMonth",
             starts_on::text as "startsOn"
        from hijri_month_overrides
       where country = ${country}`);
    return { country, overrides: overrides.rows };
  }
}
