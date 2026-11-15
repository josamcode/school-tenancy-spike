import { Lang, messages } from './i18n';

// Digits are Western (123) in both languages. Nothing here goes through a
// number or a locale, so an amount keeps every decimal the API gave it.

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatAmount(amount: string): string {
  const match = DECIMAL.exec(amount);
  if (!match) throw new Error(`"${amount}" is not an amount`);
  const [, sign, whole, fraction] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return sign + grouped + (fraction === undefined ? '' : `.${fraction}`);
}

export function formatInvoiceNumber(number: number): string {
  return `INV-${String(number).padStart(6, '0')}`;
}

export function formatGregorian(date: string, lang: Lang): string {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`"${date}" is not a date`);
  const month = messages(lang).gregorianMonths[Number(match[2]) - 1];
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export interface HijriDate {
  year: number;
  month: number;
  day: number;
}

export function formatHijri(date: HijriDate, lang: Lang): string {
  const { hijriMonths, hijriEra } = messages(lang);
  return `${date.day} ${hijriMonths[date.month - 1]} ${date.year} ${hijriEra}`;
}

const INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// An instant, which the API gives in UTC, as the clock of a timezone shows
// it: the date, the time to the second, and the zone named in the page's
// language. This is the one place that asks the runtime, which knows each
// zone's rules and names. The digits are put together from its parts, so
// they stay Western.
export function formatInstant(
  instant: string,
  timeZone: string,
  lang: Lang,
): string {
  const at = new Date(instant);
  if (!INSTANT.test(instant) || Number.isNaN(at.getTime())) {
    throw new Error(`"${instant}" is not an instant`);
  }
  const clock = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const zone =
    new Intl.DateTimeFormat(lang, { timeZone, timeZoneName: 'shortGeneric' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
  return messages(lang)
    ['time.inZone'].replace(
      '{date}',
      formatGregorian(`${clock.year}-${clock.month}-${clock.day}`, lang),
    )
    .replace('{time}', `${clock.hour}:${clock.minute}:${clock.second}`)
    .replace('{zone}', zone);
}
