import { defineConfig } from '@playwright/test';
import config from './playwright.config';
import { LOCAL_BROWSER_SPECS, requireLiveTestOptIn } from './tests/browser-policy';

requireLiveTestOptIn(process.env);

export default defineConfig({
  ...config,
  testMatch: ['**/*.spec.ts'],
  testIgnore: LOCAL_BROWSER_SPECS,
});
