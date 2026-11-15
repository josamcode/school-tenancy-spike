import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { demoSchools, userDemoPrincipal, userDemoSindyan } from '../../db/seed';
import { exchange, LANGS, nameOf, schoolPath } from './support/demo';
import { ARABIC_INDIC_DIGITS, signIn } from './support/session';
import { WEB_URL } from './support/stack';

const { yasmin, rayhan, sindyan, ghadeer, murooj } = demoSchools;
const names = (school: { students: { fullName: string }[] }) =>
  school.students.map((student) => student.fullName);

for (const lang of LANGS) {
  test.describe(`isolation, in ${lang}`, () => {
    test.beforeEach(async ({ context }) => {
      await signIn(context, userDemoPrincipal);
    });

    test('lists the schools of the signed-in user and no other, as the API gives them', async ({
      page,
    }) => {
      await page.goto(schoolPath(lang, yasmin, 'students'));
      const links = page.getByTestId('school-link');
      await expect(links).toHaveText(
        [ghadeer, murooj, rayhan, yasmin].map((school) => nameOf(school, lang)),
      );
      expect(
        await links.evaluateAll((all) =>
          all.map((link) => link.getAttribute('data-school')),
        ),
      ).toEqual([ghadeer.id, murooj.id, rayhan.id, yasmin.id]);
      await expect(
        page.locator(`[data-testid="school-link"][data-school="${yasmin.id}"]`),
      ).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('body')).not.toContainText(
        nameOf(sindyan, lang),
      );

      const call = exchange(page, 'GET', '/me/schools');
      await expect(call).toHaveAttribute('data-status', '200');
      await expect(call).toHaveAttribute('data-outcome', 'allowed');
    });

    test('shows each school its own students and none of the other’s', async ({
      page,
    }) => {
      await page.goto(schoolPath(lang, yasmin, 'students'));
      await expect(page.getByTestId('student-row')).toHaveText(names(yasmin));
      await expect(
        exchange(page, 'GET', `/schools/${yasmin.id}/students`),
      ).toHaveAttribute('data-status', '200');

      await page
        .locator(`[data-testid="school-link"][data-school="${rayhan.id}"]`)
        .click();
      await expect(page).toHaveURL(
        WEB_URL + schoolPath(lang, rayhan, 'students'),
      );
      await expect(page.getByTestId('student-row')).toHaveText(names(rayhan));
      for (const name of names(yasmin)) {
        await expect(page.locator('body')).not.toContainText(name);
      }
      expect(await page.locator('body').innerText()).not.toMatch(
        ARABIC_INDIC_DIGITS,
      );
    });

    test('answers a school that is not the user’s with the plain 403, and shows none of it', async ({
      page,
      browser,
    }) => {
      // The school is there: its own principal sees its students.
      const other = await browser.newContext();
      await signIn(other, userDemoSindyan);
      const theirs = await other.newPage();
      await theirs.goto(WEB_URL + schoolPath(lang, sindyan, 'students'));
      await expect(theirs.getByTestId('student-row')).toHaveText(
        names(sindyan),
      );
      await other.close();

      await page.goto(
        `${schoolPath(lang, yasmin, 'students')}?try=${sindyan.id}`,
      );
      await expect(page.getByTestId('open-school-id')).toHaveValue(sindyan.id);
      await page.getByTestId('open-school').click();
      await expect(page).toHaveURL(
        WEB_URL + schoolPath(lang, sindyan, 'students'),
      );

      const error = page.getByTestId('error');
      await expect(error).toHaveAttribute('data-status', '403');
      await expect(error).not.toHaveAttribute('data-code', /.+/);
      await expect(error).toContainText(
        lang === 'ar' ? 'ليست من مدارسك' : 'not one of yours',
      );
      await expect(page.getByTestId('student-row')).toHaveCount(0);
      for (const name of names(sindyan)) {
        await expect(page.locator('body')).not.toContainText(name);
      }

      const call = exchange(page, 'GET', `/schools/${sindyan.id}/students`);
      await expect(call).toHaveAttribute('data-status', '403');
      await expect(call).toHaveAttribute('data-outcome', 'refused');
      await expect(call).not.toHaveAttribute('data-code', /.+/);
      await expect(call.getByTestId('exchange-body')).toContainText(
        '"statusCode": 403',
      );
    });

    test('answers a school that does not exist exactly as one that is not the user’s', async ({
      page,
    }) => {
      await page.goto(schoolPath(lang, sindyan, 'students'));
      const refused = await exchange(
        page,
        'GET',
        `/schools/${sindyan.id}/students`,
      )
        .getByTestId('exchange-body')
        .innerText();
      expect(refused).toContain('403');

      const unknown = randomUUID();
      await page.goto(schoolPath(lang, yasmin, 'students'));
      await page.getByTestId('open-school-id').fill(unknown);
      await page.getByTestId('open-school').click();
      await expect(page).toHaveURL(
        WEB_URL + schoolPath(lang, { id: unknown }, 'students'),
      );
      const call = exchange(page, 'GET', `/schools/${unknown}/students`);
      await expect(call).toHaveAttribute('data-status', '403');
      expect(await call.getByTestId('exchange-body').innerText()).toBe(refused);
    });

    test('answers 400 to something that is not a school id', async ({
      page,
    }) => {
      await page.goto(schoolPath(lang, yasmin, 'students'));
      await page.getByTestId('open-school-id').fill('not-a-school');
      await page.getByTestId('open-school').click();
      const error = page.getByTestId('error');
      await expect(error).toHaveAttribute('data-status', '400');
      await expect(page.getByTestId('student-row')).toHaveCount(0);
    });
  });
}
