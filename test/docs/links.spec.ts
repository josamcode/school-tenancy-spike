import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const decisionsDir = path.join(repo, 'docs/decisions');

const decisions = () =>
  readdirSync(decisionsDir)
    .filter((name) => name.endsWith('.md'))
    .sort();

// Every document a reader is sent to.
const documents = () => [
  'README.md',
  'docs/data-model.md',
  ...decisions().map((name) => `docs/decisions/${name}`),
];

const read = (file: string) => readFileSync(path.join(repo, file), 'utf8');

// Fenced blocks hold output and diagrams, not references.
const prose = (text: string) => text.replace(/^```[\s\S]*?^```$/gm, '');

describe('the documents', () => {
  it('are the README, the data model and at least ten decision records', () => {
    expect(existsSync(path.join(repo, 'README.md'))).toBe(true);
    expect(existsSync(path.join(repo, 'docs/data-model.md'))).toBe(true);
    expect(decisions().length).toBeGreaterThanOrEqual(10);
  });

  it('link only to files that exist', () => {
    const broken: string[] = [];
    let links = 0;
    for (const document of documents()) {
      for (const [, target] of prose(read(document)).matchAll(
        /\[[^\]]*\]\(([^)\s]+)\)/g,
      )) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        links += 1;
        const file = path.resolve(
          repo,
          path.dirname(document),
          decodeURI(target.split('#')[0]),
        );
        if (!existsSync(file)) broken.push(`${document}: ${target}`);
      }
    }
    expect(links).toBeGreaterThan(20);
    expect(broken).toEqual([]);
  });

  // A claim is backed by a file. A path written in a document must be real.
  it('name only files and directories that exist', () => {
    const missing: string[] = [];
    let paths = 0;
    for (const document of documents()) {
      for (const [, named] of prose(read(document)).matchAll(
        /`((?:src|test|db|web|prove|docs|dev|\.github)\/[^`\s]*)`/g,
      )) {
        if (named.includes('*') || named.includes('<')) continue;
        paths += 1;
        const file = path.join(repo, named.replace(/:\d+$/, ''));
        const found =
          existsSync(file) &&
          (named.endsWith('/') ? statSync(file).isDirectory() : true);
        if (!found) missing.push(`${document}: ${named}`);
      }
    }
    expect(paths).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });
});

describe('the decision records', () => {
  const SECTIONS = [
    'Context',
    'Decision',
    'Alternatives considered',
    'Consequences',
    'Known limits',
    'Evidence',
  ];

  it('are numbered from 0001 with no gap', () => {
    expect(decisions().map((name) => name.slice(0, 5))).toEqual(
      decisions().map((_, index) => `${String(index + 1).padStart(4, '0')}-`),
    );
  });

  it('each have a title and the same six sections, in the same order', () => {
    for (const name of decisions()) {
      const text = read(`docs/decisions/${name}`);
      expect(text, name).toMatch(/^# \d+\. \S/);
      expect(
        [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
        name,
      ).toEqual(SECTIONS);
    }
  });

  it('each point to at least one test or source file as evidence', () => {
    for (const name of decisions()) {
      const evidence = read(`docs/decisions/${name}`).split('## Evidence')[1];
      expect(evidence, name).toMatch(/`(?:test|src|db|web|prove)\/[^`]+`/);
    }
  });

  it('are all linked from the README', () => {
    const readme = read('README.md');
    for (const name of decisions()) {
      expect(readme, name).toContain(`docs/decisions/${name}`);
    }
  });
});

describe('the README', () => {
  it('has its sections in this order', () => {
    expect(
      [...read('README.md').matchAll(/^## (.+)$/gm)].map((m) => m[1]),
    ).toEqual([
      'What it proves',
      'Requirements',
      'Setup',
      'Run it',
      'Demo walkthrough',
      'Proof map',
      'Prove it yourself',
      'Architecture in brief',
      'Known limits',
      'Not proven yet',
      'Tests',
    ]);
  });

  it('links to the data model', () => {
    expect(read('README.md')).toContain('docs/data-model.md');
  });
});
