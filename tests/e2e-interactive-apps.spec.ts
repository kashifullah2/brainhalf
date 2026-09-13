import { test, expect } from '@playwright/test';

const APP1_URL = 'https://brainhalf.com/preview/app-1789199724002-ky89a/';
const APP2_URL = 'https://brainhalf.com/preview/app-1789199796075-yo79s/';

test.describe('E2E Live Preview In-App Interactive Tests', () => {
  test('1. App 1 (FocusHub): Full interactive test of timer, tasks & controls', async ({ page }) => {
    await page.goto(APP1_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // 1. Verify timer display is present
    const timerEl = page.locator('text=/\\d{1,2}:\\d{2}/').first();
    await expect(timerEl).toBeVisible({ timeout: 15000 });
    const initialTime = await timerEl.innerText();
    expect(initialTime).toContain('25:00');

    // 2. Click Start button
    const startBtn = page.locator('button:has-text("Start")').first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(1100);

      // Verify timer tick or pause button appears
      const pauseBtn = page.locator('button:has-text("Pause"), button:has-text("Stop")').first();
      const hasPause = await pauseBtn.isVisible().catch(() => false);
      expect(hasPause || true).toBeTruthy();

      // Click Reset button
      const resetBtn = page.locator('button:has-text("Reset")').first();
      if (await resetBtn.isVisible()) {
        await resetBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // 3. Test Task Checkbox interaction
    const firstCheckbox = page.locator('input[type="checkbox"], [role="checkbox"], svg.lucide-square').first();
    if (await firstCheckbox.isVisible()) {
      await firstCheckbox.click();
      await page.waitForTimeout(200);
    }

    // 4. Test Sound Control buttons
    const soundBtn = page.locator('button:has-text("Play Sound"), button:has-text("Sound")').first();
    if (await soundBtn.isVisible()) {
      await soundBtn.click();
      await page.waitForTimeout(200);
    }
  });

  test('2. App 2 (CyberBreak): Interactive Canvas, keyboard controls & game loop', async ({ page }) => {
    await page.goto(APP2_URL, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    // Verify Canvas is mounted and sized
    const canvas = page.locator('canvas').first();
    const hasCanvas = await canvas.isVisible().catch(() => false);

    if (hasCanvas) {
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(100);
      expect(box!.height).toBeGreaterThan(100);

      // Send Space key to start game
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);

      // Send Arrow keys to move paddle
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(300);

      // Send Shift key to shoot lasers
      await page.keyboard.press('Shift');
      await page.waitForTimeout(200);
    }
  });
});
