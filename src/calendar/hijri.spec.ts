import { calculatedHijri, MonthOverride, resolveHijri } from './hijri.js';

const override = (
  hijriYear: number,
  hijriMonth: number,
  startsOn: string,
): MonthOverride => ({ hijriYear, hijriMonth, startsOn });

describe('the calculated Umm al-Qura calendar', () => {
  // Month starts as published for Saudi Arabia, not as read back from the
  // runtime.
  it.each([
    ['2025-03-01', { year: 1446, month: 9, day: 1 }],
    ['2025-03-30', { year: 1446, month: 10, day: 1 }],
    ['2025-05-28', { year: 1446, month: 12, day: 1 }],
    ['2025-06-26', { year: 1447, month: 1, day: 1 }],
    ['2026-02-18', { year: 1447, month: 9, day: 1 }],
    ['2026-03-20', { year: 1447, month: 10, day: 1 }],
  ])('starts a month on %s', (date, expected) => {
    expect(calculatedHijri(date)).toEqual(expected);
  });

  it('counts the days of a month up to its last day', () => {
    expect(calculatedHijri('2025-03-29')).toEqual({
      year: 1446,
      month: 9,
      day: 29,
    });
    expect(calculatedHijri('2026-03-19')).toEqual({
      year: 1447,
      month: 9,
      day: 30,
    });
  });

  it('refuses a date outside the years the table covers', () => {
    expect(() => calculatedHijri('1850-01-01')).toThrow(/outside/);
    expect(() => calculatedHijri('2200-01-01')).toThrow(/outside/);
  });

  it('refuses something that is not a date', () => {
    expect(() => calculatedHijri('2026-02-30')).toThrow(/not a date/);
    expect(() => calculatedHijri('20 March 2026')).toThrow(/not a date/);
  });
});

describe('a Hijri date with official month starts', () => {
  it('is the calculated date when the country has no override', () => {
    expect(resolveHijri('2025-03-30', 'AE', [])).toEqual({
      year: 1446,
      month: 10,
      day: 1,
    });
    expect(resolveHijri('2025-03-30', null, [])).toEqual({
      year: 1446,
      month: 10,
      day: 1,
    });
  });

  describe('when a month is announced a day later than calculated', () => {
    // Calculated: Ramadan 1446 has 29 days and Shawwal starts on 30 March.
    const overrides = [override(1446, 10, '2025-03-31')];

    it('gives the day before the announced start to the previous month', () => {
      expect(resolveHijri('2025-03-30', 'OM', overrides)).toEqual({
        year: 1446,
        month: 9,
        day: 30,
      });
    });

    it('starts the month on the announced day', () => {
      expect(resolveHijri('2025-03-31', 'OM', overrides)).toEqual({
        year: 1446,
        month: 10,
        day: 1,
      });
    });

    it('counts the rest of the month from the announced start', () => {
      expect(resolveHijri('2025-04-28', 'OM', overrides)).toEqual({
        year: 1446,
        month: 10,
        day: 29,
      });
    });

    it('goes back to the calculated calendar in the month after', () => {
      expect(resolveHijri('2025-04-29', 'OM', overrides)).toEqual({
        year: 1446,
        month: 11,
        day: 1,
      });
    });

    it('leaves the months before it alone', () => {
      expect(resolveHijri('2025-03-01', 'OM', overrides)).toEqual({
        year: 1446,
        month: 9,
        day: 1,
      });
    });
  });

  describe('when a month is announced a day earlier than calculated', () => {
    // Calculated: Ramadan 1447 has 30 days and Shawwal starts on 20 March.
    const overrides = [override(1447, 10, '2026-03-19')];

    it('starts the month on the announced day', () => {
      expect(resolveHijri('2026-03-19', 'BH', overrides)).toEqual({
        year: 1447,
        month: 10,
        day: 1,
      });
      expect(resolveHijri('2026-03-20', 'BH', overrides)).toEqual({
        year: 1447,
        month: 10,
        day: 2,
      });
    });

    it('ends the previous month a day early', () => {
      expect(resolveHijri('2026-03-18', 'BH', overrides)).toEqual({
        year: 1447,
        month: 9,
        day: 29,
      });
    });

    it('counts 30 days when the calculated next month fits', () => {
      expect(resolveHijri('2026-04-17', 'BH', overrides)).toEqual({
        year: 1447,
        month: 10,
        day: 30,
      });
      expect(resolveHijri('2026-04-18', 'BH', overrides)).toEqual({
        year: 1447,
        month: 11,
        day: 1,
      });
    });
  });

  describe('the month after an override, when it is not announced yet', () => {
    it('starts a day early instead of giving the overridden month 31 days', () => {
      // Calculated: 1447-04 and 1447-05 have 30 days each, 1447-06 has 29.
      const overrides = [override(1447, 5, '2025-10-22')];
      expect(resolveHijri('2025-11-20', 'AE', overrides)).toEqual({
        year: 1447,
        month: 5,
        day: 30,
      });
      expect(resolveHijri('2025-11-21', 'AE', overrides)).toEqual({
        year: 1447,
        month: 6,
        day: 1,
      });
      expect(resolveHijri('2025-12-20', 'AE', overrides)).toEqual({
        year: 1447,
        month: 6,
        day: 30,
      });
      expect(resolveHijri('2025-12-21', 'AE', overrides)).toEqual({
        year: 1447,
        month: 7,
        day: 1,
      });
    });

    it('starts a day late instead of giving the overridden month 28 days', () => {
      // Calculated: 1446-08 and 1446-09 have 29 days each, 1446-10 has 30.
      const overrides = [override(1446, 9, '2025-03-02')];
      expect(resolveHijri('2025-03-01', 'AE', overrides)).toEqual({
        year: 1446,
        month: 8,
        day: 30,
      });
      expect(resolveHijri('2025-03-30', 'AE', overrides)).toEqual({
        year: 1446,
        month: 9,
        day: 29,
      });
      expect(resolveHijri('2025-03-31', 'AE', overrides)).toEqual({
        year: 1446,
        month: 10,
        day: 1,
      });
      expect(resolveHijri('2025-04-29', 'AE', overrides)).toEqual({
        year: 1446,
        month: 11,
        day: 1,
      });
    });
  });

  describe('an override that the month before it cannot fit', () => {
    it('is refused when it leaves the previous month 31 days', () => {
      // Calculated: Ramadan 1447 already has 30 days.
      const overrides = [override(1447, 10, '2026-03-21')];
      const convert = () => resolveHijri('2026-03-20', 'KW', overrides);
      expect(convert).toThrow(/KW/);
      expect(convert).toThrow(/1447-10/);
      expect(convert).toThrow(/2026-03-21/);
      expect(convert).toThrow(/1447-09 would have 31 days/);
      expect(convert).toThrow(/override for 1447-09 is probably missing/);
    });

    it('is refused when it leaves the previous month 28 days', () => {
      // Calculated: Ramadan 1446 has 29 days.
      const overrides = [override(1446, 10, '2025-03-29')];
      const convert = () => resolveHijri('2025-03-29', 'KW', overrides);
      expect(convert).toThrow(/1446-09 would have 28 days/);
      expect(convert).toThrow(/override for 1446-09 is probably missing/);
    });

    it('is refused for every date whose month it would touch', () => {
      const overrides = [override(1447, 10, '2026-03-21')];
      for (const date of ['2026-03-10', '2026-03-21', '2026-04-10']) {
        expect(() => resolveHijri(date, 'KW', overrides)).toThrow(
          /probably missing/,
        );
      }
    });

    it('resolves once the missing override is entered', () => {
      // Ramadan a day late as well: it has 30 days again.
      const overrides = [
        override(1447, 9, '2026-02-19'),
        override(1447, 10, '2026-03-21'),
      ];
      expect(resolveHijri('2026-03-20', 'KW', overrides)).toEqual({
        year: 1447,
        month: 9,
        day: 30,
      });
      expect(resolveHijri('2026-03-21', 'KW', overrides)).toEqual({
        year: 1447,
        month: 10,
        day: 1,
      });
    });
  });

  it('refuses an override more than two days from the calculated start', () => {
    const overrides = [override(1447, 10, '2026-03-25')];
    const convert = () => resolveHijri('2026-03-26', 'KW', overrides);
    expect(convert).toThrow(/KW/);
    expect(convert).toThrow(/1447-10/);
    expect(convert).toThrow(/more than 2 days/);
  });

  it('ignores an override of a month too far back to reach the date', () => {
    const overrides = [override(1440, 1, '2018-09-12')];
    expect(resolveHijri('2026-03-20', 'AE', overrides)).toEqual({
      year: 1447,
      month: 10,
      day: 1,
    });
  });
});
