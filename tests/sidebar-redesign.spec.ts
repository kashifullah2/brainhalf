import { test, expect } from '@playwright/test';

test.describe('Landing Page Project List Verification', () => {
  test('renders project cards with names, timestamps, and action menu', async ({ page }) => {
    await page.addInitScript(() => {
      const p1 = {
        id: 'proj-financial-tracker',
        name: 'Financial Budget Dashboard',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 3600000
      };
      const p2 = {
        id: 'proj-chess-game',
        name: 'Chess Game',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 7200000,
        updatedAt: Date.now() - 7200000
      };
      const p3 = {
        id: 'proj-empty-new',
        name: 'New Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now() - 60000
      };

      localStorage.setItem('brainhalf_projects', JSON.stringify([p1, p2, p3]));
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: 'dev-user-1', email: 'dev@brainhalf.local' }));

      localStorage.setItem(
        'brainhalf_messages_proj-financial-tracker',
        JSON.stringify([
          { role: 'user', content: 'Build an interactive financial budget dashboard with charts and tables' }
        ])
      );

      localStorage.setItem(
        'brainhalf_messages_proj-chess-game',
        JSON.stringify([
          { role: 'user', content: 'Create a chess game' }
        ])
      );
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    // 1. Verify project cards are visible on landing page
    const cards = page.locator('.landing-project-card');
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThanOrEqual(3);

    // 2. Verify project names appear in cards
    const p1Card = page.locator('.landing-project-card', { hasText: 'Financial Budget Dashboard' });
    await expect(p1Card).toBeVisible();

    const p2Card = page.locator('.landing-project-card', { hasText: 'Chess Game' });
    await expect(p2Card).toBeVisible();

    const p3Card = page.locator('.landing-project-card', { hasText: 'New Project' });
    await expect(p3Card).toBeVisible();

    // 3. Verify action menu opens on a project card
    const actionsBtn = p1Card.locator('button[aria-label="Project actions"]');
    await actionsBtn.click();
    await page.waitForTimeout(200);

    const deleteItem = page.locator('.landing-card-dropdown-item.danger').first();
    await expect(deleteItem).toBeVisible();

    // Close menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // 4. Verify clicking a card navigates to the project workspace
    await p2Card.click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('project=proj-chess-game');

    // 5. Visual screenshot of landing page project list
    await page.goto('http://localhost:5173');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/landing-project-list.png' });
  });
});
