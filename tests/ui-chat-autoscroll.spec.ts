import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const projId = 'chat-scroll-test-proj';
const accountId = 'dev-user-1';

/**
 * UI fix 5: the chat message list must open scrolled to the latest message
 * instead of the top of a long restored conversation.
 */
test.describe('Chat auto-scroll to latest', () => {
  test('a long restored conversation opens at the latest message', async ({ page }) => {
    test.setTimeout(60000);
    await page.addInitScript(({ id, account }: { id: string; account: string }) => {
      const proj = {
        id,
        name: 'Scroll Test Project',
        framework: 'React 18 + Vite',
        status: 'ready',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const messages: Array<{ role: string; content: string }> = [];
      for (let i = 0; i < 40; i++) {
        messages.push({ role: 'user', content: `Message ${i}: please build feature number ${i} of my application` });
        messages.push({ role: 'ai', content: `Reply ${i}: here is a detailed response about feature ${i}. `.repeat(8) });
      }
      const pfx = `brainhalf_account:${account}:`;
      localStorage.setItem(`${pfx}brainhalf_projects`, JSON.stringify([proj]));
      localStorage.setItem(`${pfx}brainhalf_active_project`, id);
      localStorage.setItem(`${pfx}brainhalf_messages_${id}`, JSON.stringify(messages));
      localStorage.setItem('bh_session_token', 'bh_dev_local_token_not_a_real_session');
      localStorage.setItem('bh_session_user', JSON.stringify({ id: account, email: 'dev@brainhalf.local' }));
    }, { id: projId, account: accountId });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/?project=${projId}`, { waitUntil: 'domcontentloaded' });

    const stream = page.locator('.studio-message-stream');
    await expect(stream).toBeVisible({ timeout: 15000 });
    // The seeded history must have rendered before measuring scroll position.
    await expect(stream).toContainText('Reply 39:', { timeout: 15000 });

    // Distance from the bottom of the scroll container: the same 120px
    // threshold the chat uses to decide the user has scrolled up.
    await expect
      .poll(
        async () => stream.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight),
        { timeout: 15000 },
      )
      .toBeLessThan(120);

    await page.screenshot({ path: 'audit-artifacts/ui-fixes-2026-09-30/chat-autoscroll.png' });
  });
});
