import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { Lang } from './session';

export const LANGS: Lang[] = ['ar', 'en'];

const catalog = (lang: Lang) =>
  JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, `../../messages/${lang}.json`),
      'utf8',
    ),
  ) as Record<string, string>;
const catalogs = { ar: catalog('ar'), en: catalog('en') };

// The interface catalog, read by key so a test can ask for a word that does
// not exist yet.
export const words = (lang: Lang) => catalogs[lang];

export type SchoolPage =
  'students' | 'invoices' | 'ledger' | 'admissions' | undefined;

// A school's own page is the one that shows what the user may do there.
export const schoolPath = (
  lang: Lang,
  school: { id: string },
  page?: SchoolPage,
) => `/${lang}/schools/${school.id}${page ? `/${page}` : ''}`;

export const nameOf = (
  school: { name: string; nameI18n: { ar: string; en: string } },
  lang: Lang,
) => school.nameI18n[lang];

// One call the page made to the API, as the server response panel shows it.
export const exchange = (page: Page, method: string, path: string): Locator =>
  page.locator(
    `[data-testid="exchange"][data-method="${method}"][data-path="${path}"]`,
  );

export const areaRow = (page: Page, area: string): Locator =>
  page.locator(`[data-testid="area-row"][data-area="${area}"]`);

export const PALETTE_RGB = [
  'rgb(26, 29, 33)',
  'rgb(251, 250, 247)',
  'rgb(207, 203, 194)',
  'rgb(29, 79, 145)',
  'rgb(30, 107, 58)',
  'rgb(163, 42, 30)',
];
export const PAPER = PALETTE_RGB[1];
export const LAPIS = PALETTE_RGB[3];

export interface StyleSweep {
  colors: string[];
  decoration: string[];
  monospaceOutsideRaw: string[];
  otherFonts: string[];
  moving: string[];
}

// Reads the computed style of every element on the page and reports what the
// design rules forbid, with the element it was found on.
export function sweepStyles(page: Page): Promise<StyleSweep> {
  return page.evaluate(() => {
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()}${
        element.getAttribute('data-testid')
          ? `[${element.getAttribute('data-testid')}]`
          : element.className
            ? `.${String(element.className).split(' ')[0]}`
            : ''
      }`;
    const colors = new Set<string>();
    const decoration: string[] = [];
    const monospaceOutsideRaw: string[] = [];
    const otherFonts: string[] = [];
    const moving: string[] = [];

    for (const element of document.body.querySelectorAll('*')) {
      if (
        ['SCRIPT', 'STYLE', 'TEMPLATE', 'NEXT-ROUTE-ANNOUNCER'].includes(
          element.tagName,
        )
      ) {
        continue;
      }
      const style = getComputedStyle(element);
      for (const value of [
        style.color,
        style.backgroundColor,
        style.borderBlockStartColor,
        style.borderBlockEndColor,
        style.borderInlineStartColor,
        style.borderInlineEndColor,
      ]) {
        colors.add(value);
      }
      const found = [
        style.backgroundImage !== 'none' &&
          `background-image ${style.backgroundImage}`,
        style.boxShadow !== 'none' && `box-shadow ${style.boxShadow}`,
        style.textShadow !== 'none' && `text-shadow ${style.textShadow}`,
        style.filter !== 'none' && `filter ${style.filter}`,
        style.backdropFilter !== 'none' &&
          `backdrop-filter ${style.backdropFilter}`,
        style.borderStartStartRadius !== '0px' &&
          `radius ${style.borderStartStartRadius}`,
        style.textTransform !== 'none' &&
          `text-transform ${style.textTransform}`,
        style.letterSpacing !== 'normal' &&
          `letter-spacing ${style.letterSpacing}`,
      ].filter(Boolean);
      for (const problem of found)
        decoration.push(`${name(element)}: ${problem}`);

      const ownText = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (
        ownText ||
        ['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(element.tagName)
      ) {
        const family = style.fontFamily;
        const inRaw = element.closest('[data-testid="exchange-raw"]') !== null;
        if (/mono|consolas|menlo|courier/i.test(family)) {
          if (!inRaw) monospaceOutsideRaw.push(`${name(element)}: ${family}`);
        } else if (inRaw || !/^"?Noto Sans/.test(family)) {
          otherFonts.push(`${name(element)}: ${family}`);
        }
      }

      if (style.animationName !== 'none') {
        moving.push(`${name(element)}: animation ${style.animationName}`);
      }
      if (
        style.transitionDuration.split(',').some((part) => parseFloat(part) > 0)
      ) {
        moving.push(`${name(element)}: transition ${style.transitionDuration}`);
      }
    }
    return {
      colors: [...colors].filter((color) => color !== 'rgba(0, 0, 0, 0)'),
      decoration,
      monospaceOutsideRaw,
      otherFonts,
      moving,
    };
  });
}

// True when nothing makes the page wider than the window.
export const fitsItsWidth = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth <=
      document.documentElement.clientWidth,
  );
