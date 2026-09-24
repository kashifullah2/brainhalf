import { defineConfig, devices } from '@playwright/test';

// Public-page checks only. No login, generation, provider calls, or production writes.
export default defineConfig({
  testDir: './tests',
  testMatch: ['seo.spec.ts', 'analytics.spec.ts', 'account-pages.spec.ts'],
  fullyParallel: true,
  // The local Worker and asset server share one runtime during release checks.
  workers: process.env.CI ? 1 : 2,
  timeout: 30000,
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'http://localhost:8789', trace: 'retain-on-failure' },
  webServer: { command: 'npm run wrangler -- dev --local --port 8789', port: 8789, reuseExistingServer: !process.env.CI, timeout: 60000 },
});
