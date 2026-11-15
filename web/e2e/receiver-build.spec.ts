import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { demoReceiver } from '../../db/seed';
import { RECEIVER_URL } from './support/stack';

const web = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(web, '..');
const source = path.join(repo, 'dev/receiver.ts');

// Text that appears only in the receiver's own file.
const MARKERS = ['startReceiver', demoReceiver.secret];

function filesUnder(directory: string, skip: string[] = []): string[] {
  return readdirSync(directory).flatMap((name) => {
    if (skip.includes(name)) return [];
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

// Like the demo sign-in, the fake receiver exists in development only.
test.describe('the fake webhook receiver', () => {
  test('is running beside the stack under test', async ({ request }) => {
    const response = await request.get(`${RECEIVER_URL}/received/none`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  test('is in neither build', () => {
    // The markers are really in the source, so the search below can find them.
    const text = readFileSync(source, 'utf8');
    for (const marker of MARKERS) expect(text).toContain(marker);

    const built = [
      ...filesUnder(path.join(repo, 'dist')),
      // The development server writes to .next/dev, and .next/cache is the
      // build cache, which is never served.
      ...filesUnder(path.join(web, '.next'), ['dev', 'cache']),
    ];
    expect(built.length).toBeGreaterThan(40);
    expect(built.some((file) => file.endsWith('worker.js'))).toBe(true);
    const traces = built.filter((file) => {
      const content = readFileSync(file, 'latin1');
      return MARKERS.some((marker) => content.includes(marker));
    });
    expect(traces.map((file) => path.relative(repo, file))).toEqual([]);
  });
});
