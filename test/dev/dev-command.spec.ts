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

  // The API's watcher and the worker each delete their output directory
  // before they build, so they must not share one.
  it('builds the worker into a directory of its own, which the build of the API does not touch', () => {
    const worker = /--path (\S+)/.exec(scripts['start:worker'])?.[1];
    expect(worker).toBe('tsconfig.worker.json');
    expect(/--path/.test(scripts['start:dev'])).toBe(false);

    const directory = (file: string) =>
      path.resolve(repo, read(file).compilerOptions.outDir as string);
    const api = directory('tsconfig.json');
    const own = directory(worker!);
    expect(api).toBe(path.join(repo, 'dist'));
    expect(own).not.toBe(api);
    expect(own.startsWith(api + path.sep)).toBe(false);
    expect(api.startsWith(own + path.sep)).toBe(false);
    expect(read(worker!).extends).toBe('./tsconfig.build.json');

    // Neither output is committed, formatted or type-checked as source.
    const name = path.basename(own);
    const lines = (file: string) =>
      readFileSync(path.join(repo, file), 'utf8').split(/\s+/);
    expect(lines('.gitignore')).toContain(`${name}/`);
    expect(lines('.prettierignore')).toContain(name);
    expect(read('tsconfig.json').exclude).toContain(name);
  });

  it('starts the receiver from a file outside both applications', () => {
    expect(scripts['start:receiver']).toBe('node dev/receiver.ts');
    expect(existsSync(path.join(repo, 'dev/receiver.ts'))).toBe(true);
    // The API is built from src and the web app from web.
    expect(read('tsconfig.build.json').include).toEqual(['src']);
  });
});
