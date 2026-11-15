import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { physicalCss, physicalInlineStyle } from './support/physical-css';

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
    'a { margin-left: 4px; }',
    'a { padding-right: 1rem }',
    'a { border-left: 1px solid; }',
    'a { border-top-right-radius: 4px; }',
    'a { left: 0; }',
    'a { position: absolute; right: 8px; }',
    'a { text-align: left; }',
    'a { text-align: RIGHT; }',
    'a { float: right; }',
    'a { clear: left; }',
    'a { background-position: left top; }',
    'a { transform-origin: right; }',
    'a { margin: 0 8px 0 16px; }',
    'a { padding: 1px 2px 3px 4px !important; }',
    'a { inset: 0 auto 0 0; }',
    'a { border-width: 0 1px 0 0; }',
    '@page { margin: 10mm 20mm 10mm 15mm; }',
  ])('rejects %s', (css) => {
    expect(physicalCss(css)).not.toEqual([]);
  });

  it.each([
    'a { margin-inline-start: 4px; padding-inline-end: 1rem; }',
    'a { border-inline-start: 1px solid; border-start-end-radius: 4px; }',
    'a { inset-inline-start: 0; text-align: start; float: inline-end; }',
    'a { margin: 0 8px; padding: 1px 2px 3px; }',
    'a { margin: 0 8px 0 8px; }',
    'a { padding: 0 calc(1rem + 2px) 0 calc(1rem + 2px); }',
    '@page { size: A4; margin: 18mm 16mm; }',
    '/* text-align: left would be wrong here */ a { text-align: end; }',
    'a { copyright: none; }',
  ])('accepts %s', (css) => {
    expect(physicalCss(css)).toEqual([]);
  });

  it('rejects a physical side in a style prop', () => {
    expect(
      physicalInlineStyle('<p style={{ marginLeft: 4 }}>x</p>'),
    ).not.toEqual([]);
    expect(
      physicalInlineStyle("<p style={{ textAlign: 'right' }}>x</p>"),
    ).not.toEqual([]);
    expect(
      physicalInlineStyle('<p style={{ marginInlineStart: 4 }}>x</p>'),
    ).toEqual([]);
  });
});

describe('the styles of the app', () => {
  const stylesheets = files(root, '.css');
  const components = files(root, '.tsx');

  it('include the invoice document and the app shell, so the checks below are not empty', () => {
    const names = stylesheets.map((file) => path.basename(file));
    expect(names).toContain('invoice-document.css');
    expect(names).toContain('globals.css');
    for (const file of stylesheets) {
      expect(readFileSync(file, 'utf8').trim()).not.toBe('');
    }
  });

  it('use no physical property or value in any stylesheet', () => {
    const problems = stylesheets.flatMap((file) =>
      physicalCss(readFileSync(file, 'utf8')).map(
        (problem) => `${path.relative(root, file)}: ${problem}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it('use no physical side in any style prop', () => {
    const problems = components.flatMap((file) =>
      physicalInlineStyle(readFileSync(file, 'utf8')).map(
        (problem) => `${path.relative(root, file)}: ${problem}`,
      ),
    );
    expect(problems).toEqual([]);
  });

  it('do not come from a utility framework, whose class names would hide a side', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });
    expect(
      names.filter((name) => /tailwind|bootstrap|unocss/.test(name)),
    ).toEqual([]);
  });
});
