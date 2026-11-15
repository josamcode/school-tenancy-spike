import { sql } from 'drizzle-orm';
import {
  char,
  check,
  date,
  pgTable,
  primaryKey,
  smallint,
} from 'drizzle-orm/pg-core';
import { countries } from '../core/core.schema.js';

// The day a Hijri month starts in a country when its authority announced it.
// Reference data: the same for every school in that country.
export const hijriMonthOverrides = pgTable(
  'hijri_month_overrides',
  {
    country: char({ length: 2 })
      .notNull()
      .references(() => countries.code),
    hijriYear: smallint('hijri_year').notNull(),
    hijriMonth: smallint('hijri_month').notNull(),
    startsOn: date('starts_on').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.country, t.hijriYear, t.hijriMonth] }),
    // The years the Umm al-Qura table covers.
    check(
      'hijri_month_overrides_year',
      sql`${t.hijriYear} between 1300 and 1600`,
    ),
    check('hijri_month_overrides_month', sql`${t.hijriMonth} between 1 and 12`),
  ],
);
