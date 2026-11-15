import { describe, expect, it } from 'vitest';
import { formatInstant } from '../lib/format';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

// The API gives instants in UTC. A screen shows them in the school's
// timezone and names the zone.
describe('an instant on a screen', () => {
  const accepted = '2026-11-15T14:23:35.766Z';

  it('is shown in Dubai time for a school in Dubai, in Arabic and in English', () => {
    expect(formatInstant(accepted, 'Asia/Dubai', 'ar')).toBe(
      '15 نوفمبر 2026، 18:23:35 (توقيت الإمارات العربية المتحدة)',
    );
    expect(formatInstant(accepted, 'Asia/Dubai', 'en')).toBe(
      '15 November 2026, 18:23:35 (United Arab Emirates Time)',
    );
  });

  it('is shown an hour earlier for a school in Riyadh, with that zone named', () => {
    expect(formatInstant(accepted, 'Asia/Riyadh', 'ar')).toBe(
      '15 نوفمبر 2026، 17:23:35 (توقيت المملكة العربية السعودية)',
    );
    expect(formatInstant(accepted, 'Asia/Riyadh', 'en')).toBe(
      '15 November 2026, 17:23:35 (Saudi Arabia Time)',
    );
  });

  it('moves to the next day when the school is already past midnight', () => {
    expect(formatInstant('2026-11-15T21:30:00Z', 'Asia/Dubai', 'en')).toBe(
      '16 November 2026, 01:30:00 (United Arab Emirates Time)',
    );
    expect(formatInstant('2026-12-31T20:00:00Z', 'Asia/Dubai', 'ar')).toBe(
      '1 يناير 2027، 00:00:00 (توقيت الإمارات العربية المتحدة)',
    );
  });

  it('counts the hours to 23, never to 24 and never by halves of the day', () => {
    expect(formatInstant('2026-11-15T19:59:59Z', 'Asia/Dubai', 'en')).toBe(
      '15 November 2026, 23:59:59 (United Arab Emirates Time)',
    );
    expect(formatInstant('2026-11-15T20:00:00Z', 'Asia/Dubai', 'en')).toBe(
      '16 November 2026, 00:00:00 (United Arab Emirates Time)',
    );
  });

  it('uses Western digits in both languages', () => {
    for (const lang of ['ar', 'en'] as const) {
      expect(formatInstant(accepted, 'Asia/Dubai', lang)).not.toMatch(
        /[\u0660-\u0669\u06F0-\u06F9]/,
      );
    }
  });

  it('refuses something that is not an instant', () => {
    expect(() => formatInstant('yesterday', 'Asia/Dubai', 'en')).toThrow(
      'is not an instant',
    );
  });

  it('has no wording left that says a time is in UTC', () => {
    for (const catalog of [ar, en]) {
      const text = Object.values(catalog).flat().join('\n');
      expect(text).not.toMatch(/UTC|GMT|غرينتش/);
    }
  });
});
