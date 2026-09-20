import { test, expect } from '@playwright/test';

test('find iframe', async ({ page }) => {
  await page.addInitScript(() => {
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
  
  await page.route('**/api/auth/session', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u-123', email: 'test@example.com' } }) }));
  
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(3000);
  
  const iframes = await page.locator('iframe').all();
  for (const frame of iframes) {
    const title = await frame.getAttribute('title');
    const clazz = await frame.getAttribute('class');
    console.log('IFRAME TITLE:', title);
    console.log('IFRAME CLASS:', clazz);
  }
});
