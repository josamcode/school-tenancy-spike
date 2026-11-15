import { expect, test } from '@playwright/test';
import { calendarSchools, userCalendar } from '../../db/seed';
import { invoicesPath } from './support/session';
import { DEV_URL, SESSION_COOKIE } from './support/stack';

// Runs against the development server, which compiles each page on first use.
test.describe('signing in as a seed user, in development', () => {
  test.setTimeout(180_000);
  test.use({ baseURL: DEV_URL });

  const entry = `[data-user="${userCalendar.id}"][data-school="${calendarSchools.dubai.id}"]`;

  test('is labelled as a demo and lists the seed users', async ({ page }) => {
    await page.goto('/ar/dev/sign-in');
    await expect(page.getByTestId('demo-notice')).toBeVisible();
    await expect(page.getByTestId('demo-notice')).toContainText('Demo sign-in');
    expect(await page.getByTestId('sign-in-as').count()).toBeGreaterThanOrEqual(
      3,
    );
    await expect(
      page.getByTestId('sign-in-as').and(page.locator(entry)),
    ).toContainText(userCalendar.email);
  });

  test('starts a session as that user and shows their school’s invoices from the API', async ({
    page,
    context,
  }) => {
    await page.goto('/ar/dev/sign-in');
    await page.getByTestId('sign-in-as').and(page.locator(entry)).click();
    await expect(page).toHaveURL(
      DEV_URL + invoicesPath('ar', calendarSchools.dubai),
    );
    await expect(page.getByTestId('invoice-link')).toHaveText([
      'INV-000001',
      'INV-000002',
    ]);

    const session = (await context.cookies()).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    );
    expect(session?.httpOnly).toBe(true);
    // The token names the user and nothing else the API would trust.
    const claims = JSON.parse(
      Buffer.from(session!.value.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(claims.sub).toBe(userCalendar.id);
    expect(Object.keys(claims).sort()).toEqual(['exp', 'sub']);
  });

  test('has no session before anyone signs in', async ({ page }) => {
    await page.goto(invoicesPath('ar', calendarSchools.dubai));
    await expect(page.getByTestId('error')).toHaveAttribute(
      'data-status',
      '401',
    );
  });
});
