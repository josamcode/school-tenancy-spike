import { expect, Page, test } from '@playwright/test';
import { demoInvoices, demoSchools, userDemoPrincipal } from '../../db/seed';
import {
  exchange,
  fitsItsWidth,
  LANGS,
  LAPIS,
  PALETTE_RGB,
  PAPER,
  schoolPath,
  sweepStyles,
  words,
} from './support/demo';
import { boxOf, isLeftOf } from './support/geometry';
import { invoicePath, Lang, signIn } from './support/session';

const { yasmin, ghadeer, sindyan } = demoSchools;
const invoice = { id: demoInvoices.salem.id, tenantId: yasmin.id };

// Every screen of the app, each with something that shows it has loaded.
const screens = (
  lang: Lang,
): [name: string, path: string, loaded: string][] => [
  ['home', `/${lang}`, 'my-school'],
  ['students', schoolPath(lang, yasmin, 'students'), 'student-row'],
  ['permissions', schoolPath(lang, yasmin), 'area-row'],
  ['invoices', schoolPath(lang, yasmin, 'invoices'), 'invoice-link'],
  ['invoice', invoicePath(lang, invoice), 'invoice-document'],
  ['ledger', schoolPath(lang, yasmin, 'ledger'), 'student-balance'],
  ['admissions', schoolPath(lang, ghadeer, 'admissions'), 'application'],
  ['a refusal', schoolPath(lang, sindyan, 'students'), 'error'],
];

async function open(page: Page, path: string, loaded: string) {
  await page.goto(path);
  await expect(page.getByTestId(loaded).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test.beforeEach(async ({ context }) => {
  await signIn(context, userDemoPrincipal);
});

for (const lang of LANGS) {
  test.describe(`the design, in ${lang}`, () => {
    test('uses the six colors of the palette and no other, on every screen', async ({
      page,
    }) => {
      for (const [name, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        const { colors } = await sweepStyles(page);
        expect(
          colors
            .filter((color) => !PALETTE_RGB.includes(color))
            .map((color) => `${name}: ${color}`),
        ).toEqual([]);
        // The page is on paper, the invoice screens included.
        expect(
          await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
          ),
        ).toBe(PAPER);
      }
    });

    test('has no gradient, shadow, glow, rounded corner, capitals or tracking anywhere', async ({
      page,
    }) => {
      for (const [name, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        const { decoration } = await sweepStyles(page);
        expect(decoration.map((problem) => `${name}: ${problem}`)).toEqual([]);
      }
    });

    test('sets the raw server response in monospace and everything else in the bundled Noto faces', async ({
      page,
    }) => {
      for (const [name, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        const { monospaceOutsideRaw, otherFonts } = await sweepStyles(page);
        expect(
          [...monospaceOutsideRaw, ...otherFonts].map(
            (problem) => `${name}: ${problem}`,
          ),
        ).toEqual([]);
        await expect(page.getByTestId('exchange-raw').first()).toBeVisible();
      }
    });

    test('moves nothing when a page opens', async ({ page }) => {
      for (const [name, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        const { moving } = await sweepStyles(page);
        expect(
          moving
            .filter((problem) => / animation /.test(problem))
            .map((problem) => `${name}: ${problem}`),
        ).toEqual([]);
      }
    });

    test('puts the server response on the end side of the screen on a desktop', async ({
      page,
    }) => {
      for (const [, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        const screen = await boxOf(page.getByTestId('screen'));
        const response = await boxOf(page.getByTestId('server-response'));
        expect(
          lang === 'ar'
            ? isLeftOf(response, screen)
            : isLeftOf(screen, response),
        ).toBe(true);
      }
    });

    test('fits a phone: the response goes under the screen and nothing scrolls sideways', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      for (const [name, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        expect(`${name}: ${await fitsItsWidth(page)}`).toBe(`${name}: true`);
        const screen = await boxOf(page.getByTestId('screen'));
        const response = await boxOf(page.getByTestId('server-response'));
        expect(response.top).toBeGreaterThanOrEqual(screen.bottom - 1);
        expect(screen.right - screen.left).toBeGreaterThan(300);
      }
    });

    test('names the server response and says allowed or refused in words on every call', async ({
      page,
    }) => {
      const text = words(lang);
      for (const [, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        await expect(
          page.getByTestId('server-response').getByRole('heading'),
        ).toHaveText(text['response.title']);
        const calls = page.getByTestId('exchange');
        expect(await calls.count()).toBeGreaterThan(0);
        for (const call of await calls.all()) {
          const outcome = await call.getAttribute('data-outcome');
          expect(['allowed', 'refused']).toContain(outcome);
          await expect(call.getByTestId('exchange-outcome')).toHaveText(
            text[`response.${outcome}`],
          );
          await expect(call.getByTestId('exchange-status')).toHaveText(
            (await call.getAttribute('data-status'))!,
          );
        }
      }
    });

    test('colors allowed and refused the same way everywhere, always beside the word', async ({
      page,
    }) => {
      await open(page, schoolPath(lang, yasmin), 'area-row');
      const colorOf = (testId: string, outcome: string) =>
        page
          .locator(`[data-outcome="${outcome}"] [data-testid="${testId}"]`)
          .first()
          .evaluate((node) => getComputedStyle(node).color);
      const allowed = await colorOf('exchange-outcome', 'allowed');
      expect(allowed).toBe(PALETTE_RGB[4]);
      expect(await colorOf('area-outcome', 'allowed')).toBe(allowed);

      await open(page, schoolPath(lang, sindyan, 'students'), 'error');
      const refused = await colorOf('exchange-outcome', 'refused');
      expect(refused).toBe(PALETTE_RGB[5]);
      await expect(
        exchange(page, 'GET', `/schools/${sindyan.id}/students`).getByTestId(
          'exchange-outcome',
        ),
      ).toHaveText(words(lang)['response.refused']);
    });

    test('shows where the keyboard is', async ({ page }) => {
      await open(page, schoolPath(lang, yasmin, 'students'), 'student-row');
      const seen = new Set<string>();
      for (let presses = 0; presses < 40; presses++) {
        await page.keyboard.press('Tab');
        const focused = await page.evaluate(() => {
          const element = document.activeElement!;
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            style: style.outlineStyle,
            width: parseFloat(style.outlineWidth),
            color: style.outlineColor,
          };
        });
        if (focused.tag === 'BODY') break;
        seen.add(focused.tag);
        expect(focused.style).not.toBe('none');
        expect(focused.width).toBeGreaterThanOrEqual(2);
        expect(focused.color).toBe(LAPIS);
      }
      // Links, the field and the button were all reached.
      expect([...seen].sort()).toEqual(
        expect.arrayContaining(['A', 'BUTTON', 'INPUT']),
      );
    });

    test('keeps still for someone who asked for less motion', async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const [name, path, loaded] of screens(lang)) {
        await open(page, path, loaded);
        const { moving } = await sweepStyles(page);
        expect(moving.map((problem) => `${name}: ${problem}`)).toEqual([]);
      }
    });

    test('gives the invoice screens the same shell and the same server response', async ({
      page,
    }) => {
      await open(page, invoicePath(lang, invoice), 'invoice-document');
      await expect(page.getByTestId('school-link')).toHaveCount(4);
      await expect(
        page.locator('[data-testid="nav-link"][data-page="invoices"]'),
      ).toHaveAttribute('aria-current', 'page');
      const call = exchange(
        page,
        'GET',
        `/schools/${yasmin.id}/invoices/${invoice.id}`,
      );
      await expect(call).toHaveAttribute('data-status', '200');
      await expect(call.getByTestId('exchange-body')).toContainText(
        '"number": 1',
      );
    });
  });
}
