import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const patchDir = path.join(repo, 'prove/sabotages');

interface Entry {
  id: string;
  removes: string;
  patch: string;
  targets: string[];
  lane: 'api' | 'web';
  files: string[];
  mustFail: { test: string; because: string }[];
}

// The protections that `pnpm prove` breaks on purpose. Removing one from the
// manifest must be a visible change here.
const SABOTAGES = [
  'isolation.force-rls',
  'isolation.loose-policy',
  'isolation.no-membership-check',
  'isolation.single-column-fk',
  'reach.table-without-rls',
  'reach.other-schema',
  'auth.guard-not-global',
  'modules.no-module-check',
  'modules.undeclared-route',
  'permissions.role-any-school',
  'permissions.grant-any-school',
  'ledger.no-balance-check',
  'ledger.not-append-only',
  'ledger.locked-period-open',
  'ledger.period-no-row-lock',
  'ledger.revalue-all-dates',
  'ledger.no-position-lock',
  'ledger.invoice-no-share-lock',
  'events.event-own-transaction',
  'events.accept-no-row-lock',
  'events.no-processed-check',
  'events.route-without-module-lock',
  'events.no-delivery-resend',
  'events.no-dead-letter',
  'events.unsigned-timestamp',
  'invoices.no-numbering-lock',
  'invoices.runtime-issued-at',
  'calendar.override-ignored',
  'web.no-bundled-fonts',
  'web.sign-in-in-production',
];

const patchText = (entry: Entry) =>
  readFileSync(path.join(patchDir, entry.patch), 'utf8');

// The files a unified diff changes, from its "+++ b/..." and "--- a/..." lines.
const touched = (patch: string) => [
  ...new Set(
    [...patch.matchAll(/^(?:\+\+\+ b|--- a)\/(.+)$/gm)].map((m) => m[1]),
  ),
];

const changedLines = (patch: string) =>
  patch.split('\n').filter((line) => /^[+-](?![+-]{2} )/.test(line)).length;

describe('the sabotages of pnpm prove', () => {
  let entries: Entry[];

  beforeAll(() => {
    entries = JSON.parse(
      readFileSync(path.join(repo, 'prove/sabotages.json'), 'utf8'),
    ) as Entry[];
  });

  it('are the thirty protections, each once', () => {
    expect(entries.map((entry) => entry.id).sort()).toEqual(
      [...SABOTAGES].sort(),
    );
  });

  it('have one patch file each, named after the sabotage, and there is no other patch', () => {
    for (const entry of entries) {
      expect(entry.patch).toBe(`${entry.id}.patch`);
    }
    expect(readdirSync(patchDir).sort()).toEqual(
      entries.map((entry) => entry.patch).sort(),
    );
  });

  it('say what they remove, and name the tests that must fail and why', () => {
    for (const entry of entries) {
      expect(entry.removes.trim(), entry.id).not.toBe('');
      expect(entry.mustFail.length, entry.id).toBeGreaterThan(0);
      for (const { test, because } of entry.mustFail) {
        expect(test.trim(), entry.id).not.toBe('');
        expect(because.trim(), `${entry.id}: ${test}`).not.toBe('');
      }
    }
  });

  it('touch only the files they declare, and those files exist', () => {
    for (const entry of entries) {
      expect(touched(patchText(entry)).sort(), entry.id).toEqual(
        [...entry.targets].sort(),
      );
      for (const target of entry.targets) {
        expect(existsSync(path.join(repo, target)), target).toBe(true);
      }
    }
  });

  it('never touch a test, a test support file or the seed', () => {
    const offLimits = /(^|\/)(test|e2e)\/|\.spec\.ts$|^db\/seed\.ts$/;
    for (const entry of entries) {
      for (const target of entry.targets) {
        expect(offLimits.test(target), `${entry.id}: ${target}`).toBe(false);
      }
    }
  });

  it('are small: no patch changes more than 20 lines', () => {
    for (const entry of entries) {
      const lines = changedLines(patchText(entry));
      expect(lines, entry.id).toBeGreaterThan(0);
      expect(lines, entry.id).toBeLessThanOrEqual(20);
    }
  });

  it('name test files that exist and that their lane runs', () => {
    for (const entry of entries) {
      expect(entry.files.length, entry.id).toBeGreaterThan(0);
      for (const file of entry.files) {
        expect(existsSync(path.join(repo, file)), file).toBe(true);
        expect(file, entry.id).toMatch(
          entry.lane === 'web'
            ? /^web\/e2e\/.+\.spec\.ts$/
            : /^(test|src)\/.+\.(e2e-)?spec\.ts$/,
        );
      }
    }
  });

  // Drift is caught here, on the change that causes it, long before anyone
  // starts the full run. The check reads the working tree and writes nothing.
  it('still apply to the code as it is', () => {
    for (const entry of entries) {
      let failure = '';
      try {
        execFileSync(
          'git',
          ['apply', '--check', path.join(patchDir, entry.patch)],
          { cwd: repo, stdio: 'pipe' },
        );
      } catch (error) {
        failure = (error as { stderr: Buffer }).stderr.toString();
      }
      expect(failure, entry.id).toBe('');
    }
  });

  it('are each a row of the proof map in the README, which names no other', () => {
    const readme = readFileSync(path.join(repo, 'README.md'), 'utf8');
    const groups = [...new Set(SABOTAGES.map((id) => id.split('.')[0]))];
    const named = [
      ...new Set(
        [
          ...readme.matchAll(
            new RegExp(`\`((?:${groups.join('|')})\\.[a-z-]+)\``, 'g'),
          ),
        ].map((m) => m[1]),
      ),
    ];
    expect(named.sort()).toEqual([...SABOTAGES].sort());
  });
});
