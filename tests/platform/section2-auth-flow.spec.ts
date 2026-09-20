import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_BASE = 'http://localhost:8788';

test.describe('SECTION 1 (continued) - AUTHENTICATION FLOW', () => {
  test('1.6 - Signup flow', async ({ page }) => {
    const TEST_EMAIL = `test-${Date.now()}@example.com`;
    const TEST_PASSWORD = 'TestPassword123!';

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    const signupButton = page.getByText('Sign up', { exact: false });
    if (await signupButton.isVisible()) {
      await signupButton.click();
      await page.waitForTimeout(500);

      const emailInput = page.locator('input[type="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();

      await emailInput.fill(TEST_EMAIL);
      await passwordInput.fill(TEST_PASSWORD);

      const submitBtn = page.getByRole('button', { name: /create account/i }).first();
      await submitBtn.click();

      await page.waitForTimeout(3000);
      await page.screenshot({ path: '/tmp/screenshots/01-06-signup.png', fullPage: true });

      const currentUrl = page.url();
      const bodyText = await page.textContent('body');
      const isAuthenticated = currentUrl.includes('/p/') || bodyText?.includes('New Project');

      console.log('Signup success:', isAuthenticated ? '✓ Authenticated' : '✗ Failed');
      expect(isAuthenticated).toBe(true);
    }
  });

  test('1.7 - Login flow (existing user)', async ({ page }) => {
    const TEST_EMAIL = `test-${Date.now()}@example.com`;
    const TEST_PASSWORD = 'TestPassword123!';

    // First create account
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    const signupButton = page.getByText('Sign up', { exact: false });
    if (await signupButton.isVisible()) {
      await signupButton.click();
      await page.waitForTimeout(500);
      await page.locator('input[type="email"]').first().fill(TEST_EMAIL);
      await page.locator('input[type="password"]').first().fill(TEST_PASSWORD);
      await page.getByRole('button', { name: /create account/i }).first().click();
      await page.waitForTimeout(2000);
    }

    // Now logout and login again
    const topNav = page.locator('.top-nav, [class*="top-nav"]');
    if (await topNav.isVisible()) {
      const logoutBtn = page.getByText('Logout', { exact: false }).or(page.getByRole('button', { name: /logout/i }));
      if (await logoutBtn.isVisible()) {
        await logoutBtn.click();
        await page.waitForTimeout(1000);
      }
    }

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();

    await emailInput.fill(TEST_EMAIL);
    await passwordInput.fill(TEST_PASSWORD);

    const signInBtn = page.locator("button[type=\"submit\"]");
    await signInBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/screenshots/01-07-login.png', fullPage: true });

    const currentUrl = page.url();
    const bodyText = await page.textContent('body');
    const isAuthenticated = currentUrl.includes('/p/') || bodyText?.includes('New Project');

    console.log('Login success:', isAuthenticated ? '✓ Authenticated' : '✗ Failed');
    expect(isAuthenticated).toBe(true);
  });

  test('1.8 - Invalid credentials handling', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    
    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    
    if (await emailInput.isVisible()) {
      await emailInput.fill('wrong@example.com');
      await passwordInput.fill('WrongPassword123');
      
      const signInBtn = page.locator("button[type=\"submit\"]");
      await signInBtn.click();
      
      // Wait for error message to appear
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/screenshots/01-08-invalid-creds.png', fullPage: true });
      
      // Check for error alert div with role="alert"
      const errorAlert = page.locator('[role="alert"]');
      const errorVisible = await errorAlert.isVisible();
      const errorText = errorVisible ? await errorAlert.textContent() : '';
      
      console.log('Invalid credentials error display:');
      console.log('  Error visible:', errorVisible ? '✓ Yes' : '✗ No');
      if (errorVisible) {
        console.log('  Error text:', errorText);
      }
      
      expect(errorVisible).toBe(true);
      expect(errorText).toBeTruthy();
    }
  });
});
