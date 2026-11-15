import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// One protection, broken on purpose by one patch.
export interface Sabotage {
  id: string;
  removes: string;
  patch: string;
  // The only files the patch may change.
  targets: string[];
  // api: Vitest against its own database. web: both builds, then Playwright.
  lane: 'api' | 'web';
  files: string[];
  // Each test by its full name, and a text its failure message must contain.
  mustFail: { test: string; because: string }[];
}

export interface Row {
  id: string;
  removes: string;
  passed: boolean;
  // False when the patch did not apply, so no test was run.
  ran: boolean;
  // The named tests that failed for the stated reason.
  failed: string[];
  reason: string;
}

export interface ProveResult {
  ok: boolean;
  // Why the run stopped before any patch, or null when it did not.
  baseline: string | null;
  rows: Row[];
  tmp: string;
}

export interface ProveOptions {
  root: string;
  patches: string;
  sabotages: Sabotage[];
  // A directory that already holds node_modules. Without it the run makes
  // one install of its own, which the web lane needs.
  deps?: string;
  tmpRoot?: string;
  jobs?: number;
  log?: (line: string) => void;
  progress?: (line: string) => void;
}

type Results = Map<string, { status: 'passed' | 'failed'; message: string }>;

const RUN_TIMEOUT_MS = 20 * 60_000;
const LINKS = ['node_modules', 'web/node_modules'];
const ESCAPE = String.fromCharCode(27);

const clean = (text: string) =>
  text.replaceAll(new RegExp(`${ESCAPE}\\[[0-9;]*m`, 'g'), '');
const firstLine = (text: string) =>
  (text.split('\n').find((line) => line.trim() !== '') ?? '').trim();
const pattern = (names: string[]) =>
  names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');

interface VitestReport {
  testResults?: {
    assertionResults?: {
      fullName: string;
      status: string;
      failureMessages?: string[];
    }[];
  }[];
}

// A test that was filtered out or never reached is left out: it did not run.
export function vitestResults(report: VitestReport): Results {
  const results: Results = new Map();
  for (const file of report.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      if (test.status !== 'passed' && test.status !== 'failed') continue;
      results.set(test.fullName, {
        status: test.status,
        message: clean((test.failureMessages ?? []).join('\n')),
      });
    }
  }
  return results;
}

interface PlaywrightSuite {
  title: string;
  specs?: {
    title: string;
    tests?: {
      results?: { status: string; errors?: { message?: string }[] }[];
    }[];
  }[];
  suites?: PlaywrightSuite[];
}

// The outermost suite is the file. A test's full name is its describe titles
// and its own title, as in a Vitest report.
export function playwrightResults(report: {
  suites?: PlaywrightSuite[];
}): Results {
  const results: Results = new Map();
  const walk = (suite: PlaywrightSuite, titles: string[]) => {
    for (const spec of suite.specs ?? []) {
      const last = spec.tests?.at(-1)?.results?.at(-1);
      if (!last || last.status === 'skipped') continue;
      results.set([...titles, spec.title].join(' '), {
        status: last.status === 'passed' ? 'passed' : 'failed',
        message: clean(
          (last.errors ?? []).map((error) => error.message ?? '').join('\n'),
        ),
      });
    }
    for (const child of suite.suites ?? []) {
      walk(child, [...titles, child.title]);
    }
  };
  for (const file of report.suites ?? []) walk(file, []);
  return results;
}

interface Finished {
  code: number | null;
  output: string;
}

// No shell, so a test name reaches the runner exactly as it is written.
function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {},
): Promise<Finished> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      output += '\nStopped: the run took too long';
      if (child.pid === undefined) return;
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
    }, RUN_TIMEOUT_MS);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const tail = (output: string) =>
  clean(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .map((line) => line.slice(0, 200))
    .join(' / ');

// Under `pnpm prove` this is the pnpm that started the run. Started with
// node alone, it is whichever pnpm the shell finds.
function pnpm(args: string[], cwd: string): Promise<Finished> {
  const own = process.env.npm_execpath;
  if (own && /pnpm.*\.[cm]?js$/.test(own)) {
    return run(process.execPath, [own, ...args], cwd);
  }
  const line = ['pnpm', ...args.map((arg) => `"${arg}"`)].join(' ');
  return new Promise((resolve) => {
    const child = spawn(line, { cwd, shell: true });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', (error) =>
      resolve({ code: null, output: error.message }),
    );
    child.on('close', (code) => resolve({ code, output }));
  });
}

// What is on disk: tracked files and new files that are not ignored.
function sourceFiles(root: string): string[] {
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (listed.status !== 0) {
    throw new Error(`Could not list the files of ${root}: ${listed.stderr}`);
  }
  return listed.stdout
    .split('\0')
    .filter((file) => file !== '' && existsSync(path.join(root, file)));
}

function copyFiles(root: string, files: string[], destination: string) {
  for (const file of files) {
    const target = path.join(destination, file);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, file), target);
  }
}

function link(deps: string, copy: string) {
  for (const name of LINKS) {
    const target = path.join(deps, name);
    const parent = path.dirname(path.join(copy, name));
    if (existsSync(target) && existsSync(parent)) {
      symlinkSync(target, path.join(copy, name), 'junction');
    }
  }
}

// The links go first, by themselves, so that removing a copy can never reach
// the dependencies they point to.
function discard(copy: string) {
  for (const name of LINKS) {
    const entry = lstatSync(path.join(copy, name), { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) rmSync(path.join(copy, name));
  }
  rmSync(copy, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}

// Outside a repository, so git patches these files and looks at nothing else.
function applyPatch(patch: string, copy: string, ceiling: string): string {
  const applied = spawnSync('git', ['apply', patch], {
    cwd: copy,
    encoding: 'utf8',
    env: { ...process.env, GIT_CEILING_DIRECTORIES: ceiling },
  });
  if (applied.status === 0) return '';
  const lines = (applied.stderr || applied.stdout || 'git apply failed')
    .split('\n')
    .map((line) => line.replace(/^error: /, '').trim())
    .filter(Boolean);
  return `patch does not apply: ${lines.join('; ')}`;
}

const touchedBy = (patch: string) => [
  ...new Set(
    [...patch.matchAll(/^(?:\+\+\+ b|--- a)\/(.+)$/gm)].map((m) => m[1]),
  ),
];

function manifestProblems(options: ProveOptions): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { id, patch, targets, files, mustFail } of options.sabotages) {
    if (seen.has(id)) problems.push(`${id}: the id is used more than once`);
    seen.add(id);
    if (mustFail.length === 0) {
      problems.push(`${id}: names no test that must fail`);
    }
    if (files.length === 0) problems.push(`${id}: names no test file`);
    const file = path.join(options.patches, patch);
    if (!existsSync(file)) {
      problems.push(`${id}: ${patch} does not exist`);
      continue;
    }
    for (const touched of touchedBy(readFileSync(file, 'utf8'))) {
      if (!targets.includes(touched)) {
        problems.push(
          `${id}: the patch touches ${touched}, which is not a declared target`,
        );
      }
    }
  }
  if (options.deps && options.sabotages.some((s) => s.lane === 'web')) {
    problems.push('The web lane needs the install the run makes for itself');
  }
  return problems;
}

interface Lane {
  // Runs the named tests of these files in a prepared directory.
  test(
    directory: string,
    files: string[],
    names: string[],
    report: string,
  ): Promise<{ results: Results; output: string }>;
}

const readJson = (file: string) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

function lanes(deps: string): Record<Sabotage['lane'], Lane> {
  const node = process.execPath;
  return {
    api: {
      async test(directory, files, names, report) {
        const { output } = await run(
          node,
          [
            path.join(deps, 'node_modules/vitest/vitest.mjs'),
            'run',
            ...files,
            '-t',
            `^(?:${pattern(names)})$`,
            '--reporter=json',
            `--outputFile=${report}`,
          ],
          directory,
        );
        return { results: vitestResults(readJson(report)), output };
      },
    },
    web: {
      async test(directory, files, names, report) {
        const web = path.join(directory, 'web');
        const steps: [string, string[], string][] = [
          ['node_modules/@nestjs/cli/bin/nest.js', ['build'], directory],
          ['node_modules/next/dist/bin/next', ['build'], web],
          [
            'node_modules/@playwright/test/cli.js',
            [
              'test',
              ...files.map((file) => file.replace(/^web\//, '')),
              '-g',
              `(?:${pattern(names)})$`,
              '--reporter=json',
            ],
            web,
          ],
        ];
        let output = '';
        for (const [script, args, cwd] of steps) {
          const step = await run(node, [path.join(cwd, script), ...args], cwd, {
            PLAYWRIGHT_JSON_OUTPUT_FILE: report,
            PLAYWRIGHT_JSON_OUTPUT_NAME: report,
          });
          output = step.output;
          // A failed build ran no test. A failed test run still has a report.
          if (step.code !== 0 && args[0] === 'build') {
            return { results: new Map(), output };
          }
        }
        return { results: playwrightResults(readJson(report)), output };
      },
    },
  };
}

const union = <T>(lists: T[][]) => [...new Set(lists.flat())];

function judge(sabotage: Sabotage, results: Results, output: string): Row {
  const failed: string[] = [];
  const problems: string[] = [];
  for (const { test, because } of sabotage.mustFail) {
    const result = results.get(test);
    if (!result) problems.push(`did not run: ${test}`);
    else if (result.status === 'passed') problems.push(`passed: ${test}`);
    else if (!result.message.includes(because)) {
      problems.push(
        `failed for another reason: ${test} (${firstLine(result.message)})`,
      );
    } else failed.push(test);
  }
  if (problems.length > 0 && results.size === 0) {
    problems.push(`last output: ${tail(output)}`);
  }
  return {
    id: sabotage.id,
    removes: sabotage.removes,
    passed: problems.length === 0,
    ran: true,
    failed,
    reason: problems.join('\n'),
  };
}

function table(rows: Row[]): string[] {
  const width = Math.max(...rows.map((row) => row.id.length));
  const lines: string[] = [];
  for (const row of rows) {
    lines.push(
      `${row.passed ? 'passed' : 'FAILED'}  ${row.id.padEnd(width)}  ${row.removes}`,
    );
    for (const test of row.failed) {
      lines.push(`          failed as required: ${test}`);
    }
    for (const line of row.reason.split('\n').filter(Boolean)) {
      lines.push(`          ${line}`);
    }
  }
  const passed = rows.filter((row) => row.passed).length;
  lines.push(
    '',
    `${rows.length} sabotages: ${passed} passed, ${rows.length - passed} FAILED`,
  );
  return lines;
}

export async function prove(options: ProveOptions): Promise<ProveResult> {
  const log = options.log ?? console.log;
  const progress = options.progress ?? (() => {});
  const stopped = (why: string, tmp = ''): ProveResult => {
    log(`Stopped before any patch:\n${why}`);
    return { ok: false, baseline: why, rows: [], tmp };
  };

  const problems = manifestProblems(options);
  if (problems.length > 0) return stopped(problems.join('\n'));

  const root = realpathSync(options.root);
  const tmpRoot = realpathSync(options.tmpRoot ?? os.tmpdir());
  if (tmpRoot === root || tmpRoot.startsWith(root + path.sep)) {
    throw new Error(`The copies must be outside the project: ${tmpRoot}`);
  }
  const tmp = mkdtempSync(path.join(tmpRoot, 'prove-'));

  try {
    const files = sourceFiles(root);
    const reports = path.join(tmp, 'reports');
    mkdirSync(reports);

    let deps = options.deps;
    if (!deps) {
      progress('Installing the dependencies for this run');
      deps = path.join(tmp, 'deps');
      copyFiles(root, files, deps);
      const store = await pnpm(['store', 'path'], root);
      const install = await pnpm(
        [
          'install',
          '--frozen-lockfile',
          '--offline',
          '--store-dir',
          firstLine(store.output).replace(/[\\/]v\d+$/, ''),
        ],
        deps,
      );
      if (install.code !== 0) {
        return stopped(`The install failed: ${tail(install.output)}`, tmp);
      }
    }
    const installed = deps;
    const lane = lanes(installed);

    // The web lane works in the install itself: its bundler refuses
    // dependencies outside the project. The sources are replaced each time.
    const prepare = (name: string, which: Sabotage['lane']) => {
      if (which === 'api') {
        const copy = path.join(tmp, name);
        copyFiles(root, files, copy);
        link(installed, copy);
        return copy;
      }
      for (const entry of readdirSync(installed)) {
        if (entry === 'node_modules') continue;
        if (entry !== 'web') {
          rmSync(path.join(installed, entry), { recursive: true, force: true });
          continue;
        }
        for (const inner of readdirSync(path.join(installed, 'web'))) {
          if (inner === 'node_modules') continue;
          rmSync(path.join(installed, 'web', inner), {
            recursive: true,
            force: true,
          });
        }
      }
      copyFiles(root, files, installed);
      return installed;
    };
    const finish = (directory: string) => {
      if (directory !== installed) discard(directory);
    };

    const byLane = (which: Sabotage['lane']) =>
      options.sabotages.filter((sabotage) => sabotage.lane === which);

    // With no patch, every named test must pass. A test that is already red
    // would be counted as a caught sabotage.
    const red: string[] = [];
    for (const which of ['api', 'web'] as const) {
      const sabotages = byLane(which);
      if (sabotages.length === 0) continue;
      progress(`Baseline, ${which} lane`);
      const names = union(sabotages.map((s) => s.mustFail.map((m) => m.test)));
      const directory = prepare(`baseline-${which}`, which);
      try {
        const { results, output } = await lane[which].test(
          directory,
          union(sabotages.map((s) => s.files)),
          names,
          path.join(reports, `baseline-${which}.json`),
        );
        for (const name of names) {
          const result = results.get(name);
          if (!result) red.push(`did not run: ${name}`);
          else if (result.status !== 'passed') {
            red.push(`failed: ${name} (${firstLine(result.message)})`);
          }
        }
        if (results.size === 0) red.push(`last output: ${tail(output)}`);
      } finally {
        finish(directory);
      }
    }
    if (red.length > 0) return stopped(red.join('\n'), tmp);

    const rows = new Map<string, Row>();
    let done = 0;
    const one = async (sabotage: Sabotage) => {
      const directory = prepare(sabotage.id, sabotage.lane);
      let row: Row;
      try {
        const drift = applyPatch(
          path.resolve(options.patches, sabotage.patch),
          directory,
          tmp,
        );
        if (drift) {
          row = {
            id: sabotage.id,
            removes: sabotage.removes,
            passed: false,
            ran: false,
            failed: [],
            reason: drift,
          };
        } else {
          const { results, output } = await lane[sabotage.lane].test(
            directory,
            sabotage.files,
            sabotage.mustFail.map((m) => m.test),
            path.join(reports, `${sabotage.id}.json`),
          );
          row = judge(sabotage, results, output);
        }
      } finally {
        finish(directory);
      }
      rows.set(sabotage.id, row);
      done += 1;
      progress(
        `[${done}/${options.sabotages.length}] ${row.passed ? 'passed' : 'FAILED'} ${row.id}`,
      );
    };

    const queue = [...byLane('api')];
    const jobs = Math.max(1, options.jobs ?? 1);
    await Promise.all(
      Array.from({ length: jobs }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await one(next);
        }
      }),
    );
    // The browser stack has fixed ports, so these run one at a time.
    for (const sabotage of byLane('web')) await one(sabotage);

    const ordered = options.sabotages.map((s) => rows.get(s.id)!);
    for (const line of table(ordered)) log(line);
    return {
      ok: ordered.every((row) => row.passed),
      baseline: null,
      rows: ordered,
      tmp,
    };
  } finally {
    for (const entry of existsSync(tmp) ? readdirSync(tmp) : []) {
      discard(path.join(tmp, entry));
    }
    rmSync(tmp, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 300,
    });
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, '..');
  const all = JSON.parse(
    readFileSync(path.join(root, 'prove/sabotages.json'), 'utf8'),
  ) as Sabotage[];
  const args = process.argv.slice(2);
  const jobsArg = args.find((arg) => arg.startsWith('--jobs='));
  const wanted = args.filter((arg) => !arg.startsWith('--'));
  // An id, or a group such as "ledger".
  const sabotages = all.filter(
    ({ id }) =>
      wanted.length === 0 ||
      wanted.some((name) => id === name || id.startsWith(`${name}.`)),
  );
  if (sabotages.length === 0) {
    console.error(`No sabotage matches ${wanted.join(', ')}`);
    process.exit(1);
  }
  const started = Date.now();
  const result = await prove({
    root,
    patches: path.join(root, 'prove/sabotages'),
    sabotages,
    jobs: jobsArg
      ? Number(jobsArg.slice('--jobs='.length))
      : Math.max(1, Math.min(3, Math.floor(os.availableParallelism() / 4))),
    progress: (line) => console.error(line),
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(`Time: ${Math.floor(seconds / 60)} min ${seconds % 60} s`);
  process.exitCode = result.ok ? 0 : 1;
}
