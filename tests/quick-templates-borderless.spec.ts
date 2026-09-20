import { test, expect } from '@playwright/test';

test.describe('Quick Templates & Borderless Panel Verification', () => {
  test('verifies quick-template cards are transparent and borderless with subtle hover, and panel dividers', async ({ page }) => {
    // Clear project messages so quick templates are rendered
    await page.addInitScript(() => {
      const p1 = {
        id: 'fresh-project',
        name: 'Project 1',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      localStorage.setItem('brainhalf_projects', JSON.stringify([p1]));
      localStorage.setItem('brainhalf_active_project', p1.id);
      localStorage.removeItem('brainhalf_messages_fresh-project');
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173/?project=fresh-project', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // 1. Verify quick-template cards exist
    const templateCards = page.locator('.quick-template-card');
    await expect(templateCards.first()).toBeVisible();
    const count = await templateCards.count();
    expect(count).toBeGreaterThan(0);

    // 2. Check first card computed styles: transparent background and NO border
    const cardStyles = await templateCards.first().evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        background: computed.backgroundColor,
        borderWidth: computed.borderWidth,
        borderStyle: computed.borderStyle,
        borderRadius: computed.borderRadius
      };
    });

    // Background should be nearly transparent (no heavy fill color)
    // Accepts rgba(0,0,0,0) or very subtle rgba(255,255,255, <0.05)
    const bgAlpha = parseFloat(cardStyles.background.match(/[\d.]+(?=\))/)?.[0] || '0');
    expect(bgAlpha).toBeLessThan(0.05);
    // Border should be very thin (1px or none) — visually "borderless"
    const borderW = parseFloat(cardStyles.borderWidth);
    expect(borderW).toBeLessThanOrEqual(1);

    // 3. Check hover state: background lightens slightly without adding border
    await templateCards.first().hover();
    await page.waitForTimeout(150);

    const hoverStyles = await templateCards.first().evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        background: computed.backgroundColor,
        borderWidth: computed.borderWidth,
        borderStyle: computed.borderStyle
      };
    });

    // Background lightens (should NOT be fully transparent on hover)
    const hoverBgAlpha = parseFloat(hoverStyles.background.match(/[\d.]+(?=\))/)?.[0] || '0');
    expect(hoverBgAlpha).toBeGreaterThan(0);
    // Border stays thin on hover (no heavy border appears)
    const hoverBorderW = parseFloat(hoverStyles.borderWidth);
    expect(hoverBorderW).toBeLessThanOrEqual(1);

    // 4. Verify panel dividers:
    // ChatPanel has border-right (divider between chat panel and preview panel)
    const chatPanel = page.locator('.chat-panel-container');
    const chatBorderRight = await chatPanel.evaluate(el => window.getComputedStyle(el).borderRightStyle);
    expect(chatBorderRight).toBe('solid');

    // 5. Verify chat input wrapper has only a subtle border (1px at most, not heavy)
    const chatInputWrapper = page.locator('.chat-input-wrapper');
    const inputBorderWidth = await chatInputWrapper.evaluate(el => parseFloat(window.getComputedStyle(el).borderWidth));
    expect(inputBorderWidth).toBeLessThanOrEqual(1);

    // 6. Capture screenshot
    await chatPanel.screenshot({ path: 'test-results/quick_templates_borderless.png' });
  });
});
