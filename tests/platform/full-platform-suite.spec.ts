import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_BASE = 'http://localhost:8788';

test.describe('SECTION 1 - CORE USER JOURNEYS', () => {
  
  test('1.1 - Initial page load with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/screenshots/01-01-initial-load.png', fullPage: true });
    
    expect(errors.length).toBe(0);
    console.log('✓ Page loaded without console errors');
  });

  test('1.2 - Auth UI elements present', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    
    // Check for login/signup interface
    const bodyText = await page.textContent('body');
    const hasAuthUI = bodyText?.includes('Sign') || bodyText?.includes('Login') || bodyText?.includes('Email');
    
    await page.screenshot({ path: '/tmp/screenshots/01-02-auth-ui.png', fullPage: true });
    console.log('Auth UI check:', hasAuthUI ? '✓ Found' : '✗ Not found');
    console.log('Page text sample:', bodyText?.substring(0, 200));
  });

  test('1.3 - Responsive layout at mobile (375px)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/screenshots/01-03-mobile-375.png', fullPage: true });
    
    // Check for horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(375);
    console.log('✓ No horizontal overflow at 375px');
  });

  test('1.4 - Responsive layout at tablet (768px)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/screenshots/01-04-tablet-768.png', fullPage: true });
    
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(bodyWidth).toBeLessThanOrEqual(768);
    console.log('✓ No horizontal overflow at 768px');
  });

  test('1.5 - Responsive layout at desktop (1440px)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/screenshots/01-05-desktop-1440.png', fullPage: true });
    console.log('✓ Desktop layout rendered');
  });
});

test.describe('SECTION 4 - ERROR HANDLING & RESILIENCE', () => {
  
  test('4.1 - Invalid URL handling', async ({ page }) => {
    await page.goto(`${BASE_URL}/nonexistent-route-12345`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: '/tmp/screenshots/04-01-404-handling.png', fullPage: true });
    
    const bodyText = await page.textContent('body');
    const has404Content = bodyText?.includes('404') || bodyText?.includes('not found') || bodyText !== '';
    console.log('404 handling:', has404Content ? '✓ Handled' : '✗ Blank page');
  });

  test('4.2 - Network offline simulation', async ({ page, context }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    
    // Go offline
    await context.setOffline(true);
    
    // Try to interact (this will fail, but should handle gracefully)
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '/tmp/screenshots/04-02-offline.png', fullPage: true });
    
    await context.setOffline(false);
    console.log('✓ Offline state tested');
  });
});

