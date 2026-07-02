import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  retries: 1,
  use: {
    baseURL: 'http://localhost:5174',
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: 'node server/index.js',
    port: 5174,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
