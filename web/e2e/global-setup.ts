import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startDatabase } from '../../test/support/database';
import {
  API_PORT,
  API_URL,
  DEV_PORT,
  DEV_URL,
  JWT_SECRET,
  WEB_PORT,
  WEB_URL,
} from './support/stack';

const web = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(web, '..');
const next = path.join(web, 'node_modules/next/dist/bin/next');

function start(
  name: string,
  cwd: string,
  args: string[],
  env: Record<string, string>,
): ChildProcess {
  // Each process gets what it is meant to have and no more. The web app never
  // receives a database URL, and only the development server gets the secret.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !/DATABASE_URL|JWT_SECRET|^NODE_ENV$|^PORT$/.test(key),
    ),
  );
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...inherited, ...env } as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const log = (chunk: Buffer) => {
    if (process.env.E2E_LOGS)
      process.stderr.write(`[${name}] ${chunk.toString()}`);
  };
  child.stdout?.on('data', log);
  child.stderr?.on('data', log);
  return child;
}

function stop(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function ready(url: string, child: ChildProcess, name: string) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`${name} exited with code ${child.exitCode}`);
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(5000) });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`${name} did not start`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export default async function setup() {
  const api = path.join(repo, 'dist/main.js');
  for (const [file, command] of [
    [api, 'pnpm build'],
    [path.join(web, '.next/BUILD_ID'), 'pnpm build:web'],
  ]) {
    if (!existsSync(file)) {
      throw new Error(`${file} is missing. Run "${command}" first.`);
    }
  }

  const database = await startDatabase();
  const children: ChildProcess[] = [];
  const teardown = async () => {
    for (const child of children) stop(child);
    await database.stop();
  };

  try {
    // The API runs as the runtime role, as it does everywhere else.
    children.push(
      start('api', repo, [api], {
        PORT: String(API_PORT),
        DATABASE_URL: database.runtimeUrl,
        JWT_SECRET,
      }),
    );
    children.push(
      start('web', web, [next, 'start', '-p', String(WEB_PORT)], {
        API_URL,
        WEB_ORIGIN: WEB_URL,
      }),
    );
    children.push(
      start('dev', web, [next, 'dev', '-p', String(DEV_PORT)], {
        API_URL,
        WEB_ORIGIN: DEV_URL,
        JWT_SECRET,
      }),
    );
    await Promise.all([
      ready(`${API_URL}/health`, children[0], 'The API'),
      ready(WEB_URL, children[1], 'The web app'),
      ready(DEV_URL, children[2], 'The development server'),
    ]);
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}
