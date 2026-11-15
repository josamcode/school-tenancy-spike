import { expect, test } from '@playwright/test';
import { calendarInvoices, userCalendar } from '../../db/seed';
import { boxOf, boxOfText, isLeftOf, onOneLine } from './support/geometry';
import {
  ARABIC_INDIC_DIGITS,
  invoicePath,
  Lang,
  signIn,
} from './support/session';
import { WEB_URL } from './support/stack';

const { dubaiEid, dubaiPlain, manamaEid } = calendarInvoices;

test.beforeEach(async ({ context }) => {
  await signIn(context, userCalendar);
});

test.describe('the direction of the page', () => {
  test('is right to left in Arabic and left to right in English', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('invoice-document')).toBeVisible();

    await page.goto(invoicePath('en', dubaiEid));
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByTestId('invoice-document')).toBeVisible();
  });

  test('is Arabic first: the root goes to the Arabic app', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(`${WEB_URL}/ar`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('follows the language switch, which keeps the same page', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    await page.getByTestId('language-switch').click();
    await expect(page).toHaveURL(WEB_URL + invoicePath('en', dubaiEid));
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByTestId('invoice-number')).toHaveText('INV-000001');

    await page.getByTestId('language-switch').click();
    await expect(page).toHaveURL(WEB_URL + invoicePath('ar', dubaiEid));
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('is refused for a language the app does not have', async ({ page }) => {
    const known = await page.goto(invoicePath('ar', dubaiEid));
    expect(known?.status()).toBe(200);
    const unknown = await page.goto(
      invoicePath('ar', dubaiEid).replace('/ar/', '/fr/'),
    );
    expect(unknown?.status()).toBe(404);
  });

  test('puts the first column on the right in Arabic and on the left in English', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    let description = await boxOf(page.getByTestId('description-heading'));
    let amount = await boxOf(page.getByTestId('amount-heading'));
    expect(isLeftOf(amount, description)).toBe(true);

    await page.goto(invoicePath('en', dubaiEid));
    description = await boxOf(page.getByTestId('description-heading'));
    amount = await boxOf(page.getByTestId('amount-heading'));
    expect(isLeftOf(description, amount)).toBe(true);
  });

  test('starts the Arabic text at the right edge and the English at the left', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    let frame = await boxOf(page.getByTestId('invoice-document'));
    let sentence = await boxOfText(page.getByTestId('issued-to'), 'صدرت');
    expect(frame.right - sentence.right).toBeLessThan(80);
    expect(sentence.left - frame.left).toBeGreaterThan(200);

    await page.goto(invoicePath('en', dubaiEid));
    frame = await boxOf(page.getByTestId('invoice-document'));
    sentence = await boxOfText(page.getByTestId('issued-to'), 'This');
    expect(sentence.left - frame.left).toBeLessThan(80);
    expect(frame.right - sentence.right).toBeGreaterThan(200);
  });
});

test.describe('mixed-direction content on the screen', () => {
  test('keeps an English name in order inside an Arabic sentence', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    const sentence = page.getByTestId('issued-to');
    await expect(sentence).toHaveText(
      'صدرت هذه الفاتورة للطالب Omar Al Farsi بتاريخ 20 مارس 2026.',
    );
    const before = await boxOfText(sentence, 'للطالب');
    const first = await boxOfText(sentence, 'Omar');
    const last = await boxOfText(sentence, 'Farsi');
    const after = await boxOfText(sentence, 'بتاريخ');

    // The name reads left to right; the sentence around it right to left.
    expect(isLeftOf(first, last)).toBe(true);
    expect(isLeftOf(last, before)).toBe(true);
    expect(isLeftOf(after, first)).toBe(true);
    expect(onOneLine(before, after)).toBe(true);
  });

  test('keeps an Arabic name in order inside an English sentence', async ({
    page,
  }) => {
    await page.goto(invoicePath('en', dubaiPlain));
    const sentence = page.getByTestId('issued-to');
    await expect(sentence).toHaveText(
      'This invoice was issued to ليلى حسن on 30 March 2025.',
    );
    const before = await boxOfText(sentence, 'issued to');
    const first = await boxOfText(sentence, 'ليلى');
    const last = await boxOfText(sentence, 'حسن');
    const after = await boxOfText(sentence, 'on');

    // The name reads right to left; the sentence around it left to right.
    expect(isLeftOf(last, first)).toBe(true);
    expect(isLeftOf(before, last)).toBe(true);
    expect(isLeftOf(first, after)).toBe(true);
    expect(onOneLine(before, after)).toBe(true);
  });

  test('isolates the name, so its direction comes from its own letters', async ({
    page,
  }) => {
    for (const lang of ['ar', 'en'] as Lang[]) {
      await page.goto(invoicePath(lang, dubaiEid));
      const name = page.getByTestId('student-name');
      expect(await name.evaluate((node) => node.tagName)).toBe('BDI');
      expect(
        await name.evaluate((node) => getComputedStyle(node).unicodeBidi),
      ).toBe('isolate');
    }
  });

  for (const lang of ['ar', 'en'] as Lang[]) {
    test(`reads the invoice number left to right in ${lang}`, async ({
      page,
    }) => {
      await page.goto(invoicePath(lang, dubaiEid));
      const number = page.getByTestId('invoice-number');
      await expect(number).toHaveText('INV-000001');
      const letters = await boxOfText(number, 'INV');
      const hyphen = await boxOfText(number, '-');
      const digits = await boxOfText(number, '000001');
      expect(isLeftOf(letters, hyphen)).toBe(true);
      expect(isLeftOf(hyphen, digits)).toBe(true);
    });

    test(`puts the amount before its currency code in ${lang}, with three decimals for BHD`, async ({
      page,
    }) => {
      await page.goto(invoicePath(lang, manamaEid));
      const value = page.getByTestId('amount-value');
      const currency = page.getByTestId('amount-currency');
      await expect(value).toHaveText('1,234.500');
      await expect(currency).toHaveText('BHD');
      const digits = await boxOfText(value, '1,234');
      const decimals = await boxOfText(value, '.500');
      expect(isLeftOf(digits, decimals)).toBe(true);
      expect(isLeftOf(decimals, await boxOf(currency))).toBe(true);

      await expect(page.getByTestId('total-value')).toHaveText('1,234.500');
      expect(
        isLeftOf(
          await boxOf(page.getByTestId('total-value')),
          await boxOf(page.getByTestId('total-currency')),
        ),
      ).toBe(true);
    });

    test(`shows two decimals for AED in ${lang}`, async ({ page }) => {
      await page.goto(invoicePath(lang, dubaiEid));
      await expect(page.getByTestId('amount-value')).toHaveText('12,500.00');
      await expect(page.getByTestId('amount-currency')).toHaveText('AED');
    });

    test(`uses Western digits only in ${lang}`, async ({ page }) => {
      await page.goto(invoicePath(lang, dubaiEid));
      await expect(page.getByTestId('invoice-document')).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/\d/);
      expect(text).not.toMatch(ARABIC_INDIC_DIGITS);
    });
  }
});

test.describe('fonts', () => {
  test('come from the app itself: the page asks no other host for anything', async ({
    page,
  }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(invoicePath('ar', dubaiEid));
    await page.evaluate(() => document.fonts.ready);

    expect(
      requests.some((url) => /\.woff2?$/.test(new URL(url).pathname)),
    ).toBe(true);
    expect(
      requests.filter(
        (url) => !url.startsWith(`${WEB_URL}/`) && !url.startsWith('data:'),
      ),
    ).toEqual([]);
  });

  test('are the bundled Noto faces, loaded for Arabic and for Latin text', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts]
        .filter((face) => face.status === 'loaded')
        .map((face) => face.family.replaceAll('"', ''));
    });
    expect(loaded).toContain('Noto Sans Arabic');
    expect(loaded).toContain('Noto Sans');
  });
});
