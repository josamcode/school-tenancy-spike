// Hijri dates for display. Only Gregorian dates are stored. A date is
// converted with the calculated Umm al-Qura calendar, unless the school's
// country has announced where a month starts.

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

// The Gregorian date on which a Hijri month starts in a country.
export interface MonthOverride {
  hijriYear: number;
  hijriMonth: number;
  startsOn: string;
}

const DAY_MS = 86_400_000;
// An override moves at most the months after it until one absorbs the
// difference, which takes a few months at most.
const LOOKBACK_MONTHS = 12;
const MAX_SHIFT_DAYS = 2;
// The years the Umm al-Qura table covers. Outside them the runtime falls back
// to an arithmetic calendar without saying so.
const FIRST_YEAR = 1300;
const LAST_YEAR = 1600;

const formatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});
// A runtime built without full ICU data resolves to another calendar.
if (formatter.resolvedOptions().calendar !== 'islamic-umalqura') {
  throw new Error('This runtime has no Umm al-Qura calendar');
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Days since 1970-01-01.
function dayNumber(date: string): number {
  const match = ISO_DATE.exec(date);
  const time = match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : NaN;
  if (!match || isoDate(time / DAY_MS) !== date) {
    throw new Error(`"${date}" is not a date`);
  }
  return time / DAY_MS;
}

function isoDate(day: number): string {
  const date = new Date(day * DAY_MS);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function calculate(day: number): HijriDate {
  const parts = formatter.formatToParts(new Date(day * DAY_MS));
  const part = (type: string) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const hijri = { year: part('year'), month: part('month'), day: part('day') };
  if (!(hijri.year >= FIRST_YEAR && hijri.year <= LAST_YEAR)) {
    throw new RangeError(
      `${isoDate(day)} is outside the years the Umm al-Qura table covers`,
    );
  }
  return hijri;
}

const monthIndex = (year: number, month: number) => year * 12 + month - 1;
const monthLabel = (index: number) =>
  `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;

export function calculatedHijri(date: string): HijriDate {
  return calculate(dayNumber(date));
}

export function resolveHijri(
  date: string,
  country: string | null,
  overrides: MonthOverride[],
): HijriDate {
  const day = dayNumber(date);
  const calculated = calculate(day);
  if (country === null) return calculated;

  const target = monthIndex(calculated.year, calculated.month);
  const first = target - LOOKBACK_MONTHS;
  const last = target + 1;
  const announced = new Map<number, number>();
  for (const override of overrides) {
    const index = monthIndex(override.hijriYear, override.hijriMonth);
    if (index >= first && index <= last) {
      announced.set(index, dayNumber(override.startsOn));
    }
  }
  if (announced.size === 0) return calculated;

  // Where each month of the window starts by calculation.
  const starts = new Map<number, number>([[target, day - calculated.day + 1]]);
  for (let index = target; index > first; index--) {
    const start = starts.get(index)!;
    starts.set(index - 1, start - calculate(start - 1).day);
  }
  const targetStart = starts.get(target)!;
  const hasThirtyDays = calculate(targetStart + 29).month === calculated.month;
  starts.set(last, targetStart + (hasThirtyDays ? 30 : 29));

  // Where each month starts in this country. An announced start is taken as
  // it is, and must leave the month before it 29 or 30 days. A month that is
  // not announced starts where it was calculated, moved only as far as the
  // month before it needs to have 29 or 30 days.
  const official = new Map<number, number>();
  let previous: number | undefined;
  for (let index = first; index <= last; index++) {
    const calculatedStart = starts.get(index)!;
    let start = announced.get(index);
    if (start === undefined) {
      start =
        previous === undefined
          ? calculatedStart
          : Math.min(Math.max(calculatedStart, previous + 29), previous + 30);
    } else {
      const name = `The Hijri override for ${country} ${monthLabel(index)}`;
      if (Math.abs(start - calculatedStart) > MAX_SHIFT_DAYS) {
        throw new Error(
          `${name} starts on ${isoDate(start)}, more than ${MAX_SHIFT_DAYS} days from the calculated ${isoDate(calculatedStart)}.`,
        );
      }
      const length = previous === undefined ? 29 : start - previous;
      if (length < 29 || length > 30) {
        const before = monthLabel(index - 1);
        throw new Error(
          `${name} starts on ${isoDate(start)}, so ${before} would have ${length} days. An override for ${before} is probably missing.`,
        );
      }
    }
    official.set(index, start);
    previous = start;
  }

  for (let index = last; index >= first; index--) {
    const start = official.get(index)!;
    if (start <= day) {
      return {
        year: Math.floor(index / 12),
        month: (index % 12) + 1,
        day: day - start + 1,
      };
    }
  }
  throw new Error(`No Hijri month starts on or before ${date}`);
}
