import type { Page } from '@playwright/test';
import * as path from 'path';

export interface PreviewInspectionResult {
  screenshotPath: string;
  consoleMessages: Array<{ type: string; text: string }>;
  consoleErrors: string[];
  failedRequests: Array<{ url: string; status: number; method: string }>;
}

/**
 * Reusable helper to open a generated preview URL in Playwright,
 * wait for network idle, collect console messages, collect failed network requests,
 * and capture a screenshot.
 */
export async function openGeneratedPreview(
  page: Page,
  url: string,
  screenshotName = 'preview-screenshot'
): Promise<PreviewInspectionResult> {
  const consoleMessages: Array<{ type: string; text: string }> = [];
  const consoleErrors: string[] = [];
  const failedRequests: Array<{ url: string; status: number; method: string }> = [];

  const onConsole = (msg: any) => {
    const text = msg.text();
    const type = msg.type();
    consoleMessages.push({ type, text });
    if (type === 'error') {
      consoleErrors.push(text);
    }
  };

  const onResponse = (response: any) => {
    const status = response.status();
    // 4xx and 5xx are considered failed requests
    if (status >= 400) {
      failedRequests.push({
        url: response.url(),
        status,
        method: response.request().method(),
      });
    }
  };

  page.on('console', onConsole);
  page.on('response', onResponse);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Allow any initial requests / rendering to settle
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
      // networkidle may timeout on open WebSockets or continuous polling, continue gracefully
    });

    const screenshotPath = path.resolve(process.cwd(), 'screenshots', `${screenshotName}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      screenshotPath,
      consoleMessages,
      consoleErrors,
      failedRequests,
    };
  } finally {
    page.off('console', onConsole);
    page.off('response', onResponse);
  }
}
