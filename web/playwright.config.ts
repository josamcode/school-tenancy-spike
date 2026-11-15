import { defineConfig } from '@playwright/test';
import { WEB_URL } from './e2e/support/stack';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: WEB_URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
  },
});
