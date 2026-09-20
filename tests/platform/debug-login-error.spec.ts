import { test } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

test('Debug - Check what happens with invalid login', async ({ page }) => {
  // Enable console logging
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error));

  // Navigate to a workspace URL without auth — this triggers the LoginScreen gate directly
  // (navigating to root without auth shows LandingPage, not LoginScreen)
  await page.goto(`${BASE_URL}/?project=debug-test-proj`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  
  console.log('\n=== INITIAL STATE ===');
  const initialHTML = await page.locator('body').innerHTML();
  console.log('Body contains login form:', initialHTML.includes('Sign in'));
  
  const emailInput = page.locator('input[type="email"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  
  console.log('\n=== FILLING FORM ===');
  await emailInput.fill('wrong@example.com');
  await passwordInput.fill('WrongPassword123');
  console.log('Form filled with invalid credentials');
  
  const signInBtn = page.getByRole('button', { name: /sign in/i }).first();
  console.log('\n=== CLICKING SIGN IN ===');
  await signInBtn.click();
  
  // Wait a bit for the request
  await page.waitForTimeout(3000);
  
  console.log('\n=== AFTER CLICK ===');
  const afterHTML = await page.locator('body').innerHTML();
  
  // Check for error alert
  const errorAlerts = page.locator('[role="alert"]');
  const alertCount = await errorAlerts.count();
  console.log('Number of alert elements:', alertCount);
  
  if (alertCount > 0) {
    for (let i = 0; i < alertCount; i++) {
      const text = await errorAlerts.nth(i).textContent();
      console.log(`Alert ${i}:`, text);
    }
  }
  
  // Check for any error text
  const hasErrorText = afterHTML.toLowerCase().includes('invalid') || 
                       afterHTML.toLowerCase().includes('error') ||
                       afterHTML.toLowerCase().includes('wrong');
  console.log('Body contains error keywords:', hasErrorText);
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/debug-login-error.png', fullPage: true });
  console.log('Screenshot saved to /tmp/debug-login-error.png');
  
  // Check network requests
  console.log('\n=== CHECKING CONSOLE FOR API ERRORS ===');
});
