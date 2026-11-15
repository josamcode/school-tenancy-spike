import { expect, Page, test } from '@playwright/test';
import {
  demoPending,
  demoSchools,
  userDemoGroupAdmin,
  userDemoPrincipal,
  userDemoTeacher,
} from '../../db/seed';
import { LANGS, schoolPath, words } from './support/demo';
import { Lang } from './support/session';
import { DEV_URL } from './support/stack';

const { yasmin, rayhan, sindyan, ghadeer, murooj } = demoSchools;

// Runs against the development server, which compiles each page on first use.
test.describe('the demo guide, in development', () => {
  test.setTimeout(240_000);
  test.use({ baseURL: DEV_URL });

  const entry = (page: Page, id: string) =>
    page.locator(`[data-testid="sign-in-as"][data-entry="${id}"]`);
  const signInAs = async (page: Page, lang: Lang, id: string) => {
    await page.goto(`/${lang}/dev/sign-in`);
    await expect(entry(page, id)).toBeVisible();
    await entry(page, id).click();
    // The development server may still be compiling what comes next.
    await page.waitForURL((url) => !url.pathname.endsWith('/dev/sign-in'), {
      timeout: 60_000,
    });
  };

  for (const lang of LANGS) {
    test(`lists the five proofs and the invoices, in ${lang}`, async ({
      page,
    }) => {
      await page.goto(`/${lang}/dev/sign-in`);
      await expect(page.getByTestId('demo-notice')).toContainText(
        'Demo sign-in',
      );
      const groups = page.getByTestId('guide-group');
      expect(
        await groups.evaluateAll((all) =>
          all.map((group) => group.getAttribute('data-group')),
        ),
      ).toEqual([
        'isolation',
        'modules',
        'permissions',
        'ledger',
        'events',
        'invoices',
      ]);
      await expect(
        page.locator('[data-group="isolation"]').getByRole('heading'),
      ).toHaveText(lang === 'ar' ? 'عزل بيانات المدارس' : 'Tenant isolation');
      // The page says what it is in the language it is in.
      await expect(entry(page, 'ledger')).toContainText(
        lang === 'ar' ? 'دفتر الأستاذ' : 'ledger',
      );
    });
  }

  test('lands the isolation proof on the students, with a school that is not the user’s ready to open', async ({
    page,
  }) => {
    await signInAs(page, 'ar', 'isolation');
    await expect(page).toHaveURL(
      `${DEV_URL}${schoolPath('ar', yasmin, 'students')}?try=${sindyan.id}`,
    );
    await expect(page.getByTestId('student-row')).toHaveCount(2);
    await expect(page.getByTestId('open-school-id')).toHaveValue(sindyan.id);
  });

  test('lands the modules proof on a school with finance on and on one with finance off', async ({
    page,
  }) => {
    await signInAs(page, 'ar', 'modules-on');
    await expect(page).toHaveURL(DEV_URL + schoolPath('ar', yasmin));
    await expect(
      page.locator('[data-testid="area-row"][data-area="invoices"]'),
    ).toHaveAttribute('data-outcome', 'allowed');

    await signInAs(page, 'ar', 'modules-off');
    await expect(page).toHaveURL(DEV_URL + schoolPath('ar', rayhan));
    await expect(
      page.locator('[data-testid="area-row"][data-area="invoices"]'),
    ).toHaveAttribute('data-code', 'MODULE_DISABLED');
  });

  test('lands the permissions proof on the same page as three different users', async ({
    page,
    context,
  }) => {
    const subject = async () => {
      const session = (await context.cookies()).find(
        (cookie) => cookie.name === 'session',
      );
      return JSON.parse(
        Buffer.from(session!.value.split('.')[1], 'base64url').toString(),
      ).sub as string;
    };
    for (const [id, user, role] of [
      ['permissions-admin', userDemoPrincipal, 'school_admin'],
      ['permissions-staff', userDemoTeacher, 'staff'],
      ['permissions-group-admin', userDemoGroupAdmin, null],
    ] as const) {
      await signInAs(page, 'en', id);
      await expect(page).toHaveURL(DEV_URL + schoolPath('en', yasmin));
      expect(await subject()).toBe(user.id);
      const shown = page.getByTestId('access-role');
      if (role) await expect(shown).toHaveAttribute('data-role', role);
      else await expect(shown).toHaveAttribute('data-grants', 'finance:read');
    }
  });

  test('lands the ledger proof on the ledger', async ({ page }) => {
    await signInAs(page, 'ar', 'ledger');
    await expect(page).toHaveURL(DEV_URL + schoolPath('ar', yasmin, 'ledger'));
    await expect(page.getByTestId('student-balance')).toHaveCount(2);
  });

  test('lands the events proof on the applications of the fee school and of the webhook school', async ({
    page,
  }) => {
    await signInAs(page, 'ar', 'events-fee');
    await expect(page).toHaveURL(
      DEV_URL + schoolPath('ar', ghadeer, 'admissions'),
    );
    await expect(page.getByTestId('application')).toHaveCount(6);

    await signInAs(page, 'ar', 'events-webhook');
    await expect(page).toHaveURL(
      DEV_URL + schoolPath('ar', murooj, 'admissions'),
    );
    await expect(page.getByTestId('application')).toHaveCount(6);
  });

  // Murooj is also written by the acceptance tests, which take its first two
  // applications. These two are the third and the fourth.
  for (const lang of LANGS) {
    test(`shows what the receiver recorded, signature included, in ${lang}`, async ({
      page,
    }) => {
      const application = demoPending.murooj[lang === 'ar' ? 2 : 3];
      await signInAs(page, lang, 'events-webhook');
      await page
        .locator(
          `[data-testid="application"][data-application="${application.id}"]`,
        )
        .getByTestId('accept')
        .click();

      const record = page.getByTestId('receiver-record');
      await expect(record).toHaveAttribute('data-signature', 'valid', {
        timeout: 90_000,
      });
      await expect(record).toContainText(
        words(lang)['receiver.signatureValid'],
      );
      await expect(record).toContainText(
        words(lang)['receiver.developmentOnly'],
      );
    });
  }
});
