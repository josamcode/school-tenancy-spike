import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '../messages/ar.json';
import en from '../messages/en.json';
import {
  colorTokens,
  contrast,
  copyProblems,
  designProblems,
  englishCaseProblems,
  MONOSPACE_STYLESHEET,
  PALETTE,
} from './support/design-rules';

const root = path.resolve(import.meta.dirname, '..');
const skipped = new Set([
  'node_modules',
  '.next',
  'test-results',
  'e2e',
  'test',
]);

function files(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (skipped.has(entry.name)) return [];
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(full, extension);
    return entry.name.endsWith(extension) ? [full] : [];
  });
}

describe('the guard itself', () => {
  it.each([
    'a { color: #333; }',
    'a { color: #1a1d21; }',
    ':root { --color-ink: #222222; }',
    'a { background: rgb(0, 0, 0); }',
    'a { color: hsl(210 50% 40%); }',
    'a { color: white; }',
    'a { border: 1px solid lightgray; }',
    'a { background: linear-gradient(#1a1d21, #fbfaf7); }',
    'a { background-image: radial-gradient(circle, var(--color-ink), transparent); }',
    'a { box-shadow: 0 1px 2px var(--color-line); }',
    'a { text-shadow: 0 0 4px var(--color-lapis); }',
    'a { filter: blur(2px); }',
    'a { backdrop-filter: blur(8px); }',
    'a { border-radius: 8px; }',
    'a { border-start-start-radius: 4px; }',
    'a { text-transform: uppercase; }',
    'a { letter-spacing: 0.08em; }',
    'a { font-variant: small-caps; }',
    'a { animation: fade 1s; }',
    '@keyframes fade { from { opacity: 0; } }',
    'a { transition: opacity 150ms; }',
    '@media (min-width: 900px) { a { transition: color 1s; } }',
    'a { font-family: Georgia, serif; }',
    'a { font-family: ui-monospace, monospace; }',
  ])('rejects %s', (css) => {
    expect(designProblems(css, 'globals.css')).not.toEqual([]);
  });

  it.each([
    ':root { --color-ink: #1A1D21; --color-paper: #fbfaf7; }',
    'a { color: var(--color-ink); background: var(--color-paper); }',
    'a { border: 1px solid var(--color-line); border-radius: 0; }',
    'a { background: transparent; color: inherit; outline-color: currentColor; }',
    'a { box-shadow: none; text-transform: none; letter-spacing: normal; }',
    '@media (prefers-reduced-motion: no-preference) { a { transition: background-color 150ms; } }',
    "a { font-family: 'Noto Sans', 'Noto Sans Arabic', sans-serif; }",
    '/* color: #333 was the old one */ a { color: var(--color-ink); }',
    'a { margin-block: 8px; padding-inline: 12px; }',
  ])('accepts %s', (css) => {
    expect(designProblems(css, 'globals.css')).toEqual([]);
  });

  it('accepts a monospace font in the stylesheet of the raw server response, and nowhere else', () => {
    const css = 'pre { font-family: ui-monospace, Consolas, monospace; }';
    expect(designProblems(css, MONOSPACE_STYLESHEET)).toEqual([]);
    expect(designProblems(css, 'invoice-document.css')).not.toEqual([]);
  });

  it.each(['Saved \u{1F389}', 'Open →', 'Next »', 'Paid · Posted', 'Done ✓'])(
    'rejects the label %s',
    (text) => {
      expect(copyProblems(text)).not.toEqual([]);
    },
  );

  it.each(['Server response', 'رد الخادم', 'Download as PDF', '500.00 AED'])(
    'accepts the label %s',
    (text) => {
      expect(copyProblems(text)).toEqual([]);
      expect(englishCaseProblems(text)).toEqual([]);
    },
  );

  it.each(['SERVER RESPONSE', 'Your School Permissions', 'READ only'])(
    'rejects the English label %s',
    (text) => {
      expect(englishCaseProblems(text)).not.toEqual([]);
    },
  );

  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('the design of the app', () => {
  const stylesheets = files(root, '.css');
  const components = files(root, '.tsx');
  const names = stylesheets.map((file) => path.basename(file));

  it('has the app shell, the server response and the invoice, so the checks below are not empty', () => {
    expect(names).toContain('globals.css');
    expect(names).toContain(MONOSPACE_STYLESHEET);
    expect(names).toContain('invoice-document.css');
  });

  it('defines the six colors of the palette as tokens, and no other color', () => {
    const globals = readFileSync(path.join(root, 'app/globals.css'), 'utf8');
    expect(colorTokens(globals)).toEqual(PALETTE);
  });

  it('breaks no design rule in any stylesheet', () => {
    const problems = stylesheets.flatMap((file) =>
      designProblems(readFileSync(file, 'utf8'), path.basename(file)).map(
        (problem) => `${path.relative(root, file)}: ${problem}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it('really uses a monospace font for the raw server response', () => {
    const file = stylesheets.find(
      (candidate) => path.basename(candidate) === MONOSPACE_STYLESHEET,
    );
    expect(file).toBeDefined();
    expect(readFileSync(file!, 'utf8')).toMatch(/font-family:[^;]*monospace/);
  });

  it('sets no color in a style prop, where the rules above cannot see it', () => {
    const problems = components.flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/style=\{\{([\s\S]*?)\}\}/g)]
        .filter((match) =>
          /color|background|border|shadow|font/i.test(match[1]),
        )
        .map((match) => `${path.relative(root, file)}: ${match[0]}`),
    );
    expect(problems).toEqual([]);
  });

  it.each([
    ['ink on paper', PALETTE.ink, PALETTE.paper],
    ['paper on ink, the raw response', PALETTE.paper, PALETTE.ink],
    ['links on paper', PALETTE.lapis, PALETTE.paper],
    ['paper on a button', PALETTE.paper, PALETTE.lapis],
    ['allowed on paper', PALETTE.allowed, PALETTE.paper],
    ['refused on paper', PALETTE.refused, PALETTE.paper],
  ])('gives %s a contrast of at least 4.5 to 1', (_name, text, surface) => {
    expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps decoration out of the words, in both catalogs and in every component', () => {
    const texts = [
      ...Object.entries(ar).map(([key, value]) => [`ar ${key}`, String(value)]),
      ...Object.entries(en).map(([key, value]) => [`en ${key}`, String(value)]),
      ...components.map((file) => [
        path.relative(root, file),
        readFileSync(file, 'utf8'),
      ]),
    ];
    const problems = texts.flatMap(([name, text]) =>
      copyProblems(text).map((problem) => `${name}: ${problem}`),
    );
    expect(problems).toEqual([]);
  });

  it('writes the English catalog in sentence case', () => {
    const problems = Object.entries(en).flatMap(([key, value]) =>
      (Array.isArray(value) ? [] : [value]).flatMap((text) =>
        englishCaseProblems(text).map((problem) => `${key}: ${problem}`),
      ),
    );
    expect(problems).toEqual([]);
  });
});
