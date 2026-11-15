import { expect, Page, test } from '@playwright/test';
import {
  demoSchools,
  userDemoGroupAdmin,
  userDemoPrincipal,
  userDemoTeacher,
} from '../../db/seed';
import { areaRow, exchange, LANGS, schoolPath, words } from './support/demo';
import { Lang, signIn } from './support/session';

const { yasmin, rayhan } = demoSchools;
const AREAS = ['students', 'invoices', 'ledger', 'admissions'] as const;
type Area = (typeof AREAS)[number];

// What a row of the page must say: the word, never the color alone.
async function expectAllowed(page: Page, lang: Lang, area: Area) {
  const row = areaRow(page, area);
  await expect(row).toHaveAttribute('data-outcome', 'allowed');
  await expect(row).toHaveAttribute('data-status', '200');
  await expect(row).toContainText(words(lang)['response.allowed']);
}

async function expectRefused(
  page: Page,
  lang: Lang,
  area: Area,
  code: 'MODULE_DISABLED' | 'PERMISSION_DENIED' | null,
) {
  const text = words(lang);
  const row = areaRow(page, area);
  await expect(row).toHaveAttribute('data-outcome', 'refused');
  await expect(row).toHaveAttribute('data-status', '403');
  await expect(row).toContainText(text['response.refused']);
  if (code === null) {
    await expect(row).not.toHaveAttribute('data-code', /.+/);
    await expect(row).toContainText(text['reason.notYourSchool']);
  } else {
    await expect(row).toHaveAttribute('data-code', code);
    await expect(row).toContainText(
      text[
        code === 'MODULE_DISABLED'
          ? 'reason.moduleDisabled'
          : 'reason.permissionDenied'
      ],
    );
  }
}

for (const lang of LANGS) {
  test.describe(`modules, in ${lang}`, () => {
    test.beforeEach(async ({ context }) => {
      await signIn(context, userDemoPrincipal);
    });

    test('answers MODULE_DISABLED for finance where it is off, while students still work', async ({
      page,
    }) => {
      await page.goto(schoolPath(lang, rayhan));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        words(lang)['permissions.title'],
      );
      await expectAllowed(page, lang, 'students');
      await expectRefused(page, lang, 'invoices', 'MODULE_DISABLED');
      await expectRefused(page, lang, 'ledger', 'MODULE_DISABLED');

      const call = exchange(page, 'GET', `/schools/${rayhan.id}/invoices`);
      await expect(call).toHaveAttribute('data-status', '403');
      await expect(call).toHaveAttribute('data-code', 'MODULE_DISABLED');
      await expect(call.getByTestId('exchange-body')).toContainText(
        '"code": "MODULE_DISABLED"',
      );

      // The pages themselves say the same.
      await page.goto(schoolPath(lang, rayhan, 'invoices'));
      await expect(page.getByTestId('error')).toHaveAttribute(
        'data-code',
        'MODULE_DISABLED',
      );
      await page.goto(schoolPath(lang, rayhan, 'students'));
      await expect(page.getByTestId('student-row')).toHaveCount(2);
    });

    test('answers 200 for the same pages where finance is on', async ({
      page,
    }) => {
      await page.goto(schoolPath(lang, yasmin));
      for (const area of AREAS) await expectAllowed(page, lang, area);
    });

    test('has nothing that switches a module on or off, and says whose right that is', async ({
      page,
    }) => {
      await page.goto(schoolPath(lang, rayhan));
      await expect(areaRow(page, 'invoices')).toBeVisible();
      await expect(
        page
          .getByTestId('screen')
          .locator('button, input, select, textarea, form'),
      ).toHaveCount(0);
      await expect(page.getByTestId('module-note')).toHaveText(
        words(lang)['permissions.moduleNote'],
      );
    });
  });

  test.describe(`permissions, in ${lang}`, () => {
    test('allows a school admin everything', async ({ page, context }) => {
      await signIn(context, userDemoPrincipal);
      await page.goto(schoolPath(lang, yasmin));
      const role = page.getByTestId('access-role');
      await expect(role).toHaveAttribute('data-role', 'school_admin');
      await expect(role).toContainText(words(lang)['role.school_admin']);
      for (const area of AREAS) await expectAllowed(page, lang, area);
    });

    test('allows a staff member the students and answers PERMISSION_DENIED for the rest', async ({
      page,
      context,
    }) => {
      await signIn(context, userDemoTeacher);
      await page.goto(schoolPath(lang, yasmin));
      const role = page.getByTestId('access-role');
      await expect(role).toHaveAttribute('data-role', 'staff');
      await expect(role).toContainText(words(lang)['role.staff']);

      await expectAllowed(page, lang, 'students');
      for (const area of ['invoices', 'ledger', 'admissions'] as const) {
        await expectRefused(page, lang, area, 'PERMISSION_DENIED');
      }
      const call = exchange(page, 'GET', `/schools/${yasmin.id}/ledger`);
      await expect(call).toHaveAttribute('data-code', 'PERMISSION_DENIED');
      await expect(call.getByTestId('exchange-body')).toContainText(
        '"code": "PERMISSION_DENIED"',
      );

      // The pages themselves say the same.
      for (const name of ['invoices', 'ledger', 'admissions'] as const) {
        await page.goto(schoolPath(lang, yasmin, name));
        await expect(page.getByTestId('error')).toHaveAttribute(
          'data-code',
          'PERMISSION_DENIED',
        );
      }
      await page.goto(schoolPath(lang, yasmin, 'students'));
      await expect(page.getByTestId('student-row')).toHaveCount(2);
    });

    test('allows the group admin what the grant names and nothing else', async ({
      page,
      context,
    }) => {
      await signIn(context, userDemoGroupAdmin);
      await page.goto(schoolPath(lang, yasmin));
      const role = page.getByTestId('access-role');
      await expect(role).not.toHaveAttribute('data-role', /.+/);
      await expect(role).toHaveAttribute('data-grants', 'finance:read');
      await expect(role).toContainText(words(lang)['role.grant']);

      await expectAllowed(page, lang, 'invoices');
      await expectAllowed(page, lang, 'ledger');
      await expectRefused(page, lang, 'students', 'PERMISSION_DENIED');
      await expectRefused(page, lang, 'admissions', 'PERMISSION_DENIED');
      await expect(page.getByTestId('school-link')).toHaveCount(1);
    });

    test('answers the group admin the plain 403 in a school of their group where they hold no grant', async ({
      page,
      context,
    }) => {
      // The school is there, and an admin of it is allowed its students.
      await signIn(context, userDemoPrincipal);
      await page.goto(schoolPath(lang, rayhan));
      await expectAllowed(page, lang, 'students');

      await context.clearCookies();
      await signIn(context, userDemoGroupAdmin);
      await page.goto(schoolPath(lang, rayhan));
      for (const area of AREAS) await expectRefused(page, lang, area, null);
    });
  });
}
