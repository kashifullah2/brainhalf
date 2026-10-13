/**
 * Full-stack end-to-end timing test.
 *
 * Generates a real full-stack inventory app via BrainHalf, measures every
 * timing milestone, then verifies both the React frontend and the Worker
 * backend API are working in the preview.
 *
 * Run against production:
 *   BASE_URL=https://brainhalf.com BH_SESSION_TOKEN=<your_token> \
 *   npx playwright test tests/fullstack-timing.spec.ts --config playwright.live.config.ts
 *
 * Run against local Worker dev:
 *   BASE_URL=http://localhost:8787 BH_SESSION_TOKEN=bh_dev_local_token_not_a_real_session \
 *   npx playwright test tests/fullstack-timing.spec.ts
 *
 * Required env vars:
 *   BH_SESSION_TOKEN — bearer token from /api/auth/login or localStorage.bh_session_token
 *   BASE_URL         — BrainHalf origin (default: https://brainhalf.com)
 */

import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.BASE_URL || 'https://brainhalf.com').replace(/\/$/, '');
const WS_BASE = BASE_URL.replace(/^http/, 'ws');
const TOKEN = process.env.BH_SESSION_TOKEN || '';

// Unique per run so stale files from previous generations never break the Vite
// build. The hosted-app slot is released at the end of the test so it doesn't
// accumulate. Override with TEST_PROJECT_ID env var for debugging a specific run.
const PROJECT_ID = process.env.TEST_PROJECT_ID || `fullstack-timing-${Date.now()}`;
const WS_URL = `${WS_BASE}/agents/chat-agent/${PROJECT_ID}`;
const PREVIEW_BASE = `${BASE_URL}/preview/${PROJECT_ID}`;

// Prompt deliberately mentions both frontend and backend so the model
// writes /src/App.tsx + /worker/index.ts.
const GENERATION_PROMPT =
  'Build a full-stack inventory tracker. React frontend: show a list of items ' +
  '(name, quantity) fetched from the backend, plus a form to add a new item. ' +
  'Worker backend: GET /api/items returns JSON array, POST /api/items adds an item ' +
  '(body: { name, quantity }). Store items in a module-level array (no DB needed). ' +
  'Start with 3 sample items pre-loaded. Use clean, functional styling.';

const GENERATION_TIMEOUT_MS = 8 * 60 * 1000; // 8 min — extended for large full-stack apps
const RUNTIME_BUILD_TIMEOUT_MS = 4 * 60 * 1000; // 4 min for CF Worker build + previewReady

// ── WebSocket helper ──────────────────────────────────────────────────────────

interface InboxMessage {
  type: string;
  chunk?: { response?: string; done?: boolean };
  path?: string;
  error?: string;
  data?: unknown;
  [key: string]: unknown;
}

function connectWs(): Promise<{ ws: WebSocket; inbox: InboxMessage[] }> {
  return new Promise((resolve, reject) => {
    // The server strips ?token= before verifying the session.
    // Pass the bearer token as an Authorization header instead —
    // the Node.js ws library supports headers on the upgrade request.
    const opts: WebSocket.ClientOptions = TOKEN
      ? { headers: { Authorization: `Bearer ${TOKEN}` } }
      : {};
    const ws = new WebSocket(WS_URL, opts);
    const inbox: InboxMessage[] = [];
    ws.on('message', (raw) => {
      try { inbox.push(JSON.parse(raw.toString())); } catch { /* skip malformed */ }
    });
    ws.once('open', () => resolve({ ws, inbox }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) =>
      reject(new Error(`WS handshake failed: HTTP ${res.statusCode}`))
    );
  });
}

function waitForMessage(
  inbox: InboxMessage[],
  predicate: (m: InboxMessage) => boolean,
  timeoutMs: number
): Promise<InboxMessage> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = setInterval(() => {
      const hit = inbox.find(predicate);
      if (hit) { clearInterval(poll); resolve(hit); return; }
      if (Date.now() > deadline) {
        clearInterval(poll);
        reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
      }
    }, 150);
  });
}

// ── Worker route extractor (test-local) ───────────────────────────────────────
// Returns the first param-free route path that can be probed with a plain
// GET request. Covers two styles the model may generate:
//   1. Chained-router:    app.get('/api/foo', handler)
//   2. if/else dispatch:  url.pathname === '/api/foo'
// extractWorkerRoutes() in api-coverage.ts only handles style 1; style 2 is
// the baseline workers-starter template pattern and must be handled here.
function extractFirstGetRoute(workerSource: string): string | null {
  // Chained-router: definitively a GET handler.
  for (const m of workerSource.matchAll(/\.\s*get\s*\(\s*['"]\/api\/([^'"?#$:*]+)['"]/g)) {
    return '/api/' + m[1];
  }
  // if/else pathname dispatch: any method, but GET is safe to try first.
  for (const m of workerSource.matchAll(/url\.pathname\s*===\s*['"]\/api\/([^'"?#$:*]+)['"]/g)) {
    return '/api/' + m[1];
  }
  return null;
}

// ── Test ──────────────────────────────────────────────────────────────────────

test.describe('Full-stack generation + preview health check', () => {
  // generation + runtime build + preview render + API checks
  test.setTimeout(GENERATION_TIMEOUT_MS + RUNTIME_BUILD_TIMEOUT_MS + 120_000);

  let generatedFiles: string[] = [];
  let generatedFileMap: Record<string, string> = {};
  let timing: Record<string, number> = {};

  test('generates inventory tracker and verifies frontend + backend', async ({ page, request }) => {
    if (!TOKEN) {
      test.skip();
      return;
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Project ID : ${PROJECT_ID}`);
    console.log(`Target     : ${BASE_URL}`);
    console.log(`Preview    : ${PREVIEW_BASE}`);
    console.log(`${'─'.repeat(60)}\n`);

    // ── PHASE 1: Connect via WebSocket ──────────────────────────────────────
    const t0 = Date.now();
    console.log('[1/5] Connecting WebSocket…');
    const { ws, inbox } = await connectWs();
    timing.connected = Date.now() - t0;
    console.log(`      Connected in ${timing.connected}ms`);

    // Wait for history handshake (server sends workspace state on connect).
    await waitForMessage(inbox, m => m.type === 'history', 15_000);
    timing.historyReceived = Date.now() - t0;
    console.log(`      History handshake in ${timing.historyReceived}ms`);

    // ── PHASE 2: Send generation prompt ────────────────────────────────────
    console.log('[2/5] Sending generation prompt…');
    const t1 = Date.now();
    ws.send(JSON.stringify({
      type: 'prompt',
      prompt: GENERATION_PROMPT,
      // Default model: DeepSeek V4 Flash (CF-native, not in disabled list).
      // Override with MODEL env var: MODEL=@cf/moonshotai/kimi-k2.7-code ...
      model: process.env.MODEL || '@cf/deepseek-ai/deepseek-v4-flash-0731',
      provider: process.env.PROVIDER || 'cloudflare',
      idempotencyKey: `timing-test-${PROJECT_ID}-${Date.now()}`,
    }));
    timing.promptSent = Date.now() - t0;

    // Dump every incoming message so we can diagnose unexpected flows.
    const msgLogger = setInterval(() => {
      const recent = inbox.slice(-5);
      if (recent.length) {
        console.log(`      [inbox tail] ${recent.map(m => `{type:${m.type}}`).join(', ')}`);
      }
    }, 10_000);

    // ── PHASE 3: Wait for generation milestones ─────────────────────────────
    console.log('[3/5] Waiting for generation milestones…');

    // Server immediately acks the prompt with generation_notice (or sends an
    // error if the model is disabled / rate-limited / backend not ready).
    const ackMsg = await waitForMessage(
      inbox,
      m => m.type === 'generation_notice' || m.type === 'error',
      30_000
    );
    if (ackMsg.type === 'error') {
      clearInterval(msgLogger);
      ws.close();
      throw new Error(`Server rejected generation: ${ackMsg.error ?? JSON.stringify(ackMsg)}`);
    }
    console.log(`      generation_notice  : "${ackMsg.message}"`);

    // First non-empty stream chunk.
    const firstChunk = await waitForMessage(
      inbox,
      m => (m.type === 'stream' && !m.chunk?.done && !!m.chunk?.response?.trim()) ||
           (m.type === 'error'),
      GENERATION_TIMEOUT_MS
    );
    if (firstChunk.type === 'error') {
      clearInterval(msgLogger);
      ws.close();
      throw new Error(`Error during generation: ${firstChunk.error ?? JSON.stringify(firstChunk)}`);
    }
    timing.firstStreamChunk = Date.now() - t0;
    timing.timeToFirstToken = Date.now() - t1;
    console.log(`      Time to first token : ${timing.timeToFirstToken}ms`);
    console.log(`      First chunk preview : "${String(firstChunk.chunk?.response ?? '').slice(0, 80)}…"`);

    // First file write.
    await waitForMessage(inbox, m => m.type === 'file_updated', GENERATION_TIMEOUT_MS)
      .then(() => { timing.firstFileWrite = Date.now() - t0; })
      .catch(() => { /* some models don't emit mid-stream file events */ });

    // Stream done — generation complete.
    const doneMsg = await waitForMessage(
      inbox,
      m => (m.type === 'stream' && m.chunk?.done === true) || m.type === 'error',
      GENERATION_TIMEOUT_MS
    );
    if (doneMsg.type === 'error') {
      console.warn(`      Generation ended with error: ${doneMsg.error}`);
    }
    timing.generationDone = Date.now() - t0;
    timing.generationMs = Date.now() - t1;
    console.log(`      Generation time     : ${timing.generationMs}ms (${(timing.generationMs / 1000).toFixed(1)}s)`);

    // Collect file paths from inbox events (for summary stats: hasFrontend, hasBackend).
    for (const m of inbox) {
      if (m.type === 'file_updated' && typeof m.path === 'string') {
        generatedFileMap[m.path] = typeof m.content === 'string' ? m.content : '';
      }
    }
    generatedFiles = Object.keys(generatedFileMap);
    console.log(`      Files (events)      : ${generatedFiles.length} (${generatedFiles.slice(0, 6).join(', ')}${generatedFiles.length > 6 ? '…' : ''})`);

    clearInterval(msgLogger);
    ws.close();

    // ── PHASE 3.5: Fetch authoritative snapshot + wait for server-triggered build
    // The server auto-triggers a development preview build when a full-stack
    // generation succeeds. The build uses an extended lease (commandTimeoutMs)
    // so it survives without heartbeats. We only need to poll /status.
    const t1b = Date.now();
    console.log('[3.5] Fetching authoritative project snapshot…');
    const snapshotUrl = `${BASE_URL}/agents/chat-agent/${PROJECT_ID}/snapshot`;
    const snapshotResp = await request.get(snapshotUrl, {
      timeout: 15_000,
      headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
    }).catch(err => { console.warn(`      GET /snapshot failed: ${err.message}`); return null; });

    let buildFiles: Record<string, string> = generatedFileMap;
    if (snapshotResp?.ok()) {
      const snap = await snapshotResp.json().catch(() => null) as Record<string, unknown> | null;
      if (snap?.['files'] && typeof snap['files'] === 'object' && !Array.isArray(snap['files'])) {
        buildFiles = snap['files'] as Record<string, string>;
        const snapCount = Object.keys(buildFiles).length;
        generatedFiles = Object.keys(buildFiles);
        generatedFileMap = buildFiles;
        console.log(`      Snapshot files      : ${snapCount} (revision: ${snap['revision'] ?? 'unknown'})`);
        const eventPaths = Object.keys(generatedFileMap);
        const missing = eventPaths.filter(p => !(p in buildFiles));
        if (missing.length > 0) console.warn(`      Missing in snapshot : ${missing.join(', ')}`);
      }
    } else {
      console.warn(`      Snapshot unavailable (HTTP ${snapshotResp?.status() ?? 'n/a'}) — using event-accumulated files`);
    }

    if (Object.keys(buildFiles).length === 0) {
      throw new Error('No project files available (snapshot failed and no file_updated events collected)');
    }

    // The server auto-triggers the build after generation. Poll /status.
    const statusUrl = `${BASE_URL}/api/projects/${encodeURIComponent(PROJECT_ID)}/runtime/status?environment=development`;
    const buildDeadline = Date.now() + RUNTIME_BUILD_TIMEOUT_MS;
    let buildJobStopped = false;
    let buildReady = false;
    let cfWorkerPreviewUrl: string | null = null;
    console.log(`      Waiting for server-triggered build (timeout ${RUNTIME_BUILD_TIMEOUT_MS / 1000}s)…`);
    while (Date.now() < buildDeadline) {
      await new Promise(r => setTimeout(r, 8_000));
      const statusResp = await request.get(statusUrl, {
        timeout: 15_000,
        headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {},
      }).catch(() => null);
      if (!statusResp?.ok()) continue;
      const statusJson = await statusResp.json().catch(() => null) as Record<string, unknown> | null;
      const jobs = Array.isArray(statusJson?.['jobs']) ? statusJson!['jobs'] as Record<string, unknown>[] : [];
      const latestDevJob = jobs.find(j => j['environment'] === 'development');
      const msg = latestDevJob
        ? `status=${latestDevJob['status']} previewReady=${latestDevJob['previewReady']} — ${latestDevJob['message'] ?? ''}`
        : 'no dev jobs yet';
      console.log(`      Build status        : ${msg}`);

      if (latestDevJob?.['previewReady'] === true && latestDevJob?.['status'] === 'running') {
        buildReady = true; break;
      }
      if (latestDevJob?.['status'] === 'failed') {
        throw new Error(`Runtime build failed: ${latestDevJob['message'] ?? '(no message)'}`);
      }
      if (latestDevJob?.['status'] === 'passed' || latestDevJob?.['status'] === 'stopped') {
        if (typeof statusJson?.['previewUrl'] === 'string') {
          cfWorkerPreviewUrl = statusJson['previewUrl'];
          console.log(`      CF Worker preview   : ${cfWorkerPreviewUrl}`);
        }
        buildJobStopped = true; break;
      }
    }
    timing.runtimeBuildMs = Date.now() - t1b;

    if (!buildReady && !buildJobStopped) {
      throw new Error(`Runtime build did not finish within ${RUNTIME_BUILD_TIMEOUT_MS / 1000}s`);
    }
    console.log(`      Build process       : ${buildReady ? 'server up (previewReady)' : 'job stopped normally — probing Worker…'} (${(timing.runtimeBuildMs / 1000).toFixed(1)}s)`);

    // For CF Worker builds, probe the backend API at the runtime's previewUrl.
    // /preview/<id>/api/* goes through ChatAgent which returns 501 for CF Worker
    // projects (not using simulated API). The real Worker is at previewUrl.
    if (!buildReady && buildJobStopped) {
      const probeRoute = extractFirstGetRoute(buildFiles['/worker/index.ts'] ?? buildFiles['worker/index.ts'] ?? '');
      const probeBase = cfWorkerPreviewUrl ?? PREVIEW_BASE;
      const probeUrl = probeRoute ? `${probeBase}${probeRoute}` : null;
      let probeStatus = 0;
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r => setTimeout(r, 8_000));
        if (!probeUrl) break;
        const probe = await request.get(probeUrl, { timeout: 10_000, headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} }).catch(() => null);
        probeStatus = probe?.status() ?? 0;
        console.log(`      Worker probe (${attempt + 1}/5)   : GET ${probeRoute} → HTTP ${probeStatus}`);
        if (probeStatus !== 501) { buildReady = true; break; }
      }
      if (!buildReady) {
        throw new Error(`CF Worker build stopped but backend still returns ${probeStatus} BACKEND_NOT_RUNNING after 40s`);
      }
    }

    // ── PHASE 4: Verify frontend (Playwright) ──────────────────────────────
    console.log('[4/5] Checking preview frontend…');
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Inject the session cookie so Playwright browser can load the private preview.
    // The runtime Worker reads auth from the bh_session HttpOnly cookie, same as
    // the main app. localStorage alone is not enough for the preview worker.
    if (TOKEN) {
      await page.context().addCookies([{
        name: 'bh_session',
        value: TOKEN,
        domain: new URL(BASE_URL).hostname,
        path: '/',
        httpOnly: true,
        secure: BASE_URL.startsWith('https'),
        sameSite: 'Lax',
      }]);
    }

    const t2 = Date.now();
    const previewResponse = await page.goto(`${PREVIEW_BASE}/index.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    timing.previewLoaded = Date.now() - t0;
    timing.previewLoadMs = Date.now() - t2;

    // HTTP status OK.
    expect(previewResponse?.status(), 'Preview should return 200').toBe(200);
    console.log(`      Preview HTTP status : ${previewResponse?.status()} (${timing.previewLoadMs}ms)`);

    // The preview page uses preview-runtime.js to transpile TypeScript/JSX in
    // the browser on first load ("Preparing your preview..."). Wait up to
    // 120s for the app to mount and render its first visible element.
    console.log('      Waiting for app to render (browser transpile)…');
    const appReady = await page
      .locator('h1, h2, main, [role="main"], .page, .app, form')
      .first()
      .waitFor({ state: 'visible', timeout: 120_000 })
      .then(() => true)
      .catch(() => false);
    timing.previewReadyMs = Date.now() - t2;
    console.log(`      Preview ready in    : ${timing.previewReadyMs}ms (${(timing.previewReadyMs / 1000).toFixed(1)}s)`);

    // Take screenshot of final rendered state.
    await page.screenshot({ path: 'test-results/fullstack-timing-frontend.png', fullPage: true });

    // No JS errors that block the app.
    const criticalErrors = consoleErrors.filter(e =>
      /Uncaught|SyntaxError|ReferenceError|TypeError/.test(e)
    );
    if (criticalErrors.length) {
      console.warn('      Console errors:', criticalErrors);
    }
    expect(criticalErrors.length, `Critical JS errors: ${criticalErrors.join('; ')}`).toBe(0);

    expect(appReady, 'App should render visible content after browser transpile').toBe(true);
    console.log('      App content         : visible ✓');

    console.log('      Screenshot saved    : test-results/fullstack-timing-frontend.png');

    // ── PHASE 5: Verify backend API (direct HTTP) ──────────────────────────
    // Find the first param-free GET route from the generated worker source.
    // extractWorkerRoutes() in api-coverage.ts only handles chained-router
    // syntax (.get('/api/...')); the baseline template uses if/else pathname
    // dispatch — extractFirstGetRoute() (defined above) handles both.
    console.log('[5/5] Checking backend API…');
    const workerSource =
      buildFiles['/worker/index.ts'] ??
      buildFiles['worker/index.ts'] ??
      buildFiles['/worker/index.js'] ??
      buildFiles['worker/index.js'] ?? '';
    const probeRoute = extractFirstGetRoute(workerSource);
    console.log(`      Worker route found  : ${probeRoute ?? '(none — skipping backend probe)'}`);

    const apiHeaders = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
    let backendLive = false;

    // CF Worker projects: previewUrl is the runtime domain (not /preview/<id>/).
    // PREVIEW_BASE routes through ChatAgent which returns 501 for CF Workers.
    const apiBase = cfWorkerPreviewUrl ?? PREVIEW_BASE;

    if (!probeRoute) {
      console.warn('      No GET route extracted from worker source. Skipping backend probe.');
    } else {
      const probeUrl = `${apiBase}${probeRoute}`;
      const t3 = Date.now();
      const apiResponse = await request.get(probeUrl, {
        timeout: 15_000,
        headers: apiHeaders,
      }).catch(err => { throw new Error(`Backend probe GET ${probeRoute} failed: ${err.message}`); });
      timing.backendApiMs = Date.now() - t3;

      const status = apiResponse.status();
      const bodyText = await apiResponse.text();
      console.log(`      GET ${probeRoute.padEnd(20)}: HTTP ${status} (${timing.backendApiMs}ms)`);

      let bodyJson: unknown = null;
      try { bodyJson = JSON.parse(bodyText); } catch { /* not JSON */ }
      const isNotRunning =
        status === 501 ||
        (typeof bodyJson === 'object' && bodyJson !== null &&
         (bodyJson as Record<string, unknown>)['code'] === 'BACKEND_NOT_RUNNING');

      // 2xx / 401 / 403 → Worker is alive (running, auth enforced is fine).
      // 404 / 501 / 502 / 503 / BACKEND_NOT_RUNNING → Worker not live or wrong route.
      const alive = [200, 201, 202, 204, 401, 403].includes(status);
      if (isNotRunning) {
        throw new Error(`BACKEND_NOT_RUNNING after build completed — runtime proxy may need a moment; HTTP ${status}`);
      }
      expect(alive, `Backend ${probeRoute} should be alive (2xx/401/403), got HTTP ${status}: ${bodyText.slice(0, 200)}`).toBe(true);
      backendLive = true;
      console.log(`      Backend alive       : ✓ (HTTP ${status})`);

      // If the route returned JSON data (items list), verify shape and test a write.
      if (status === 200 && Array.isArray(bodyJson)) {
        const items = bodyJson as unknown[];
        console.log(`      Items returned      : ${items.length} (${JSON.stringify(items[0])}…)`);

        // POST a new item to the same base route and verify it appears.
        const postResp = await request.post(`${apiBase}/api/items`, {
          data: { name: 'E2E Widget', quantity: 99 },
          timeout: 10_000,
          headers: apiHeaders,
        }).catch(() => null);
        if (postResp) {
          const postStatus = postResp.status();
          console.log(`      POST /api/items     : HTTP ${postStatus}`);
          if ([200, 201].includes(postStatus)) {
            const refetch = await request.get(`${apiBase}/api/items`, { timeout: 10_000, headers: apiHeaders }).catch(() => null);
            if (refetch) {
              const updated = await refetch.json().catch(() => []) as unknown[];
              const added = (updated as Record<string, unknown>[]).find(it => it['name'] === 'E2E Widget');
              console.log(added
                ? '      POST + re-fetch     : new item persisted ✓'
                : '      POST + re-fetch     : item not found (module-level array resets on restart)');
            }
          }
        }
      }
    }

    // ── Summary ─────────────────────────────────────────────────────────────
    console.log(`\n${'═'.repeat(60)}`);
    console.log(' TIMING SUMMARY');
    console.log(`${'─'.repeat(60)}`);
    console.log(` WebSocket connect       : ${timing.connected}ms`);
    console.log(` History handshake       : ${timing.historyReceived}ms`);
    console.log(` Time to first token     : ${timing.timeToFirstToken}ms`);
    if (timing.firstFileWrite) console.log(` Time to first file write: ${timing.firstFileWrite}ms (from start)`);
    console.log(` Total generation time   : ${timing.generationMs}ms (${(timing.generationMs / 1000).toFixed(1)}s)`);
    console.log(` Runtime build time      : ${timing.runtimeBuildMs !== undefined ? `${timing.runtimeBuildMs}ms (${(timing.runtimeBuildMs / 1000).toFixed(1)}s)` : 'skipped'}`);
    console.log(` Preview page load       : ${timing.previewLoadMs}ms`);
    if (timing.backendApiMs !== undefined) console.log(` Backend first probe     : ${timing.backendApiMs}ms (live: ${backendLive ? 'YES ✓' : 'NO'})`);
    console.log(` Files generated         : ${generatedFiles.length}`);
    const hasFrontend = generatedFiles.some(p => p.includes('App.'));
    const hasBackend  = generatedFiles.some(p => p.includes('worker') || p.includes('server'));
    console.log(` Frontend written (App.*): ${hasFrontend ? '✓' : '✗'}`);
    console.log(` Backend written (worker): ${hasBackend ? '✓' : '✗'}`);
    console.log(`${'═'.repeat(60)}\n`);

    // Final assertions on the generated files.
    expect(hasFrontend, 'Generation should produce a frontend App file').toBe(true);
    expect(hasBackend, 'Generation should produce a backend worker file').toBe(true);
    expect(generatedFiles.length, 'Generation should write at least 3 files').toBeGreaterThanOrEqual(3);

    // ── Cleanup: release the hosted app slot ─────────────────────────────
    // Each successful build consumes one of the account's 10 hosted-app slots.
    // Release it so repeated test runs don't exhaust the limit.
    const slotsResp = await request.get(
      `${BASE_URL}/api/projects/${encodeURIComponent(PROJECT_ID)}/runtime/hosted?environment=development`,
      { timeout: 10_000, headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} }
    ).catch(() => null);
    if (slotsResp?.ok()) {
      const slotsJson = await slotsResp.json().catch(() => null) as Record<string, unknown> | null;
      const slots = Array.isArray(slotsJson?.['hosted']) ? slotsJson!['hosted'] as Record<string, unknown>[] : [];
      const ours = slots.filter(s => s['projectId'] === PROJECT_ID);
      for (const slot of ours) {
        const alias = slot['alias'] as string;
        const live = slot['live'] === true;
        await request.post(
          `${BASE_URL}/api/projects/${encodeURIComponent(PROJECT_ID)}/runtime/hosted/release?environment=development`,
          { data: { alias, force: live }, timeout: 10_000, headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {} }
        ).catch(() => null);
        console.log(`      Released slot       : ${alias} (was live: ${live})`);
      }
    }
  });
});
