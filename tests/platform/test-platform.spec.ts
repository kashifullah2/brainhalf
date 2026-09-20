import { test, expect } from '@playwright/test';

test.describe('BrainHalf Platform Tests', () => {
  test('SECTION 1.1 - New user signup and login', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    // Check if we land on login/signup page
    const pageContent = await page.content();
    console.log('Page loaded, checking for auth elements');
    
    // Take screenshot for debugging
    await page.screenshot({ path: '/tmp/01-initial-load.png', fullPage: true });
    
    // Check for any console errors
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    await page.waitForTimeout(2000);
    
    if (errors.length > 0) {
      console.log('Console errors found:', errors);
      throw new Error(`Console errors: ${errors.join(', ')}`);
    }
    
    console.log('Initial load successful, no console errors');
  });
});
