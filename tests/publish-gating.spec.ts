import { expect, test } from '@playwright/test';
import { setupLifecycle } from './fixtures/lifecycle';

const BLOCKED_LABEL = 'Fix the preview error before publishing — the cloud build would fail the same way.';

// Regression guard for the upgrade009 review: a failing preview must surface
// the error overlay and block Publish so users do not kick off a cloud build
// that would fail the same way. Recovery must re-enable Publish.
test('preview error blocks publish and recovery re-enables it', async ({ page }) => {
  await setupLifecycle(page);

  // Healthy baseline: publish is enabled.
  await expect(page.getByRole('button', { name: 'Publish app' })).toBeEnabled();

  // Serve a broken preview that reports a compile error to the workspace.
  await page.route('**/preview/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<script>window.parent.postMessage({ type: "preview-error", error: "Cannot resolve module \\"./Missing\\" from \\"/src/App.jsx\\"", file: "/src/App.jsx" }, "*");</script>',
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });

  // The error overlay appears and Publish is disabled with an explanation.
  await expect(page.getByRole('alert')).toContainText('Your preview ran into a problem.');
  const blocked = page.getByRole('button', { name: BLOCKED_LABEL });
  await expect(blocked).toBeDisabled();
  await blocked.click({ force: true });
  await expect(page.getByRole('dialog', { name: 'Project publication' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Choose app name' })).toHaveCount(0);

  // Recovery: a successful preview clears the error and re-enables Publish.
  await page.route('**/preview/**', route => route.fulfill({
    contentType: 'text/html',
    body: '<h1>Recovered app</h1><script>window.parent.postMessage({ type: "preview-success" }, "*");</script>',
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('alert').filter({ hasText: 'Your preview ran into a problem.' })).toHaveCount(0);
  const publish = page.getByRole('button', { name: 'Publish app' });
  await expect(publish).toBeEnabled();
  await publish.click();
  await expect(page.locator('.publish-popover')).toBeVisible();
});
