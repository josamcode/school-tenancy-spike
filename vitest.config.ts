import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    hookTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          include: [
            'src/**/*.spec.ts',
            'test/**/*.spec.ts',
            'test/**/*.e2e-spec.ts',
          ],
          exclude: ['**/node_modules/**', 'test/events/**'],
        },
      },
      // These files run a dispatcher or a worker, which act on every school.
      // They run after the others and one at a time.
      {
        extends: true,
        test: {
          name: 'events',
          include: ['test/events/**/*.spec.ts', 'test/events/**/*.e2e-spec.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
