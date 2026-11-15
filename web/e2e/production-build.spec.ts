import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DEV_URL, WEB_URL } from './support/stack';

const web = path.resolve(import.meta.dirname, '..');
const build = path.join(web, '.next');
const signIn = path.join(web, 'app/[lang]/dev/sign-in');

// Text that appears only in the demo sign-in's own files.
const MARKERS = ['Demo sign-in', 'signInAsSeedUser'];

// The production output. The development server writes to .next/dev, and
// .next/cache is the build cache, which is never served.
function builtFiles(directory = build): string[] {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (directory === build && (name === 'dev' || name === 'cache')) return [];
    return statSync(full).isDirectory() ? builtFiles(full) : [full];
  });
}

test.describe('the demo sign-in', () => {
  test.setTimeout(180_000);

  test('is served in development and is not a route of the production build', async ({
    request,
  }) => {
    for (const lang of ['ar', 'en']) {
      const dev = await request.get(`${DEV_URL}/${lang}/dev/sign-in`);
      expect(dev.status()).toBe(200);
      expect(await dev.text()).toContain(MARKERS[0]);

      const production = await request.get(`${WEB_URL}/${lang}/dev/sign-in`);
      expect(production.status()).toBe(404);
      expect(await production.text()).not.toContain(MARKERS[0]);
    }
  });

  test('leaves no trace in the production build', () => {
    // The markers are really in the source, so the search below can find them.
    const sources = readdirSync(signIn).map((name) =>
      readFileSync(path.join(signIn, name), 'utf8'),
    );
    for (const marker of MARKERS) {
      expect(sources.some((source) => source.includes(marker))).toBe(true);
    }
    expect(readdirSync(signIn).every((name) => /\.dev\.tsx?$/.test(name))).toBe(
      true,
    );

    const files = builtFiles();
    expect(files.length).toBeGreaterThan(20);
    const traces = files.filter((file) => {
      if (/sign-in/.test(path.relative(build, file))) return true;
      const content = readFileSync(file, 'latin1');
      return MARKERS.some((marker) => content.includes(marker));
    });
    expect(traces.map((file) => path.relative(build, file))).toEqual([]);
  });

  test('is the only page the production build lacks', async ({ request }) => {
    const production = await request.get(`${WEB_URL}/ar`);
    expect(production.status()).toBe(200);
    const dev = await request.get(`${DEV_URL}/ar`);
    expect(dev.status()).toBe(200);
  });
});

test.describe('the production build', () => {
  test('refers to no other host for a font or a stylesheet', () => {
    const assets = builtFiles().filter((file) => /\.(css|html)$/.test(file));
    expect(assets.some((file) => file.endsWith('.css'))).toBe(true);
    const remote = assets.flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /(?:url\(\s*['"]?|@import\s+['"]|<link[^>]+href=["'])(https?:)?\/\/[^'")\s>]+/g,
        ),
      ].map((match) => `${path.relative(build, file)}: ${match[0]}`),
    );
    expect(remote).toEqual([]);
  });

  test('carries the font files itself', () => {
    const fonts = builtFiles().filter((file) => file.endsWith('.woff2'));
    expect(fonts.some((file) => /noto-sans-arabic/.test(file))).toBe(true);
    expect(fonts.some((file) => /noto-sans-latin/.test(file))).toBe(true);
  });
});
