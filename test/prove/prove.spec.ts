import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { playwrightResults, prove, vitestResults } from '../../prove/prove.js';
import type { ProveResult, Sabotage } from '../../prove/prove.js';

const repo = path.resolve(import.meta.dirname, '../..');
const fixture = path.join(import.meta.dirname, 'fixture');
const patches = path.join(fixture, 'sabotages');

const REFUSED = 'a discount is refused when it exceeds the amount';
const TAKEN_OFF = 'a discount is taken off the amount';
const NOT_THROWN = 'to throw an error';

// A sabotage of the fixture. The defaults are the one that is really caught.
const sabotage = (id: string, change: Partial<Sabotage> = {}): Sabotage => ({
  id,
  removes: `what ${id} removes`,
  patch: 'no-limit.patch',
  targets: ['src/discount.ts'],
  lane: 'api',
  files: ['checks/discount.test.ts'],
  mustFail: [{ test: REFUSED, because: NOT_THROWN }],
  ...change,
});

const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

// What the runner must leave exactly as it found it.
function snapshot() {
  const hash = createHash('sha256');
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else hash.update(file).update(readFileSync(file));
    }
  };
  walk(fixture);
  return {
    head: git('rev-parse', 'HEAD'),
    status: git('status', '--porcelain'),
    stashes: git('stash', 'list'),
    fixture: hash.digest('hex'),
  };
}

// The fixture needs no install: its copies use this repository's Vitest.
const run = (sabotages: Sabotage[], log: (line: string) => void = () => {}) =>
  prove({ root: fixture, patches, sabotages, deps: repo, log });

describe('the proof runner, on a small project', () => {
  let before: ReturnType<typeof snapshot>;
  let result: ProveResult;
  const printed: string[] = [];
  const row = (id: string) => result.rows.find((r) => r.id === id)!;

  beforeAll(async () => {
    before = snapshot();
    result = await run(
      [
        sabotage('caught'),
        sabotage('breaks-nothing', { patch: 'comment-only.patch' }),
        sabotage('breaks-another-test', { patch: 'wrong-test.patch' }),
        sabotage('does-not-load', { patch: 'does-not-load.patch' }),
        sabotage('another-reason', {
          mustFail: [{ test: REFUSED, because: 'expected 403' }],
        }),
        sabotage('one-of-two', {
          mustFail: [
            { test: REFUSED, because: NOT_THROWN },
            { test: TAKEN_OFF, because: 'expected' },
          ],
        }),
        sabotage('drifted', { patch: 'drifted.patch' }),
      ],
      (line) => printed.push(line),
    );
  }, 300_000);

  it('has a row for every sabotage, in the order given', () => {
    expect(result.rows.map((r) => r.id)).toEqual([
      'caught',
      'breaks-nothing',
      'breaks-another-test',
      'does-not-load',
      'another-reason',
      'one-of-two',
      'drifted',
    ]);
  });

  it('passes a sabotage whose named test fails for the stated reason', () => {
    expect(row('caught')).toMatchObject({ passed: true, failed: [REFUSED] });
  });

  it('fails a sabotage that breaks nothing', () => {
    expect(row('breaks-nothing')).toMatchObject({ passed: false, failed: [] });
    expect(row('breaks-nothing').reason).toContain(`passed: ${REFUSED}`);
  });

  it('fails a sabotage that breaks another test than the one named', () => {
    expect(row('breaks-another-test')).toMatchObject({
      passed: false,
      failed: [],
    });
    // Only the named tests are run, so the test it did break decides nothing.
    expect(row('breaks-another-test').reason).toContain(`passed: ${REFUSED}`);
  });

  it('fails a sabotage that stops the named test from running', () => {
    expect(row('does-not-load')).toMatchObject({ passed: false, failed: [] });
    expect(row('does-not-load').reason).toContain(`did not run: ${REFUSED}`);
  });

  it('fails a sabotage whose named test fails for another reason than the stated one', () => {
    expect(row('another-reason')).toMatchObject({ passed: false, failed: [] });
    expect(row('another-reason').reason).toContain(
      `failed for another reason: ${REFUSED}`,
    );
    expect(row('another-reason').reason).toContain(NOT_THROWN);
  });

  it('fails a sabotage when only one of its two named tests fails', () => {
    expect(row('one-of-two')).toMatchObject({
      passed: false,
      failed: [REFUSED],
    });
    expect(row('one-of-two').reason).toContain(`passed: ${TAKEN_OFF}`);
  });

  it('fails a patch that no longer applies, and runs no test for it', () => {
    expect(row('drifted')).toMatchObject({
      passed: false,
      ran: false,
      failed: [],
    });
    expect(row('drifted').reason).toContain('patch does not apply');
    expect(row('drifted').reason).toContain('src/discount.ts');
  });

  it('ran the tests of every patch that applied', () => {
    expect(
      result.rows.filter((r) => r.id !== 'drifted').map((r) => r.ran),
    ).toEqual([true, true, true, true, true, true]);
  });

  it('says the whole run failed', () => {
    expect(result.ok).toBe(false);
    expect(result.baseline).toBeNull();
  });

  it('prints one row per sabotage: what was removed, the tests that failed, and the result', () => {
    const text = printed.join('\n');
    for (const { id, removes, passed } of result.rows) {
      const line = printed.find((l) => l.includes(` ${id} `));
      expect(line, id).toBeDefined();
      expect(line).toContain(removes);
      expect(line).toMatch(passed ? /^passed\b/ : /^FAILED\b/);
    }
    expect(text).toContain(`failed as required: ${REFUSED}`);
    expect(text).toContain('7 sabotages: 1 passed, 6 FAILED');
  });

  it('leaves the project, the repository and the temp directory as they were', () => {
    expect(snapshot()).toEqual(before);
    expect(result.tmp).not.toBe('');
    expect(path.resolve(result.tmp).startsWith(repo + path.sep)).toBe(false);
    expect(existsSync(result.tmp)).toBe(false);
  });
});

describe('a run in which every sabotage is caught', () => {
  it('succeeds', async () => {
    const result = await run([sabotage('caught')]);
    expect(result.rows).toMatchObject([{ id: 'caught', passed: true }]);
    expect(result.ok).toBe(true);
    expect(existsSync(result.tmp)).toBe(false);
  }, 120_000);
});

describe('a baseline that is red', () => {
  it('stops the run before any patch when a named test fails with no patch at all', async () => {
    const red = 'a check that is already red fails before any patch';
    const result = await run([
      sabotage('caught'),
      sabotage('already-red', {
        files: ['checks/red.test.ts'],
        mustFail: [{ test: red, because: 'expected 1 to be 2' }],
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.baseline).toContain(`failed: ${red}`);
    expect(existsSync(result.tmp)).toBe(false);
  }, 120_000);

  it('stops the run before any patch when a named test does not exist', async () => {
    const result = await run([
      sabotage('no-such-test', {
        mustFail: [{ test: 'a discount is rounded', because: 'expected' }],
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.baseline).toContain('did not run: a discount is rounded');
  }, 120_000);
});

describe('a manifest that is wrong', () => {
  const refused = async (change: Partial<Sabotage>, problem: string) => {
    const before = snapshot();
    const result = await run([sabotage('wrong', change)]);
    expect(result.ok).toBe(false);
    expect(result.rows).toEqual([]);
    expect(result.baseline).toContain(problem);
    // Refused before anything was copied.
    expect(result.tmp).toBe('');
    expect(snapshot()).toEqual(before);
  };

  it('is refused when a patch touches a file it does not declare', () =>
    refused(
      { targets: ['src/other.ts'] },
      'wrong: the patch touches src/discount.ts, which is not a declared target',
    ));

  it('is refused when a patch file is missing', () =>
    refused({ patch: 'missing.patch' }, 'wrong: missing.patch does not exist'));

  it('is refused when a sabotage names no test', () =>
    refused({ mustFail: [] }, 'wrong: names no test that must fail'));

  it('is refused when two sabotages share an id', async () => {
    const result = await run([sabotage('twice'), sabotage('twice')]);
    expect(result.ok).toBe(false);
    expect(result.baseline).toContain('twice: the id is used more than once');
  });

  it('is refused when the project is asked to hold its own copies', async () => {
    await expect(
      prove({
        root: fixture,
        patches,
        sabotages: [sabotage('caught')],
        deps: repo,
        tmpRoot: fixture,
        log: () => {},
      }),
    ).rejects.toThrow('must be outside the project');
    expect(readdirSync(fixture).sort()).toEqual(['checks', 'sabotages', 'src']);
  });
});

describe('reading a test report', () => {
  it('finds each Vitest test by its full name, with its status and its message', () => {
    const results = vitestResults({
      testResults: [
        {
          assertionResults: [
            {
              fullName: 'a suite keeps a rule',
              status: 'failed',
              failureMessages: ['expected 201 to be 403', 'at somewhere'],
            },
            { fullName: 'a suite does more', status: 'passed' },
            { fullName: 'a suite was filtered out', status: 'skipped' },
          ],
        },
      ],
    });
    expect(results.get('a suite keeps a rule')).toEqual({
      status: 'failed',
      message: 'expected 201 to be 403\nat somewhere',
    });
    expect(results.get('a suite does more')).toEqual({
      status: 'passed',
      message: '',
    });
    // A test the filter left out did not run.
    expect(results.has('a suite was filtered out')).toBe(false);
  });

  it('finds each Playwright test by its describe titles and its own title', () => {
    const results = playwrightResults({
      suites: [
        {
          title: 'pdf.spec.ts',
          specs: [],
          suites: [
            {
              title: 'the invoice PDF',
              specs: [
                {
                  title: 'embeds every font',
                  tests: [
                    {
                      results: [
                        {
                          status: 'failed',
                          errors: [{ message: 'Expected: "NotoSans"' }],
                        },
                      ],
                    },
                  ],
                },
                {
                  title: 'is one A4 page',
                  tests: [{ results: [{ status: 'passed', errors: [] }] }],
                },
                {
                  title: 'was not reached',
                  tests: [{ results: [{ status: 'skipped', errors: [] }] }],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(results.get('the invoice PDF embeds every font')).toEqual({
      status: 'failed',
      message: 'Expected: "NotoSans"',
    });
    expect(results.get('the invoice PDF is one A4 page')).toEqual({
      status: 'passed',
      message: '',
    });
    expect(results.has('the invoice PDF was not reached')).toBe(false);
  });
});

describe('pnpm prove', () => {
  it('runs the runner on this repository', () => {
    const { scripts } = JSON.parse(
      readFileSync(path.join(repo, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(scripts.prove).toBe('node prove/prove.ts');
  });

  it('is in CI only as a workflow that is started by hand, with read-only access', () => {
    const workflow = readFileSync(
      path.join(repo, '.github/workflows/prove.yml'),
      'utf8',
    );
    const triggers = /^on:\n((?: +.*\n)+)/m.exec(workflow)?.[1] ?? '';
    expect(triggers.trim()).toBe('workflow_dispatch:');
    expect(workflow).toMatch(/^permissions:\n +contents: read\n/m);
    expect(workflow).toContain('pnpm prove');
  });
});
