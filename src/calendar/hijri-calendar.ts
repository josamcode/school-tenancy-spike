import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../db/tenant-db.js';
import { HijriDate, MonthOverride, resolveHijri } from './hijri.js';

// Hijri dates as the current school's country counts them: the official month
// starts of that country first, the calculated calendar otherwise.
@Injectable()
export class HijriCalendar {
  constructor(private readonly tenantDb: TenantDb) {}

  async toHijri(date: string): Promise<HijriDate> {
    // Row-level security leaves one row: the current school.
    const school = await this.tenantDb.db.execute<{ country: string | null }>(
      sql`select country from tenants`,
    );
    const country = school.rows[0]?.country ?? null;
    if (country === null) return resolveHijri(date, null, []);

    const overrides = await this.tenantDb.db.execute<
      MonthOverride & Record<string, unknown>
    >(sql`
      select hijri_year as "hijriYear",
             hijri_month as "hijriMonth",
             starts_on::text as "startsOn"
        from hijri_month_overrides
       where country = ${country}`);
    return resolveHijri(date, country, overrides.rows);
  }
}
