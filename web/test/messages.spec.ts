import { describe, expect, it } from 'vitest';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

type Catalog = Record<string, string | string[]>;

const strings = (catalog: Catalog) => Object.values(catalog).flat();

describe('the interface catalogs', () => {
  it('have the same keys in Arabic and in English', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(ar).length).toBeGreaterThan(10);
  });

  it('leave no text empty', () => {
    for (const catalog of [ar, en] as Catalog[]) {
      for (const text of strings(catalog)) expect(text.trim()).not.toBe('');
    }
  });

  it('name twelve Gregorian and twelve Hijri months in each language', () => {
    for (const catalog of [ar, en] as Catalog[]) {
      expect(catalog.gregorianMonths).toHaveLength(12);
      expect(catalog.hijriMonths).toHaveLength(12);
      expect(new Set(catalog.gregorianMonths).size).toBe(12);
      expect(new Set(catalog.hijriMonths).size).toBe(12);
    }
  });

  it('write the Arabic catalog in Arabic letters', () => {
    const arabic = strings(ar as Catalog).filter((text) =>
      /[\u0600-\u06FF]/.test(text),
    );
    expect(arabic.length).toBeGreaterThan(strings(ar as Catalog).length * 0.9);
  });

  it('use Western digits only', () => {
    for (const catalog of [ar, en] as Catalog[]) {
      for (const text of strings(catalog)) {
        expect(text).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
      }
    }
  });

  it('keep the same placeholders in both languages', () => {
    const placeholders = (text: string | string[]) =>
      [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of Object.keys(en)) {
      expect(placeholders((ar as Catalog)[key])).toEqual(
        placeholders((en as Catalog)[key]),
      );
    }
  });
});
