import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '../..');
const read = (file: string) =>
  JSON.parse(readFileSync(path.join(repo, file), 'utf8'));

// `pnpm dev` is one command for the whole demo.
describe('pnpm dev', () => {
  const { scripts } = read('package.json') as {
    scripts: Record<string, string>;
  };

  it('runs the API, the web app, the worker and the receiver, and nothing else', () => {
    const pattern = /^pnpm run "\/(.+)\/"$/.exec(scripts.dev)?.[1];
    expect(pattern).toBeDefined();
    const selected = Object.keys(scripts).filter((name) =>
      new RegExp(pattern!).test(name),
    );
    expect(selected.sort()).toEqual([
      'start:dev',
      'start:receiver',
      'start:web',
      'start:worker',
    ]);
  });

  it('starts the receiver from a file outside both applications', () => {
    expect(scripts['start:receiver']).toBe('node dev/receiver.ts');
    expect(existsSync(path.join(repo, 'dev/receiver.ts'))).toBe(true);
    // The API is built from src and the web app from web.
    expect(read('tsconfig.build.json').include).toEqual(['src']);
  });
});
