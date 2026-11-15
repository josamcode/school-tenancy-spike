import { describe, expect, it } from 'vitest';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

type Catalog = Record<string, string | string[]>;
const arabic = ar as Catalog;
const english = en as Catalog;

// The words of the app are the ones school and finance staff use, and one
// thing has one name on every screen.
describe('the words of the app', () => {
  it.each([
    ['response.title', 'رد الخادم', 'Server response'],
    ['response.allowed', 'مسموح', 'Allowed'],
    ['response.refused', 'مرفوض', 'Refused'],
    ['nav.students', 'الطلاب', 'Students'],
    ['nav.permissions', 'صلاحياتك', 'Your permissions'],
    ['nav.invoices', 'الفواتير', 'Invoices'],
    ['nav.ledger', 'دفتر الأستاذ', 'Ledger'],
    ['nav.admissions', 'القبول والتسجيل', 'Admissions'],
    ['ledger.readOnly', 'للقراءة فقط', 'Read only'],
    ['ledger.locked', 'مقفلة', 'Locked'],
    ['ledger.open', 'مفتوحة', 'Open'],
  ])('call %s "%s" and "%s"', (key, inArabic, inEnglish) => {
    expect(arabic[key]).toBe(inArabic);
    expect(english[key]).toBe(inEnglish);
  });

  it.each([
    ['nav.students', 'students.title'],
    ['nav.permissions', 'permissions.title'],
    ['nav.invoices', 'invoices.title'],
    ['nav.ledger', 'ledger.title'],
    ['nav.admissions', 'admissions.title'],
  ])('give a page the name its link has: %s and %s', (link, title) => {
    expect(arabic[link]).toBeDefined();
    expect(english[link]).toBeDefined();
    expect(arabic[title]).toBe(arabic[link]);
    expect(english[title]).toBe(english[link]);
  });

  it('say why something is refused in the same words on every screen', () => {
    for (const catalog of [arabic, english]) {
      expect(catalog['reason.moduleDisabled']).toBeDefined();
      expect(catalog['reason.permissionDenied']).toBeDefined();
      expect(catalog['reason.notYourSchool']).toBeDefined();
    }
  });

  it('keep the terms that were translated word for word out of the Arabic', () => {
    const text = Object.values(arabic).flat().join('\n');
    expect(text).not.toContain('الواجهة البرمجية');
    expect(text).not.toContain('ما يتاح لك');
    expect(text).not.toContain('ما أجابت به');
  });

  it('tell the reader what to do next in every error', () => {
    const errors = Object.keys(english).filter((key) =>
      key.startsWith('error.'),
    );
    expect(errors.length).toBeGreaterThanOrEqual(7);
    for (const key of errors) {
      // What happened, then what to do: two sentences in each language.
      expect(String(english[key]).split('. ').length).toBeGreaterThanOrEqual(2);
      expect(String(arabic[key]).split('. ').length).toBeGreaterThanOrEqual(2);
    }
  });
});
