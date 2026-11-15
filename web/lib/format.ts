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
