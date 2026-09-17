import { test, expect } from '@playwright/test';

test('verify hero card is vertically centered based on available preview panel height', async ({ page }) => {
  // Clear project messages and ensure clean project
  await page.addInitScript(() => {
    const p = {
      id: 'measure-hero-test-proj',
      name: 'Measure Hero Test Project',
      framework: 'React 18 + Vite',
      status: 'ready',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    localStorage.setItem('brainhalf_projects', JSON.stringify([p]));
    localStorage.setItem('brainhalf_active_project', p.id);
    localStorage.removeItem('brainhalf_messages_measure-hero-test-proj');
    localStorage.setItem('bh_session_token', 'dummy-token');
    localStorage.setItem('bh_session_user', JSON.stringify({ id: 'u-123', email: 'test@example.com' }));
    
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      if (args[0] && args[0].toString().includes('/api/auth/session')) {
        return new Response(JSON.stringify({ user: { id: 'u-123', email: 'test@example.com' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return originalFetch(...args);
    };
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/auth/session', route => route.fulfill({ status: 200, json: { user: { id: 'u-123', email: 'test@example.com' } } }));
  await page.goto('http://localhost:5173');
  await page.waitForSelector('iframe');

  const previewIframe = page.locator('iframe').first();
  await expect(previewIframe).toBeVisible();

  const heroCard = page.frameLocator('iframe').first().locator('.hero-section-card');
  await expect(heroCard).toBeVisible({ timeout: 30000 });

  // Get metrics
  const chromeBox = await page.locator('.browser-chrome').boundingBox();
  const iframeBox = await previewIframe.boundingBox();

  const frameMetrics = await heroCard.evaluate((cardEl) => {
    const parent = cardEl.parentElement as HTMLElement;
    const cardRect = cardEl.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const spaceAbove = cardRect.top;
    const spaceBelow = parentRect.height - cardRect.bottom;
    const centerOffset = (cardRect.top + cardRect.height / 2) - (parentRect.height / 2);

    return {
      parentHeight: parentRect.height,
      parentMinHeight: window.getComputedStyle(parent).minHeight,
      cardHeight: cardRect.height,
      spaceAbove,
      spaceBelow,
      centerOffset,
      diff: Math.abs(spaceAbove - spaceBelow)
    };
  });

  console.log('--- Centering Verification ---');
  console.log('Available preview panel height (excluding toolbar):', frameMetrics.parentHeight);
  console.log('Space above hero card:', frameMetrics.spaceAbove);
  console.log('Space below hero card:', frameMetrics.spaceBelow);
  console.log('Offset from vertical center:', frameMetrics.centerOffset);
  console.log('Top vs bottom difference:', frameMetrics.diff);

  // Assert exact centering (diff < 1px)
  expect(frameMetrics.diff).toBeLessThan(1);
  expect(Math.abs(frameMetrics.centerOffset)).toBeLessThan(1);

  // Capture verification screenshot
  await page.screenshot({
    path: '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475/hero-centering-verified.png'
  });
});
