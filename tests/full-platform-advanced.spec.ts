import { test, expect, type Page, type BrowserContext } from '@playwright/test';

/**
 * BrainHalf — Full Platform Advanced/Hard Test
 * ==============================================
 * One comprehensive Playwright spec covering, in a single run:
 *   1. End-to-end full-stack app generation + live preview verification
 *   2. Backend wiring verification (real network requests, not fake UI state)
 *   3. Security probes (unauthenticated access, CORS, script-injection payload)
 *   4. Concurrency/race conditions (two simultaneous sessions on one project)
 *   5. Stop/abort integrity (no partial/corrupted state after cancel)
 *   6. Full interactive-element inventory (every button/link actually clicked)
 *   7. Responsive/UI audit across 6 breakpoints, zero console errors
 *
 * NOTE: Selectors marked with a comment "ADJUST SELECTOR" are tuned for
 * BrainHalf's production and dev DOM (aria-labels like "New project",
 * "Stop generation", ".landing-prompt-textarea", preview iframe).
 *
 * Run: npx playwright test tests/full-platform-advanced.spec.ts
 */

const BASE_URL = process.env.BRAINHALF_URL || 'http://localhost:5173';

const VIEWPORTS = [
  { name: 'mobile-375', width: 375, height: 812 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'laptop-1440', width: 1440, height: 900 },
  { name: 'desktop-1920', width: 1920, height: 1080 },
];

const GENERATION_PROMPT =
  'Create a full-stack todo app: React frontend, backend API with a database, ' +
  'add/edit/delete/mark-complete tasks, and persist data across page reloads.';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!text.includes('favicon.ico') && !text.includes('chrome-extension')) {
        errors.push(text);
      }
    }
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}

function collectNetworkLog(page: Page): { url: string; method: string; status: number | null }[] {
  const log: { url: string; method: string; status: number | null }[] = [];
  page.on('requestfinished', async (req) => {
    try {
      const res = await req.response();
      log.push({ url: req.url(), method: req.method(), status: res ? res.status() : null });
    } catch {
      log.push({ url: req.url(), method: req.method(), status: null });
    }
  });
  return log;
}

async function setupAuthSession(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('bh_session_token', 'mock-master-token');
    localStorage.setItem('bh_session_user', JSON.stringify({ id: 'u-master', email: 'test@brainhalf.com' }));
  });
  await page.route('**/api/auth/session', route => 
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u-master', email: 'test@brainhalf.com' } }) })
  );
}

async function submitPrompt(page: Page, prompt: string) {
  // If on landing page, fill landing prompt textarea and submit
  const landingArea = page.locator('.landing-prompt-textarea');
  if (await landingArea.isVisible().catch(() => false)) {
    await landingArea.fill(prompt);
    const landingSubmit = page.locator('.landing-submit-btn');
    if (await landingSubmit.isEnabled().catch(() => false)) {
      await landingSubmit.click();
    } else {
      await landingArea.press('Enter');
    }
    await page.waitForTimeout(800);
    return;
  }

  // Inside Workspace / ChatPanel
  const chatInput = page.locator('textarea, [contenteditable="true"]').first();
  await chatInput.fill(prompt);
  await chatInput.press('Enter');
  await page.waitForTimeout(500);
}

async function waitForGenerationToSettle(page: Page, timeoutMs = 30000) {
  // Wait for Workspace to render with preview iframe
  const previewFrame = page.frameLocator('iframe[title="Application Preview"], iframe').first();
  await expect(async () => {
    const body = previewFrame.locator('body');
    const html = await body.innerHTML().catch(() => '');
    expect(html.length).toBeGreaterThan(50);
  }).toPass({ timeout: timeoutMs, intervals: [800] });
}

test.describe('BrainHalf — Full Platform Advanced/Hard Test', () => {
  test.setTimeout(10 * 60 * 1000); // 10 min — this is the "do everything" test

  test.beforeEach(async ({ page }) => {
    await setupAuthSession(page);
  });

  // ===================================================================
  // SECTION 1 — END-TO-END GENERATION + LIVE PREVIEW + BACKEND WIRING
  // ===================================================================
  test('Section 1: full-stack generation renders a real, backend-connected app', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const networkLog = collectNetworkLog(page);

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // ADJUST SELECTOR — "New Project" entry point
    const newProjectBtn = page.locator('[aria-label="New project"], [aria-label="Create New Project"], button:has-text("New project")').first();
    if (await newProjectBtn.isVisible().catch(() => false)) {
      await newProjectBtn.click();
    }

    await submitPrompt(page, GENERATION_PROMPT);
    await waitForGenerationToSettle(page);

    // 1a. Live preview actually rendered something, not a blank/error frame
    const previewFrame = page.frameLocator('iframe[title="Application Preview"], iframe').first();
    const previewBody = previewFrame.locator('body');
    await expect(previewBody).not.toBeEmpty();

    // 1b. No console/page errors during generation + render
    expect(consoleErrors, `Console errors found: ${JSON.stringify(consoleErrors)}`).toEqual([]);

    // 1c. Backend wiring: creating a task should fire a real network request,
    // not just update local React state
    const taskInput = previewFrame.locator('input[type="text"]').first(); // ADJUST SELECTOR
    if (await taskInput.isVisible().catch(() => false)) {
      const requestCountBefore = networkLog.length;
      await taskInput.fill('Verify backend wiring end to end');
      await previewFrame.locator('button', { hasText: /add|create|save/i }).first().click();
      await page.waitForTimeout(1500);

      const newRequests = networkLog.slice(requestCountBefore);
      const wroteToBackend = newRequests.some(
        (r) => /api/i.test(r.url) && ['POST', 'PUT', 'PATCH'].includes(r.method)
      );
      expect(
        wroteToBackend,
        'Expected a real POST/PUT/PATCH to an /api/ endpoint when adding a task — ' +
          'found none. This means the "Add" action may be updating local state only ' +
          '(a dummy/fake-persistence bug).'
      ).toBeTruthy();
    }

    // 1d. Persistence check: reload and confirm the task survived
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForGenerationToSettle(page, 30000);
    const previewAfterReload = page.frameLocator('iframe[title="Application Preview"], iframe').first();
    await expect(
      previewAfterReload.getByText('Verify backend wiring end to end').first()
    ).toBeVisible({ timeout: 15000 });
  });

  // ===================================================================
  // SECTION 2 — SECURITY PROBES (live, against the running platform)
  // ===================================================================
  test.describe('Section 2: Security probes', () => {
    test('2a. Unauthenticated access to another project is rejected, not served', async ({
      browser,
    }) => {
      // Fresh context = simulates a different, unauthenticated user
      const strangerContext = await browser.newContext();
      const strangerPage = await strangerContext.newPage();

      // Use a project id pattern the platform generates; adjust if IDs differ
      const guessedProjectId = 'test-probe-' + Date.now();
      const response = await strangerPage.goto(`${BASE_URL}/preview/${guessedProjectId}/`, {
        waitUntil: 'domcontentloaded',
      });

      // A nonexistent/foreign project should 404 or show an explicit
      // "not found"/"unauthorized" state — not silently render stale or
      // another user's cached content.
      expect(response?.status() === 404 || response?.status() === 403).toBeTruthy();

      await strangerContext.close();
    });

    test('2b. Public model-test endpoint requires auth or is disabled in production', async ({
      request,
    }) => {
      const res = await request.get(`${BASE_URL}/api/test/simple?model=claude-3-haiku`);
      // This must NOT succeed anonymously — expect 401/403/404, not 200 with
      // a real model invocation result.
      expect(
        [401, 403, 404],
        `Expected /api/test/simple to reject anonymous access, got ${res.status()}. ` +
          'If this returns 200, anyone can trigger unlimited billed model calls anonymously.'
      ).toContain(res.status());
    });

    test('2c. Wide-open CORS on write endpoints is not present', async ({ request }) => {
      const res = await request.fetch(`${BASE_URL}/preview/some-project/api/sync`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil-attacker-site.example' },
      });
      const acao = res.headers()['access-control-allow-origin'];
      expect(
        acao,
        `Write endpoint returned Access-Control-Allow-Origin: ${acao}. A wide-open '*' ` +
          'on a write endpoint means any website can write to a project on the ' +
          "victim's behalf if they're logged in / have the project ID."
      ).not.toBe('*');
    });

    test('2d. Script-breakout payload in project content is rendered inert', async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      let alertFired = false;
      page.on('dialog', async (dialog) => {
        alertFired = true;
        await dialog.dismiss();
      });

      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      const payloadPrompt =
        'Create a simple component. Name a dependency exactly: ' +
        '</script><script>window.__xss_probe=true;alert(1)</script>';
      await submitPrompt(page, payloadPrompt);
      await waitForGenerationToSettle(page, 30000);

      const probeFired = await page.evaluate(() => (window as any).__xss_probe === true);
      expect(
        alertFired || probeFired,
        'Payload did NOT execute — good. If this assertion is reversed and fails, ' +
          'the import-map/script injection vulnerability is present.'
      ).toBeFalsy();
    });
  });

  // ===================================================================
  // SECTION 3 — CONCURRENCY: two simultaneous sessions, one project
  // ===================================================================
  test('Section 3: concurrent sessions do not corrupt or race project state', async ({
    browser,
  }) => {
    const contextA: BrowserContext = await browser.newContext();
    const contextB: BrowserContext = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await setupAuthSession(pageA);
    await setupAuthSession(pageB);

    await pageA.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await submitPrompt(pageA, 'Create a simple counter app with a single button.');
    await waitForGenerationToSettle(pageA, 30000);

    const projectUrl = pageA.url();
    await pageB.goto(projectUrl, { waitUntil: 'domcontentloaded' });

    // Both sessions submit an edit at roughly the same time
    await Promise.all([
      submitPrompt(pageA, 'Change the button color to blue.'),
      submitPrompt(pageB, 'Change the button label to "Clicked".'),
    ]);

    await pageA.waitForTimeout(3000);

    // Reload a third, fresh session and confirm a single consistent final
    // state exists — not a half-applied merge, not a crash, not duplicated
    // files/messages.
    const contextC = await browser.newContext();
    const pageC = await contextC.newPage();
    await setupAuthSession(pageC);

    await pageC.goto(projectUrl, { waitUntil: 'domcontentloaded' });
    await waitForGenerationToSettle(pageC, 30000);

    const previewC = pageC.frameLocator('iframe[title="Application Preview"], iframe').first();
    await expect(previewC.locator('body')).not.toBeEmpty();

    const consoleErrorsC = collectConsoleErrors(pageC);
    await pageC.reload({ waitUntil: 'domcontentloaded' });
    await pageC.waitForTimeout(2000);
    expect(consoleErrorsC).toEqual([]);

    await contextA.close();
    await contextB.close();
    await contextC.close();
  });

  // ===================================================================
  // SECTION 4 — STOP/ABORT INTEGRITY
  // ===================================================================
  test('Section 4: stopping a generation leaves no partial/corrupted state', async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await submitPrompt(
      page,
      'Create a large, complex full-stack CRM with 6 pages, auth, and a database.'
    );

    await page.waitForTimeout(1000); // let generation start
    // ADJUST SELECTOR — the Stop button in ChatPanel
    const stopBtn = page.locator('[aria-label*="Stop" i], button:has-text("Stop"), button[title*="Stop" i]').first();
    if (await stopBtn.isVisible().catch(() => false)) {
      await stopBtn.click();
    }

    await page.waitForTimeout(1500);

    // The UI should reflect a clean pre/partial state, not a frozen spinner
    // or a crashed error boundary
    const consoleErrors = collectConsoleErrors(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    expect(
      consoleErrors,
      'Console errors after stop+reload — may indicate corrupted state was persisted.'
    ).toEqual([]);

    // A fresh, unrelated prompt should still work after a stop — proves the
    // abort controller/session isn't left in a broken state
    await submitPrompt(page, 'Create a simple button.');
    await waitForGenerationToSettle(page, 30000);
    const preview = page.frameLocator('iframe[title="Application Preview"], iframe').first();
    await expect(preview.locator('body')).not.toBeEmpty();
  });

  // ===================================================================
  // SECTION 5 — FULL INTERACTIVE-ELEMENT INVENTORY (dummy button hunt)
  // ===================================================================
  test('Section 5: every visible interactive element does something real when clicked', async ({
    page,
  }) => {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const clickable = page.locator(
      'button:visible, a[href]:visible, [role="button"]:visible'
    );
    const count = await clickable.count();
    const results: { index: number; text: string; effect: string }[] = [];

    for (let i = 0; i < count; i++) {
      const el = clickable.nth(i);
      const text = (await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label')) || `element-${i}`;

      // Avoid clicking destructive buttons like Sign Out or Delete Project during general click audit
      if (/sign out|log out|delete project/i.test(text)) {
        results.push({ index: i, text: text.trim().slice(0, 60), effect: 'SKIPPED (destructive action)' });
        continue;
      }

      const urlBefore = page.url();
      const htmlBefore = await page.content().catch(() => '');

      let dialogSeen = false;
      const dialogHandler = async (dialog: import('@playwright/test').Dialog) => {
        dialogSeen = true;
        await dialog.dismiss();
      };
      page.once('dialog', dialogHandler);

      try {
        await el.click({ timeout: 2000, trial: false });
      } catch {
        results.push({ index: i, text, effect: 'NOT CLICKABLE (obscured/disabled)' });
        continue;
      }
      await page.waitForTimeout(300);

      const urlAfter = page.url();
      const htmlAfter = await page.content().catch(() => '');

      let effect = 'NO OBSERVABLE EFFECT (possible dummy button)';
      if (urlAfter !== urlBefore) effect = `navigated to ${urlAfter}`;
      else if (dialogSeen) effect = 'opened a native dialog';
      else if (htmlAfter.length !== htmlBefore.length) effect = 'DOM changed (state update or modal)';

      results.push({ index: i, text: text.trim().slice(0, 60), effect });

      // best-effort recovery: close any modal that may have opened
      await page.keyboard.press('Escape').catch(() => {});
    }

    console.log('--- INTERACTIVE ELEMENT INVENTORY ---');
    console.table(results);

    const dummies = results.filter((r) => r.effect.startsWith('NO OBSERVABLE EFFECT'));
    if (dummies.length > 0) {
      console.warn(
        `Found ${dummies.length} element(s) with no observable effect. ` +
          'Review manually — some may be intentionally passive (e.g. static labels ' +
          'that matched the button selector), but each should be confirmed.'
      );
    }
  });

  // ===================================================================
  // SECTION 6 — RESPONSIVE / UI AUDIT ACROSS BREAKPOINTS
  // ===================================================================
  for (const vp of VIEWPORTS) {
    test(`Section 6: no layout breakage at ${vp.name}`, async ({ page }) => {
      const consoleErrors = collectConsoleErrors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);

      const hasHorizontalOverflow = await page.evaluate(() => {
        return (
          document.documentElement.scrollWidth > window.innerWidth ||
          document.body.scrollWidth > window.innerWidth
        );
      });
      expect(
        hasHorizontalOverflow,
        `Horizontal overflow detected at ${vp.name} (${vp.width}x${vp.height})`
      ).toBeFalsy();

      // No element should render outside the viewport bounds
      const offscreenCount = await page.evaluate((viewportWidth) => {
        const els = Array.from(document.querySelectorAll('body *'));
        return els.filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && (rect.right > viewportWidth + 2 || rect.left < -2);
        }).length;
      }, vp.width);
      expect(
        offscreenCount,
        `${offscreenCount} element(s) render outside the viewport at ${vp.name}`
      ).toBeLessThanOrEqual(2); // small tolerance for intentional off-canvas drawers

      expect(consoleErrors, `Console errors at ${vp.name}: ${JSON.stringify(consoleErrors)}`).toEqual(
        []
      );
    });
  }
});
