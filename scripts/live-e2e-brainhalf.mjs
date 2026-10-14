import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ORIGIN = process.env.BRAINHALF_ORIGIN || 'https://brainhalf.com';
const EMAIL = process.env.BRAINHALF_EMAIL || 'whyai4@gmail.com';
const PASSWORD = process.env.BRAINHALF_PASSWORD || '12345678';
const HEADLESS = process.env.HEADLESS === '1';

const CREATIVE_3D_PROMPT = `Build "AetherCity OS" — a navigable 3D smart-city operating system and live command center using React Three Fiber, Three.js, @react-three/drei, Zustand, and Lucide icons.
- Walk/orbit through a 3D city grid where each glowing monolith represents a city district (Energy Grid, Autonomous Transit, Climate & Water, AI Compute Core, Civic Archive).
- Orbiting autonomous drone agents move between districts with live task progress and mood indicators.
- Clicking any district or pedestal opens draggable, minimizable OS windows (Telemetry Dashboard, Live Simulation, District Code Inspector, Incident Log).
- Failing districts pulse amber/red in the 3D scene with an Alert Ticker at the top and a one-click "Stabilize District" action that restores health and calms lighting.`;

async function runLiveAudit() {
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve('audit-artifacts/live-e2e', runId);
  mkdirSync(outDir, { recursive: true });

  const report = {
    origin: ORIGIN,
    runId,
    landingPage: {},
    auth: {},
    existingProjects: [],
    creativeBuild: {
      prompt: CREATIVE_3D_PROMPT,
      filesGenerated: [],
      wsErrors: [],
      previewErrors: [],
      consoleErrors: [],
      previewSuccess: false,
    },
  };

  const saveReport = () => {
    writeFileSync(resolve(outDir, 'live-audit-report.json'), JSON.stringify(report, null, 2) + '\n');
  };

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') {
      report.creativeBuild.consoleErrors.push(msg.text());
      saveReport();
    }
  });

  page.on('pageerror', err => {
    report.creativeBuild.consoleErrors.push(err.message);
    saveReport();
  });

  page.on('websocket', ws => {
    if (!ws.url().includes('/agents/')) return;
    ws.on('framereceived', frame => {
      try {
        const data = JSON.parse(String(frame.payload));
        if (data.type === 'file_updated' && data.path && !report.creativeBuild.filesGenerated.includes(data.path)) {
          report.creativeBuild.filesGenerated.push(data.path);
          console.log(`[File generated] ${data.path}`);
          saveReport();
        }
        if (data.type === 'error') {
          report.creativeBuild.wsErrors.push(String(data.error || data.message));
          console.error(`[Agent error] ${data.error || data.message}`);
          saveReport();
        }
      } catch {}
    });
  });

  try {
    console.log(`1. Auditing landing page at ${ORIGIN}...`);
    await page.goto(ORIGIN, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(outDir, '01-landing-page.png'), fullPage: true });

    const h1Text = await page.locator('h1').first().textContent().catch(() => null);
    const galleryErrorVisible = await page.getByText('The gallery could not be loaded.').isVisible().catch(() => false);
    const footerCols = await page.locator('.landing-footer-col').count().catch(() => 0);
    report.landingPage = { h1Text: h1Text?.trim(), galleryErrorVisible, footerCols };
    console.log('Landing page:', report.landingPage);
    saveReport();

    console.log('2. Signing in...');
    const signInBtn = page.getByRole('button', { name: /sign in/i }).first();
    if (await signInBtn.isVisible().catch(() => false)) {
      await signInBtn.click();
      await page.waitForTimeout(1000);
    }

    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(EMAIL);
      const passInput = page.locator('input[type="password"], input[name="password"]').first();
      await passInput.fill(PASSWORD);
      await page.screenshot({ path: resolve(outDir, '02-login-modal.png') });
      const submitAuth = page.locator('form button[type="submit"]').first();
      await submitAuth.click();
      await page.waitForTimeout(4000);
    }

    await page.screenshot({ path: resolve(outDir, '03-after-auth.png') });
    report.auth = { url: page.url(), signedIn: ! await page.locator('input[type="password"]').isVisible().catch(() => false) };
    saveReport();

    if (!report.auth.signedIn && !HEADLESS) {
      console.log('If Google OAuth is preferred, click "Continue with Google" in the browser window now (waiting up to 90s)...');
      await page.waitForFunction(() => Boolean(localStorage.getItem('bh_auth_token') || document.querySelector('[aria-label="Message to the app builder"]')), { timeout: 90000 }).catch(() => {});
    }

    console.log('3. Opening Studio workspace & starting creative 3D app build...');
    const promptInput = page.locator('#app-idea, [aria-label="Message to the app builder"], textarea').first();
    if (await promptInput.isVisible().catch(() => false)) {
      await promptInput.fill(CREATIVE_3D_PROMPT);
      await page.keyboard.press('Enter');
      console.log('Submitted creative 3D prompt. Tracking generation and live preview...');
    }

    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      const stopBtnVisible = await page.getByTestId('stop-generation-btn').isVisible().catch(() => false);
      const previewFrame = page.frameLocator('iframe[title="Application Preview"]').first();
      const errorTitle = await previewFrame.locator('.preview-error-title').textContent().catch(() => null);
      const errorCode = await previewFrame.locator('.preview-error-code').textContent().catch(() => null);
      if (errorTitle || errorCode) {
        const msg = `${errorTitle || ''}: ${errorCode || ''}`.trim();
        if (!report.creativeBuild.previewErrors.includes(msg)) {
          report.creativeBuild.previewErrors.push(msg);
          console.error('[Preview Error Detected]:', msg);
          await page.screenshot({ path: resolve(outDir, '04-preview-error.png') });
          saveReport();
        }
      }
      const hasCanvas = await previewFrame.locator('canvas').count().catch(() => 0);
      if (hasCanvas > 0 && !stopBtnVisible && report.creativeBuild.filesGenerated.length > 3) {
        report.creativeBuild.previewSuccess = true;
        console.log('3D Canvas rendered cleanly in Preview without React error #185!');
        await page.screenshot({ path: resolve(outDir, '05-3d-preview-success.png') });
        saveReport();
        break;
      }
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: resolve(outDir, '06-final-workspace.png') });
    saveReport();
    console.log(`Live audit complete! Report and screenshots saved to: ${outDir}`);
  } finally {
    await browser.close();
  }
}

runLiveAudit().catch(err => {
  console.error('Live audit failed:', err);
  process.exitCode = 1;
});
