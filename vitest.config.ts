import { defineConfig } from 'vitest/config';

const shared = {
  globals: true,
  root: './',
  setupFiles: ['./test/setup-env.ts'],
  hookTimeout: 60_000,
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Runs once, for both projects: one database per run.
    globalSetup: ['./test/global-setup.ts'],
    projects: [
      {
        resolve: { tsconfigPaths: true },
        test: {
          ...shared,
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
        resolve: { tsconfigPaths: true },
        test: {
          ...shared,
          name: 'events',
          include: ['test/events/**/*.spec.ts', 'test/events/**/*.e2e-spec.ts'],
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
