import { expect, test } from '@playwright/test';
import {
  calendarInvoices,
  calendarSchools,
  userCalendar,
  userCalendarStaff,
} from '../../db/seed';
import { invoicePath, invoicesPath, signIn } from './support/session';
import { WEB_URL } from './support/stack';

const { dubaiEid, dubaiPlain, riyadhEid, muscatEid, manamaEid, noCountry } =
  calendarInvoices;

test.describe('the invoice screen', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context, userCalendar);
  });

  test('shows the invoice in Arabic', async ({ page }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    await expect(page.getByTestId('school-name')).toHaveText(
      'مدرسة النور الدولية',
    );
    await expect(page.getByTestId('invoice-number')).toHaveText('INV-000001');
    await expect(page.getByTestId('description')).toHaveText(
      'الرسوم الدراسية للفصل الثالث',
    );
    await expect(page.getByTestId('description-heading')).toHaveText('البيان');
    await expect(page.getByTestId('amount-heading')).toHaveText('المبلغ');
  });

  test('shows the same invoice in English', async ({ page }) => {
    await page.goto(invoicePath('en', dubaiEid));
    await expect(page.getByTestId('school-name')).toHaveText(
      'Al Noor International School',
    );
    await expect(page.getByTestId('invoice-number')).toHaveText('INV-000001');
    await expect(page.getByTestId('description')).toHaveText(
      'Tuition fee, term 3',
    );
    await expect(page.getByTestId('description-heading')).toHaveText(
      'Description',
    );
    await expect(page.getByTestId('amount-heading')).toHaveText('Amount');
  });

  test('shows each date in both calendars, in Arabic', async ({ page }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '20 مارس 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '1 شوال 1447 هـ',
    );
    await expect(page.getByTestId('due-date-gregorian')).toHaveText(
      '17 أبريل 2026',
    );
    await expect(page.getByTestId('due-date-hijri')).toHaveText(
      '29 شوال 1447 هـ',
    );
  });

  test('shows each date in both calendars, in English', async ({ page }) => {
    await page.goto(invoicePath('en', dubaiEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '20 March 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '1 Shawwal 1447 AH',
    );
    await expect(page.getByTestId('due-date-gregorian')).toHaveText(
      '17 April 2026',
    );
    await expect(page.getByTestId('due-date-hijri')).toHaveText(
      '29 Shawwal 1447 AH',
    );
  });

  test('dates the same instant by each school’s own timezone', async ({
    page,
  }) => {
    await page.goto(invoicePath('en', dubaiEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '20 March 2026',
    );
    await page.goto(invoicePath('en', riyadhEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '19 March 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '30 Ramadan 1447 AH',
    );
  });

  test('shows the official month start where a country has one, and the calculated date elsewhere', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', muscatEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '30 مارس 2025',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '30 رمضان 1446 هـ',
    );

    await page.goto(invoicePath('ar', dubaiPlain));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '30 مارس 2025',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '1 شوال 1446 هـ',
    );

    await page.goto(invoicePath('ar', manamaEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '19 مارس 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '1 شوال 1447 هـ',
    );
  });

  test('shows what it has when the invoice has no description, due date or translated school name', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', noCountry));
    await expect(page.getByTestId('school-name')).toHaveText('Al Amal School');
    await expect(page.getByTestId('description')).toHaveText('رسوم دراسية');
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '30 رمضان 1447 هـ',
    );
    await expect(page.getByTestId('due-date-gregorian')).toHaveCount(0);
  });

  test('shows the invoice with its Gregorian date when the Hijri date cannot be worked out, in Arabic', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', calendarInvoices.kuwaitEid));
    await expect(page.getByTestId('invoice-document')).toBeVisible();
    await expect(page.getByTestId('error')).toHaveCount(0);
    await expect(page.getByTestId('invoice-number')).toHaveText('INV-000001');
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '20 مارس 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      'التاريخ الهجري غير متاح',
    );
    await expect(page.getByTestId('amount-value')).toHaveText('300.000');
  });

  test('shows the invoice with its Gregorian date when the Hijri date cannot be worked out, in English', async ({
    page,
  }) => {
    await page.goto(invoicePath('en', calendarInvoices.kuwaitEid));
    await expect(page.getByTestId('invoice-document')).toBeVisible();
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '20 March 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      'Hijri date unavailable',
    );
  });

  test('keeps the Hijri date of another date on the same invoice', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', calendarInvoices.kuwaitMixed));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '10 فبراير 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '22 شعبان 1447 هـ',
    );
    await expect(page.getByTestId('due-date-gregorian')).toHaveText(
      '20 مارس 2026',
    );
    await expect(page.getByTestId('due-date-hijri')).toHaveText(
      'التاريخ الهجري غير متاح',
    );
  });

  test('keeps the Hijri date of the same day in another country', async ({
    page,
  }) => {
    await page.goto(invoicePath('ar', calendarInvoices.kuwaitEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '20 مارس 2026',
    );
    await page.goto(invoicePath('ar', dubaiEid));
    await expect(page.getByTestId('issue-date-gregorian')).toHaveText(
      '20 مارس 2026',
    );
    await expect(page.getByTestId('issue-date-hijri')).toHaveText(
      '1 شوال 1447 هـ',
    );
  });

  test('lists a school’s invoices from the API, each linked to its screen', async ({
    page,
  }) => {
    await page.goto(invoicesPath('ar', calendarSchools.dubai));
    const links = page.getByTestId('invoice-link');
    await expect(links).toHaveText(['INV-000001', 'INV-000002']);
    await links.first().click();
    await expect(page).toHaveURL(WEB_URL + invoicePath('ar', dubaiEid));
    await expect(page.getByTestId('invoice-document')).toBeVisible();
  });

  test('links to the same invoice as a PDF', async ({ page }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    await expect(page.getByTestId('pdf-link')).toHaveAttribute(
      'href',
      `${invoicePath('ar', dubaiEid)}/pdf`,
    );
  });

  test('shows the print view of the document with nothing around it', async ({
    page,
  }) => {
    await page.goto(`${invoicePath('ar', dubaiEid)}/print`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('invoice-document')).toBeVisible();
    await expect(page.getByTestId('language-switch')).toHaveCount(0);
  });
});

test.describe('what the API refuses, the screen does not show', () => {
  test('nothing without a session', async ({ page }) => {
    await page.goto(invoicePath('ar', dubaiEid));
    await expect(page.getByTestId('error')).toHaveAttribute(
      'data-status',
      '401',
    );
    await expect(page.getByTestId('invoice-document')).toHaveCount(0);
  });

  test('nothing to staff, who do not hold finance:read', async ({
    page,
    context,
  }) => {
    await signIn(context, userCalendarStaff);
    await page.goto(invoicePath('ar', dubaiEid));
    await expect(page.getByTestId('error')).toHaveAttribute(
      'data-status',
      '403',
    );
    await expect(page.getByTestId('error')).toHaveAttribute(
      'data-code',
      'PERMISSION_DENIED',
    );
    await expect(page.getByTestId('invoice-document')).toHaveCount(0);

    await page.goto(invoicesPath('ar', calendarSchools.dubai));
    await expect(page.getByTestId('error')).toHaveAttribute(
      'data-code',
      'PERMISSION_DENIED',
    );
  });

  test('nothing for another school’s invoice', async ({ page, context }) => {
    await signIn(context, userCalendar);
    await page.goto(
      invoicePath('ar', { id: riyadhEid.id, tenantId: dubaiEid.tenantId }),
    );
    await expect(page.getByTestId('error')).toHaveAttribute(
      'data-status',
      '404',
    );
    await expect(page.getByTestId('invoice-document')).toHaveCount(0);
  });
});
