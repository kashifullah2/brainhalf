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
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

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

    // Background should be transparent (rgba(0, 0, 0, 0))
    expect(cardStyles.background).toBe('rgba(0, 0, 0, 0)');
    // Border should be none / 0px
    expect(cardStyles.borderStyle).toBe('none');
    expect(cardStyles.borderWidth).toBe('0px');

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

    // Background lightens (should NOT be transparent anymore, e.g. rgba(255, 255, 255, 0.05))
    expect(hoverStyles.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(hoverStyles.borderStyle).toBe('none');
    expect(hoverStyles.borderWidth).toBe('0px');

    // 4. Verify panel dividers:
    // Sidebar has border-right (divider between sidebar and chat panel)
    const sidebar = page.locator('.sidebar-container');
    const sidebarBorderRight = await sidebar.evaluate(el => window.getComputedStyle(el).borderRightStyle);
    expect(sidebarBorderRight).toBe('solid');

    // ChatPanel has border-right (divider between chat panel and preview panel)
    const chatPanel = page.locator('.chat-panel-container');
    const chatBorderRight = await chatPanel.evaluate(el => window.getComputedStyle(el).borderRightStyle);
    expect(chatBorderRight).toBe('solid');

    // 5. Verify individual elements inside chat panel don't have borders
    const chatInputWrapper = page.locator('.chat-input-wrapper');
    const inputBorder = await chatInputWrapper.evaluate(el => window.getComputedStyle(el).borderStyle);
    expect(inputBorder).toBe('none');

    // 6. Capture screenshot
    await chatPanel.screenshot({
      path: '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475/quick_templates_borderless.png'
    });
  });
});
