/**
 * Playwright config for the full-stack generation timing test.
 *
 * Usage:
 *   BH_SESSION_TOKEN=<token> BASE_URL=https://brainhalf.com \
 *   npx playwright test --config playwright.timing.config.ts
 *
 * The test skips automatically when BH_SESSION_TOKEN is empty.
 * Get your session token from: localStorage.getItem('bh_session_token')
 * in the BrainHalf browser console after logging in.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testMatch: ['**/fullstack-timing.spec.ts'],
  timeout: 15 * 60 * 1000,  // 15 min per test (generation + build + preview)
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'https://brainhalf.com',
    trace: 'on',
    screenshot: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});
