import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatGregorian,
  formatHijri,
  formatInvoiceNumber,
} from '../lib/format';
import { dirOf, isLang, pickText } from '../lib/i18n';

describe('an amount', () => {
  it.each([
    ['1234.500', '1,234.500'],
    ['12500.00', '12,500.00'],
    ['450.250', '450.250'],
    ['0.050', '0.050'],
    ['1000000.00', '1,000,000.00'],
    ['12345678901234.567', '12,345,678,901,234.567'],
    ['-500.00', '-500.00'],
    ['7', '7'],
  ])('shows %s as %s, keeping every decimal it was given', (amount, shown) => {
    expect(formatAmount(amount)).toBe(shown);
  });

  it('refuses something that is not a decimal number', () => {
    expect(() => formatAmount('1e3')).toThrow();
    expect(() => formatAmount('١٢٣')).toThrow();
    expect(() => formatAmount('')).toThrow();
  });
});

describe('an invoice number', () => {
  it.each([
    [1, 'INV-000001'],
    [42, 'INV-000042'],
    [123456, 'INV-123456'],
    [1234567, 'INV-1234567'],
  ])('shows %i as %s', (number, shown) => {
    expect(formatInvoiceNumber(number)).toBe(shown);
  });
});

describe('a date', () => {
  it('is written with the month name of the language', () => {
    expect(formatGregorian('2026-03-20', 'en')).toBe('20 March 2026');
    expect(formatGregorian('2026-03-20', 'ar')).toBe('20 مارس 2026');
    expect(formatGregorian('2025-12-01', 'en')).toBe('1 December 2025');
    expect(formatGregorian('2025-01-09', 'ar')).toBe('9 يناير 2025');
  });

  it('is written in the Hijri calendar with its era', () => {
    const date = { year: 1447, month: 10, day: 1 };
    expect(formatHijri(date, 'en')).toBe('1 Shawwal 1447 AH');
    expect(formatHijri(date, 'ar')).toBe('1 شوال 1447 هـ');
    expect(formatHijri({ year: 1446, month: 9, day: 30 }, 'ar')).toBe(
      '30 رمضان 1446 هـ',
    );
    expect(formatHijri({ year: 1447, month: 12, day: 9 }, 'en')).toBe(
      '9 Dhu al-Hijjah 1447 AH',
    );
  });

  it('uses Western digits in both languages', () => {
    for (const lang of ['ar', 'en'] as const) {
      const text =
        formatGregorian('2026-03-20', lang) +
        formatHijri({ year: 1447, month: 10, day: 1 }, lang);
      expect(text).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
    }
  });
});

describe('translated text', () => {
  const both = { ar: 'مدرسة النور', en: 'Al Noor School' };

  it('is shown in the language of the page', () => {
    expect(pickText(both, 'ar')).toEqual({ text: 'مدرسة النور', lang: 'ar' });
    expect(pickText(both, 'en')).toEqual({
      text: 'Al Noor School',
      lang: 'en',
    });
  });

  it('falls back to the other language, and says which one it is', () => {
    expect(pickText({ ar: 'مدرسة النور' }, 'en')).toEqual({
      text: 'مدرسة النور',
      lang: 'ar',
    });
    expect(pickText({ en: 'Al Noor School' }, 'ar')).toEqual({
      text: 'Al Noor School',
      lang: 'en',
    });
  });

  it('falls back to the untranslated text when there is no translation', () => {
    expect(pickText(null, 'ar', 'Al Amal School')).toEqual({
      text: 'Al Amal School',
      lang: undefined,
    });
    expect(pickText(null, 'ar')).toBeUndefined();
  });
});

describe('a language', () => {
  it('is Arabic or English', () => {
    expect(isLang('ar')).toBe(true);
    expect(isLang('en')).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(isLang('AR')).toBe(false);
  });

  it('decides the direction of the page', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});
