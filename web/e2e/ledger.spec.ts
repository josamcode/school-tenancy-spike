import { expect, Locator, test } from '@playwright/test';
import { demoSchools, userDemoPrincipal, userDemoTeacher } from '../../db/seed';
import { exchange, LANGS, schoolPath, words } from './support/demo';
import { boxOf, isLeftOf } from './support/geometry';
import { ARABIC_INDIC_DIGITS, signIn } from './support/session';

const { yasmin, rayhan } = demoSchools;
const [salem, tala] = yasmin.students;

// An amount is its number and then its currency code, in both languages.
async function expectMoney(within: Locator, value: string, currency: string) {
  const number = within.getByTestId('money-value');
  const code = within.getByTestId('money-currency');
  await expect(number).toHaveText(value);
  await expect(code).toHaveText(currency);
  expect(isLeftOf(await boxOf(number), await boxOf(code))).toBe(true);
}

for (const lang of LANGS) {
  test.describe(`the ledger, in ${lang}`, () => {
    test.beforeEach(async ({ context, page }) => {
      await signIn(context, userDemoPrincipal);
      await page.goto(schoolPath(lang, yasmin, 'ledger'));
    });

    test('is named and marked read only', async ({ page }) => {
      const text = words(lang);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        text['ledger.title'],
      );
      await expect(page.getByTestId('read-only')).toHaveText(
        text['ledger.readOnly'],
      );
    });

    test('shows that every currency sums to zero, at its own decimals', async ({
      page,
    }) => {
      const total = (currency: string) =>
        page.locator(
          `[data-testid="currency-total"][data-currency="${currency}"]`,
        );
      await expect(page.getByTestId('currency-total')).toHaveCount(3);
      await expectMoney(total('AED'), '0.00', 'AED');
      await expectMoney(total('BHD'), '0.000', 'BHD');
      await expectMoney(total('SAR'), '0.00', 'SAR');
      for (const currency of ['AED', 'BHD', 'SAR']) {
        await expect(total(currency)).toHaveAttribute('data-balanced', 'true');
        await expect(total(currency)).toContainText(
          words(lang)['ledger.balanced'],
        );
      }
    });

    test('shows what each student owes', async ({ page }) => {
      const balance = (student: { id: string }) =>
        page.locator(
          `[data-testid="student-balance"][data-student="${student.id}"]`,
        );
      await expect(page.getByTestId('student-balance')).toHaveCount(2);
      await expect(balance(salem)).toContainText(salem.fullName);
      await expectMoney(balance(salem), '0.00', 'AED');
      await expect(balance(tala)).toContainText(tala.fullName);
      await expectMoney(balance(tala), '206.00', 'AED');
    });

    test('shows the closed BHD position, the open SAR position and the FX gain', async ({
      page,
    }) => {
      const text = words(lang);
      const position = (currency: string) =>
        page.locator(
          `[data-testid="fx-position"][data-currency="${currency}"]`,
        );

      await expect(position('BHD')).toHaveAttribute('data-state', 'closed');
      await expect(position('BHD')).toContainText(
        text['ledger.positionClosed'],
      );
      await expectMoney(position('BHD').getByTestId('fx-held'), '0.000', 'BHD');

      await expect(position('SAR')).toHaveAttribute('data-state', 'open');
      await expect(position('SAR')).toContainText(text['ledger.positionOpen']);
      await expectMoney(
        position('SAR').getByTestId('fx-held'),
        '300.00',
        'SAR',
      );
      await expectMoney(
        position('SAR').getByTestId('fx-book-value'),
        '293.70',
        'AED',
      );

      const gain = page.getByTestId('fx-gain-loss');
      await expect(gain).toHaveAttribute('data-kind', 'gain');
      await expect(gain).toContainText(text['ledger.fxGain']);
      await expectMoney(gain, '4.70', 'AED');
    });

    test('shows which periods are locked', async ({ page }) => {
      const text = words(lang);
      const period = (start: string) =>
        page.locator(`[data-testid="period"][data-start="${start}"]`);
      await expect(page.getByTestId('period')).toHaveCount(2);

      await expect(period('2025-12-01')).toHaveAttribute(
        'data-status',
        'locked',
      );
      await expect(period('2025-12-01')).toContainText(text['ledger.locked']);
      await expect(period('2025-12-01')).toContainText('FY2025');
      await expect(period('2025-12-01')).toContainText(
        lang === 'ar' ? '31 ديسمبر 2025' : '31 December 2025',
      );

      await expect(period('2026-01-01')).toHaveAttribute('data-status', 'open');
      await expect(period('2026-01-01')).toContainText(text['ledger.open']);
    });

    test('has nothing to write with, and shows the one call it made', async ({
      page,
    }) => {
      await expect(page.getByTestId('currency-total').first()).toBeVisible();
      await expect(
        page
          .getByTestId('screen')
          .locator('button, input, select, textarea, form'),
      ).toHaveCount(0);

      const call = exchange(page, 'GET', `/schools/${yasmin.id}/ledger`);
      await expect(call).toHaveAttribute('data-status', '200');
      await expect(call).toHaveAttribute('data-outcome', 'allowed');
      await expect(call.getByTestId('exchange-body')).toContainText(
        '"currencyTotals"',
      );
      await expect(
        page.locator('[data-testid="exchange"][data-method="POST"]'),
      ).toHaveCount(0);
    });

    test('uses Western digits only', async ({ page }) => {
      await expect(page.getByTestId('student-balance').first()).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text).toMatch(/206\.00/);
      expect(text).not.toMatch(ARABIC_INDIC_DIGITS);
    });
  });

  test.describe(`the ledger for someone it is not for, in ${lang}`, () => {
    test('answers PERMISSION_DENIED to staff and shows no figure', async ({
      page,
      context,
    }) => {
      await signIn(context, userDemoTeacher);
      await page.goto(schoolPath(lang, yasmin, 'ledger'));
      await expect(page.getByTestId('error')).toHaveAttribute(
        'data-code',
        'PERMISSION_DENIED',
      );
      await expect(page.getByTestId('student-balance')).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText('206.00');
    });

    test('answers MODULE_DISABLED where finance is off', async ({
      page,
      context,
    }) => {
      await signIn(context, userDemoPrincipal);
      await page.goto(schoolPath(lang, rayhan, 'ledger'));
      await expect(page.getByTestId('error')).toHaveAttribute(
        'data-code',
        'MODULE_DISABLED',
      );
      await expect(page.getByTestId('currency-total')).toHaveCount(0);
    });
  });
}
