import { APIResponse, expect, Page, test } from '@playwright/test';
import {
  calendarInvoices,
  schoolC,
  userA,
  userCalendar,
  userCalendarStaff,
  userCDE,
} from '../../db/seed';
import { glyphForms, lines, readPdf } from './support/pdf-reader';
import {
  ARABIC_INDIC_DIGITS,
  invoicePath,
  Lang,
  pdfPath,
  signIn,
} from './support/session';

const { dubaiEid, dubaiPlain, muscatEid, manamaEid, riyadhEid } =
  calendarInvoices;
type Invoice = { id: string; tenantId: string };

const direction = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');

async function pdfOf(page: Page, lang: Lang, invoice: Invoice) {
  const response = await page.request.get(pdfPath(lang, invoice));
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  const file = await response.body();
  expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const pdf = readPdf(file);
  return { pdf, text: lines(pdf, direction(lang)) };
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).sort();

test.describe('the invoice PDF', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, userCalendar);
  });

  test('reads in logical order in Arabic, with the English name inside the sentence', async ({
    page,
  }) => {
    const { text } = await pdfOf(page, 'ar', dubaiEid);
    expect(text).toContain(
      'صدرت هذه الفاتورة للطالب Omar Al Farsi بتاريخ 20 مارس 2026.',
    );
    expect(text).toContain('مدرسة النور الدولية');
    expect(text.join('\n')).toContain('الرسوم الدراسية للفصل الثالث');
    expect(text.join('\n')).toContain('INV-000001');
  });

  test('reads in logical order in English, with the Arabic name inside the sentence', async ({
    page,
  }) => {
    const { text } = await pdfOf(page, 'en', dubaiPlain);
    expect(text).toContain(
      'This invoice was issued to ليلى حسن on 30 March 2025.',
    );
    expect(text).toContain('Al Noor International School');
    expect(text.join('\n')).toContain('School transport fee');
    expect(text.join('\n')).toContain('INV-000002');
  });

  test('joins the Arabic letters: one letter is drawn with a different glyph in each position', async ({
    page,
  }) => {
    const { pdf } = await pdfOf(page, 'ar', dubaiEid);
    const forms = glyphForms(pdf);
    // Lam at the start, in the middle and at the end of a word; alef alone
    // and joined to the letter before it.
    expect(forms.get('ل')?.size).toBeGreaterThanOrEqual(3);
    expect(forms.get('ا')?.size).toBeGreaterThanOrEqual(2);
    // A Latin letter has no positions: one glyph, wherever it stands.
    expect(forms.get('a')?.size).toBe(1);
  });

  for (const lang of ['ar', 'en'] as Lang[]) {
    test(`embeds every font, and only the bundled ones, in ${lang}`, async ({
      page,
    }) => {
      const { pdf } = await pdfOf(page, lang, dubaiEid);
      expect(pdf.fonts.length).toBeGreaterThanOrEqual(2);
      expect(pdf.otherFonts).toBe(0);
      for (const font of pdf.fonts) {
        expect(font.embedded).toBe(true);
        expect(font.name).toMatch(
          /^[A-Z]{6}\+NotoSans(Arabic)?-(Regular|Bold)$/,
        );
      }
      const families = pdf.fonts.map((font) => font.name.slice(7));
      expect(families.some((name) => name.startsWith('NotoSans-'))).toBe(true);
      if (lang === 'ar') {
        expect(
          families.some((name) => name.startsWith('NotoSansArabic-')),
        ).toBe(true);
      }
    });

    test(`has the amount with its currency in ${lang}, three decimals for BHD`, async ({
      page,
    }) => {
      const bhd = (await pdfOf(page, lang, manamaEid)).text.join('\n');
      expect(bhd).toContain('1,234.500 BHD');
      const omr = (await pdfOf(page, lang, muscatEid)).text.join('\n');
      expect(omr).toContain('450.250 OMR');
      const aed = (await pdfOf(page, lang, dubaiEid)).text.join('\n');
      expect(aed).toContain('12,500.00 AED');
    });

    test(`says what the screen says in ${lang}`, async ({ page }) => {
      for (const invoice of [dubaiEid, dubaiPlain, manamaEid]) {
        await page.goto(invoicePath(lang, invoice));
        const screen = await page.getByTestId('invoice-document').innerText();
        const { text } = await pdfOf(page, lang, invoice);
        expect(words(text.join('\n'))).toEqual(words(screen));
      }
    });

    test(`uses Western digits only in ${lang}`, async ({ page }) => {
      const { text } = await pdfOf(page, lang, dubaiEid);
      expect(text.join('\n')).toMatch(/\d/);
      expect(text.join('\n')).not.toMatch(ARABIC_INDIC_DIGITS);
    });

    test(`is one A4 page in ${lang}`, async ({ page }) => {
      const { pdf } = await pdfOf(page, lang, dubaiEid);
      expect(pdf.pages).toBe(1);
    });
  }

  test('has both dates in both calendars, in Arabic', async ({ page }) => {
    const text = (await pdfOf(page, 'ar', dubaiEid)).text.join('\n');
    expect(text).toContain('20 مارس 2026');
    expect(text).toContain('1 شوال 1447 هـ');
    expect(text).toContain('17 أبريل 2026');
    expect(text).toContain('29 شوال 1447 هـ');
  });

  test('has both dates in both calendars, in English', async ({ page }) => {
    const text = (await pdfOf(page, 'en', dubaiEid)).text.join('\n');
    expect(text).toContain('20 March 2026');
    expect(text).toContain('1 Shawwal 1447 AH');
    expect(text).toContain('17 April 2026');
    expect(text).toContain('29 Shawwal 1447 AH');
  });

  test('has the Gregorian date and says the Hijri date is unavailable when it cannot be worked out, in Arabic', async ({
    page,
  }) => {
    const { text } = await pdfOf(page, 'ar', calendarInvoices.kuwaitEid);
    expect(text.join('\n')).toContain('20 مارس 2026');
    expect(text).toContain('التاريخ الهجري غير متاح');
    expect(text.join('\n')).toContain('300.000 KWD');
  });

  test('has the Gregorian date and says the Hijri date is unavailable when it cannot be worked out, in English', async ({
    page,
  }) => {
    const { text } = await pdfOf(page, 'en', calendarInvoices.kuwaitEid);
    expect(text.join('\n')).toContain('20 March 2026');
    expect(text).toContain('Hijri date unavailable');
    expect(text.join('\n')).toContain('300.000 KWD');
  });

  test('keeps the Hijri date of another date on the same invoice', async ({
    page,
  }) => {
    const text = (
      await pdfOf(page, 'ar', calendarInvoices.kuwaitMixed)
    ).text.join('\n');
    expect(text).toContain('10 فبراير 2026');
    expect(text).toContain('22 شعبان 1447 هـ');
    expect(text).toContain('20 مارس 2026');
    expect(text).toContain('التاريخ الهجري غير متاح');
  });

  test('says what the screen says when the Hijri date is unavailable', async ({
    page,
  }) => {
    for (const lang of ['ar', 'en'] as Lang[]) {
      await page.goto(invoicePath(lang, calendarInvoices.kuwaitMixed));
      const screen = await page.getByTestId('invoice-document').innerText();
      const { text } = await pdfOf(page, lang, calendarInvoices.kuwaitMixed);
      expect(words(text.join('\n'))).toEqual(words(screen));
    }
  });

  test('has the official month start where a country has one', async ({
    page,
  }) => {
    const muscat = (await pdfOf(page, 'ar', muscatEid)).text.join('\n');
    expect(muscat).toContain('30 مارس 2025');
    expect(muscat).toContain('30 رمضان 1446 هـ');
    const dubai = (await pdfOf(page, 'ar', dubaiPlain)).text.join('\n');
    expect(dubai).toContain('30 مارس 2025');
    expect(dubai).toContain('1 شوال 1446 هـ');
  });
});

test.describe('the PDF answers as the API does', () => {
  const body = async (response: APIResponse) =>
    (await response.json()) as { code?: string; message?: string };

  test('401 without a session', async ({ page }) => {
    const response = await page.request.get(pdfPath('ar', dubaiEid));
    expect(response.status()).toBe(401);
  });

  test('400 for a malformed school id', async ({ page, context }) => {
    await signIn(context, userCalendar);
    const response = await page.request.get(
      pdfPath('ar', { id: dubaiEid.id, tenantId: 'not-a-uuid' }),
    );
    expect(response.status()).toBe(400);
  });

  test('the plain 403 with no access to the school', async ({
    page,
    context,
  }) => {
    await signIn(context, userA);
    const response = await page.request.get(pdfPath('ar', dubaiEid));
    expect(response.status()).toBe(403);
    expect(await body(response)).not.toHaveProperty('code');
  });

  test('403 MODULE_DISABLED where finance is off', async ({
    page,
    context,
  }) => {
    await signIn(context, userCDE);
    const response = await page.request.get(
      pdfPath('ar', { id: dubaiEid.id, tenantId: schoolC.id }),
    );
    expect(response.status()).toBe(403);
    expect((await body(response)).code).toBe('MODULE_DISABLED');
  });

  test('403 PERMISSION_DENIED to staff', async ({ page, context }) => {
    await signIn(context, userCalendarStaff);
    const response = await page.request.get(pdfPath('ar', dubaiEid));
    expect(response.status()).toBe(403);
    expect((await body(response)).code).toBe('PERMISSION_DENIED');
  });

  test('404 for another school’s invoice', async ({ page, context }) => {
    await signIn(context, userCalendar);
    const response = await page.request.get(
      pdfPath('ar', { id: riyadhEid.id, tenantId: dubaiEid.tenantId }),
    );
    expect(response.status()).toBe(404);
    expect((await body(response)).message).toBe('Invoice not found');
  });

  test('404 for a language the app does not have', async ({
    page,
    context,
  }) => {
    await signIn(context, userCalendar);
    const known = await page.request.get(pdfPath('ar', dubaiEid));
    expect(known.status()).toBe(200);
    const response = await page.request.get(
      pdfPath('ar', dubaiEid).replace('/ar/', '/fr/'),
    );
    expect(response.status()).toBe(404);
  });
});
