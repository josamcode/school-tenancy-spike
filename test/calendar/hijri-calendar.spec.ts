import { Logger } from '@nestjs/common';
import pg from 'pg';
import { calendarSchools, userCalendar } from '../../db/seed.js';
import { HijriCalendar } from '../../src/calendar/hijri-calendar.js';
import { TenantDb } from '../../src/db/tenant-db.js';
import { runtimePool } from '../support/db.js';

// Reads the seeded overrides. Nothing here writes.
describe('the Hijri calendar of a school', () => {
  let pool: pg.Pool;
  let tenantDb: TenantDb;
  let calendar: HijriCalendar;

  beforeAll(() => {
    pool = runtimePool();
    tenantDb = new TenantDb(pool);
    calendar = new HijriCalendar(tenantDb);
  });

  afterAll(async () => {
    await pool.end();
  });

  const inSchool = (school: { id: string }, date: string) =>
    tenantDb.run(userCalendar.id, school.id, () => calendar.toHijri(date));

  it('uses the override of the school’s country', async () => {
    expect(await inSchool(calendarSchools.muscat, '2025-03-30')).toEqual({
      year: 1446,
      month: 9,
      day: 30,
    });
    expect(await inSchool(calendarSchools.manama, '2026-03-19')).toEqual({
      year: 1447,
      month: 10,
      day: 1,
    });
  });

  it('does not use another country’s override', async () => {
    for (const school of [calendarSchools.dubai, calendarSchools.riyadh]) {
      expect(await inSchool(school, '2025-03-30')).toEqual({
        year: 1446,
        month: 10,
        day: 1,
      });
      expect(await inSchool(school, '2026-03-19')).toEqual({
        year: 1447,
        month: 9,
        day: 30,
      });
    }
  });

  it('is the calculated calendar for a school with no country', async () => {
    expect(await inSchool(calendarSchools.noCountry, '2025-03-30')).toEqual({
      year: 1446,
      month: 10,
      day: 1,
    });
  });

  it('refuses an override that gives the month before it 31 days, and says which one is likely missing', async () => {
    const failure = inSchool(calendarSchools.kuwait, '2026-03-20');
    await expect(failure).rejects.toThrow(/KW/);
    await expect(failure).rejects.toThrow(/1447-10/);
    await expect(failure).rejects.toThrow(/1447-09 would have 31 days/);
    await expect(failure).rejects.toThrow(
      /override for 1447-09 is probably missing/,
    );
  });

  describe('for display', () => {
    const shown = (school: { id: string }, date: string) =>
      tenantDb.run(userCalendar.id, school.id, () => calendar.forDisplay(date));

    it('is the same date as the conversion when it succeeds', async () => {
      expect(await shown(calendarSchools.muscat, '2025-03-30')).toEqual({
        year: 1446,
        month: 9,
        day: 30,
      });
      expect(await shown(calendarSchools.noCountry, '2025-03-30')).toEqual({
        year: 1446,
        month: 10,
        day: 1,
      });
    });

    it('is null instead of an error when the override cannot be right, and the reason is logged', async () => {
      const errors = vi.spyOn(Logger.prototype, 'error');
      try {
        expect(await shown(calendarSchools.kuwait, '2026-03-20')).toBeNull();
        expect(errors).toHaveBeenCalledTimes(1);
        const entry = String(errors.mock.calls[0][0]);
        for (const part of [
          '2026-03-20',
          'KW',
          '1447-10',
          '2026-03-21',
          'probably missing',
        ]) {
          expect(entry).toContain(part);
        }
      } finally {
        errors.mockRestore();
      }
    });

    it('is null for a date outside the years the calendar covers, in a school with no country too', async () => {
      const errors = vi.spyOn(Logger.prototype, 'error');
      try {
        expect(await shown(calendarSchools.dubai, '1850-01-01')).toBeNull();
        expect(await shown(calendarSchools.noCountry, '1850-01-01')).toBeNull();
        const entries = errors.mock.calls.map((call) => String(call[0]));
        expect(entries).toHaveLength(2);
        expect(entries[0]).toContain('1850-01-01');
        expect(entries[0]).toContain('AE');
        expect(entries[0]).toContain('outside');
      } finally {
        errors.mockRestore();
      }
    });

    it('leaves the transaction usable after a date it could not convert', async () => {
      const result = await tenantDb.run(
        userCalendar.id,
        calendarSchools.kuwait.id,
        async () => [
          await calendar.forDisplay('2026-03-20'),
          await calendar.forDisplay('2026-02-10'),
        ],
      );
      expect(result).toEqual([null, { year: 1447, month: 8, day: 22 }]);
    });
  });

  it('still converts a Kuwait date that the wrong override cannot reach', async () => {
    expect(await inSchool(calendarSchools.kuwait, '2024-03-11')).toEqual({
      year: 1445,
      month: 9,
      day: 1,
    });
  });
});
