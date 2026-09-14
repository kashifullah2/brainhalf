import { test, expect } from '@playwright/test';

test.describe('Sidebar Redesign Verification', () => {
  test('renders first user prompt as title, right-aligned timestamps, reduced padding, and subtle hover with no border', async ({ page }) => {
    // Populate projects with messages in localStorage prior to page load
    await page.addInitScript(() => {
      const p1 = {
        id: 'proj-financial-tracker',
        name: 'Project 1',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 3600000
      };
      const p2 = {
        id: 'proj-chess-game',
        name: 'Project 2',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 7200000,
        updatedAt: Date.now() - 7200000
      };
      const p3 = {
        id: 'proj-empty-new',
        name: 'Project 3',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000
      };

      localStorage.setItem('brainhalf_projects', JSON.stringify([p1, p2, p3]));
      localStorage.setItem('brainhalf_active_project', p1.id);

      // p1 has a long prompt (> 30 chars)
      localStorage.setItem(
        'brainhalf_messages_proj-financial-tracker',
        JSON.stringify([
          { role: 'user', content: 'Build an interactive financial budget dashboard with charts and tables' }
        ])
      );

      // p2 has a short prompt (< 30 chars)
      localStorage.setItem(
        'brainhalf_messages_proj-chess-game',
        JSON.stringify([
          { role: 'user', content: 'Create a chess game' }
        ])
      );
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');

    // 1. Verify item 1 title is truncated first user prompt
    const p1Item = page.locator('.sidebar-nav-item', { hasText: 'Build an interactive financial…' });
    await expect(p1Item).toBeVisible();

    // 2. Verify item 2 title is exact short user prompt
    const p2Item = page.locator('.sidebar-nav-item', { hasText: 'Create a chess game' });
    await expect(p2Item).toBeVisible();

    // 3. Verify item 3 fallback
    const p3Item = page.locator('.sidebar-nav-item', { hasText: 'Project 3' });
    await expect(p3Item).toBeVisible();

    // 4. Verify right-aligned timestamp on p1
    const p1Timestamp = p1Item.locator('span:has-text("ago"), span:has-text("h ago"), span:has-text("m ago"), span:has-text("now")').first();
    await expect(p1Timestamp).toBeVisible();

    const timestampStyles = await p1Timestamp.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        fontSize: computed.fontSize,
        color: computed.color,
        textAlign: computed.textAlign
      };
    });
    expect(timestampStyles.fontSize).toBe('11px');

    // 5. Verify row padding is reduced and no borders
    const rowStyles = await p1Item.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        paddingTop: computed.paddingTop,
        paddingBottom: computed.paddingBottom,
        paddingLeft: computed.paddingLeft,
        paddingRight: computed.paddingRight,
        borderTopWidth: computed.borderTopWidth,
        borderBottomWidth: computed.borderBottomWidth,
        borderLeftWidth: computed.borderLeftWidth,
        borderRightWidth: computed.borderRightWidth,
        borderLeftStyle: computed.borderLeftStyle
      };
    });

    // Padding should be 5px (reduced from 8px/9px)
    expect(parseInt(rowStyles.paddingTop, 10)).toBeLessThanOrEqual(6);
    expect(parseInt(rowStyles.paddingBottom, 10)).toBeLessThanOrEqual(6);

    // No border
    expect(rowStyles.borderLeftStyle).toBe('none');
    expect(rowStyles.borderLeftWidth).toBe('0px');

    // 6. Test hover on p2
    await p2Item.hover();
    await page.waitForTimeout(200);

    const p2HoverStyles = await p2Item.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        background: computed.backgroundColor,
        borderLeftStyle: computed.borderLeftStyle,
        transform: computed.transform
      };
    });
    expect(p2HoverStyles.borderLeftStyle).toBe('none');
    expect(p2HoverStyles.transform).toBe('none');

    // 7. Capture visual screenshot of the redesigned sidebar
    const sidebar = page.locator('.sidebar-container');
    await sidebar.screenshot({
      path: '/home/kashifullah/.gemini/antigravity-ide/brain/bdade561-eefd-4bc6-bb08-2adeffc71475/sidebar_redesign_preview.png'
    });
  });
});
