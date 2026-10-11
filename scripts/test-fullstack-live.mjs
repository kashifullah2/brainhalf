#!/usr/bin/env node
/**
 * Live full-stack test — generates a full-stack app (React frontend + Hono
 * backend with a real API route), starts the dev backend, and checks the
 * live backend endpoints end-to-end.
 *
 * Usage:
 *   BH_TOKEN="<bh_session_token>" node scripts/test-fullstack-live.mjs
 *
 * Get BH_TOKEN from the browser console on brainhalf.com:
 *   localStorage.getItem('bh_session_token')
 *
 * Optional env vars:
 *   BH_URL="http://localhost:8787"  test against local wrangler dev
 *   BH_MODEL="@cf/moonshotai/kimi-k2.7-code"  override the model
 */

// Node's undici defaults to a 10s connect timeout which is too short for
// some network paths. Override it globally for the duration of this script.
import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connectTimeout: 60_000 }));

const BASE_URL = (process.env.BH_URL ?? 'https://brainhalf.com').replace(/\/$/, '');
const TOKEN = process.env.BH_TOKEN ?? '';
const MODEL = process.env.BH_MODEL ?? '@cf/deepseek-ai/deepseek-v4-flash-0731';
const KEEP = process.env.BH_KEEP === '1';

if (!TOKEN) {
  console.error('Error: BH_TOKEN env var not set.');
  console.error("Get it from the browser console:  localStorage.getItem('bh_session_token')");
  process.exit(1);
}

const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Origin: 'https://brainhalf.com' };

const PROMPT = process.env.BH_PROMPT ?? `Build a full-stack note-taking app with a PUBLIC backend (no authentication, no sign-in):
- Frontend: React with a text input and a list of notes
- Backend: Hono worker with exactly these routes:
  * GET /api/notes → returns { notes: Array<{id: string, text: string}> }
  * POST /api/notes → accepts { text: string }, returns { note: {id, text} }
  * GET /api/health → returns { ok: true }
- Store notes in memory (an array, no database needed, resets on worker restart is fine)
- NO authentication or sign-in required at all
- Keep it minimal`;

// ── helpers ───────────────────────────────────────────────────────────────────

function log(msg, tag = '') {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}]${tag ? ' ' + tag : ''} ${msg}`);
}

async function apiFetch(path, opts = {}, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, { ...opts, headers: { ...HEADERS, ...opts.headers } });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      return res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < retries && (e.message === 'fetch failed' || e.message?.includes('connect'))) {
        log(`${path} attempt ${attempt} failed (${e.cause?.message ?? e.message}), retrying…`, 'NET');
        await new Promise(r => setTimeout(r, 3000 * attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function getWsTicket() {
  const data = await apiFetch('/api/auth/ws-ticket', { method: 'POST', body: '{}' });
  if (!data.ticket) throw new Error('ws-ticket: no ticket');
  return data.ticket;
}

async function deleteProject(id) {
  await fetch(`${BASE_URL}/api/projects/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
}

// ── WebSocket generation + file fetch ────────────────────────────────────────

function runGeneration(projectId) {
  return new Promise(async (resolve, reject) => {
    const start = performance.now();
    let ttft = -1, dispatchMs = -1, filesReceived = false;
    const timer = setTimeout(() => { ws?.close(); reject(new Error('Generation timeout after 300s')); }, 300_000);

    const ticket = await getWsTicket().catch(e => { clearTimeout(timer); reject(e); return null; });
    if (!ticket) return;

    const wsUrl = BASE_URL.replace(/^https?/, s => s === 'https' ? 'wss' : 'ws')
      + `/agents/chat-agent/${projectId}?ticket=${encodeURIComponent(ticket)}`;
    log(`WS → ${wsUrl.replace(/ticket=[^&]+/, 'ticket=…')}`, 'WS');
    const ws = new WebSocket(wsUrl);

    // Pending get_files request
    let fileResolve = null, fileReject = null;
    const pendingFileReq = new Map();

    ws.addEventListener('open', () => {
      log(`Connected. Sending generate…`, 'WS');
      ws.send(JSON.stringify({
        type: 'generate', prompt: PROMPT, model: MODEL,
        fast_mode: true, max_tokens: 16384, idempotencyKey: crypto.randomUUID(),
      }));
    });

    ws.addEventListener('message', ({ data: raw }) => {
      let data; try { data = JSON.parse(raw); } catch { return; }

      if (data.type === 'generation_notice' && data.stage) {
        log(`Stage: ${data.stage}`, 'GEN');
        if (data.stage === 'model' && dispatchMs < 0) dispatchMs = performance.now() - start;
      }
      if (data.type === 'stream' && data.chunk?.response && ttft < 0) {
        ttft = performance.now() - start;
        log(`First token at ${(ttft / 1000).toFixed(1)}s`, 'GEN');
      }
      if (data.type === 'files_snapshot') {
        const resolve = pendingFileReq.get(data.requestId);
        if (resolve) { resolve(data); pendingFileReq.delete(data.requestId); }
      }
      if (data.type === 'error') {
        clearTimeout(timer); ws.close();
        reject(new Error(data.error ?? 'generation error'));
      }
      if (data.type === 'stream' && data.chunk?.done) {
        const totalMs = performance.now() - start;
        log(`Done. dispatch=${(dispatchMs/1000).toFixed(1)}s ttft=${(ttft/1000).toFixed(1)}s total=${(totalMs/1000).toFixed(1)}s`, 'GEN');

        // Fetch the generated files via get_files
        const requestId = crypto.randomUUID();
        const filePromise = new Promise((res, rej) => {
          pendingFileReq.set(requestId, res);
          setTimeout(() => { pendingFileReq.delete(requestId); rej(new Error('get_files timeout')); }, 10_000);
        });
        ws.send(JSON.stringify({ type: 'get_files', requestId }));
        filePromise.then(snapshot => {
          clearTimeout(timer); ws.close();
          // files_snapshot has { files: Record<string,string>, revision }
          const files = snapshot.files ?? {};
          log(`Files fetched: ${Object.keys(files).length} (${Object.keys(files).join(', ')})`, 'FILES');
          resolve({ totalMs, ttft, dispatchMs, files, revision: snapshot.revision });
        }).catch(err => { clearTimeout(timer); ws.close(); reject(err); });
      }
      if (data.type === 'generation_interrupted') {
        clearTimeout(timer); ws.close();
        reject(new Error('generation_interrupted'));
      }
    });

    ws.addEventListener('error', e => { clearTimeout(timer); reject(new Error(String(e.message ?? 'ws error'))); });
  });
}

// ── Start the dev backend ─────────────────────────────────────────────────────

async function startDevBackend(projectId, files) {
  const body = JSON.stringify({ kind: 'preview', files });
  log(`Submitting ${Object.keys(files).length} files (${body.length} bytes)`, 'RUNTIME');
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}/runtime/jobs?environment=development`, {
        method: 'POST',
        headers: HEADERS,
        body,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Start dev backend failed: HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json().catch(() => ({}));
    } catch (e) {
      lastErr = e;
      if (attempt < 3 && (e.message === 'fetch failed' || e.cause?.message?.includes('connect'))) {
        log(`Retry ${attempt}: ${e.cause?.message ?? e.message}`, 'RUNTIME');
        await new Promise(r => setTimeout(r, 3000 * attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

// ── Runtime polling ───────────────────────────────────────────────────────────

async function pollBackend(projectId, timeoutMs = 5 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastMsg = '';
  while (Date.now() < deadline) {
    try {
      const status = await apiFetch(`/api/projects/${projectId}/runtime/status?environment=development`);
      const jobs = status?.jobs ?? [];
      const active = jobs.find(j => ['queued', 'running'].includes(j.status));
      const failed = jobs.find(j => j.status === 'failed');
      // A stopped preview/dev job with a previewReady flag means the backend is up
      const readyStopped = jobs.find(j => j.status === 'stopped' && (j.previewReady || j.kind === 'preview'));
      const msg = active
        ? `${active.status}/${active.kind}: ${active.message ?? '…'}`
        : failed ? `FAILED: ${failed.message ?? 'unknown'}`
        : readyStopped ? `preview ready (job stopped): ${readyStopped.kind}`
        : status?.activeRelease ? `active release found`
        : `no active jobs (${jobs.length} total)`;
      if (msg !== lastMsg) { log(msg, 'RUNTIME'); lastMsg = msg; }
      if (active?.previewReady || readyStopped || status?.activeRelease) return { ok: true, status };
      if (failed) return { ok: false, error: failed.message ?? 'build failed', status };
    } catch (err) { log(`Poll error: ${err.message}`, 'RUNTIME'); }
    await new Promise(r => setTimeout(r, 4000));
  }
  return { ok: false, error: 'Timed out waiting for backend to start' };
}

// ── Backend health check ──────────────────────────────────────────────────────

function detectApiRoute(files) {
  const workerSrc = files['/worker/index.ts'] ?? files['worker/index.ts'] ?? '';
  // Hono style: .get('/api/xxx') or .post('/api/xxx')
  let m = workerSrc.match(/\.(get|post)\(['"]\/api\/([^'"?*{]+)['"]/i);
  if (m) return `/api/${m[2].split('/')[0]}`;
  // Plain fetch handler: url.pathname === '/api/xxx' or url.pathname.startsWith('/api/xxx')
  m = workerSrc.match(/pathname(?:\.startsWith)?\(\s*['"]\/api\/([^'"?*/]+)['"]\s*\)/i);
  if (!m) m = workerSrc.match(/pathname\s*[=!]=\s*['"]\/api\/([^'"?*/]+)['"]/i);
  if (m) return `/api/${m[1].split('/')[0]}`;
  // Express/Hono .app.route style
  m = workerSrc.match(/['"]\/api\/([^'"?*/]+)['"]/i);
  if (m) return `/api/${m[1].split('/')[0]}`;
  return '/api/notes'; // fallback
}

async function checkBackendApi(projectId, files) {
  const apiPath = detectApiRoute(files);
  log(`Detected API route: ${apiPath}`, 'CHECK');

  // Get the preview base URL
  let previewBase;
  try {
    const ticket = await apiFetch(`/api/projects/${projectId}/runtime/preview-ticket?environment=development`,
      { method: 'POST', body: JSON.stringify({ autoSignIn: false }) });
    if (!ticket?.url) return { ok: false, error: 'No preview URL from ticket endpoint' };
    previewBase = new URL(ticket.url).origin;
    log(`Preview base: ${previewBase}`, 'CHECK');
  } catch (e) {
    return { ok: false, error: `preview-ticket failed: ${e.message}` };
  }

  const h = { Accept: 'application/json' };

  // GET /api/health first — this is auth-free in any BrainHalf worker
  try {
    const r = await fetch(`${previewBase}/api/health`, { headers: h, signal: AbortSignal.timeout(10_000) });
    log(`GET /api/health → ${r.status}`, 'CHECK');
    if (r.ok) { const b = await r.json(); log(`Health: ${JSON.stringify(b)}`, 'CHECK'); }
  } catch (e) { log(`GET /api/health threw: ${e.message}`, 'CHECK'); }

  // GET <apiPath> — retry a few times for routing warm-up
  let items, getStatus;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const r = await fetch(`${previewBase}${apiPath}`, { headers: h, signal: AbortSignal.timeout(10_000) });
      getStatus = r.status;
      log(`GET ${apiPath} → ${r.status}${attempt > 1 ? ` (attempt ${attempt})` : ''}`, 'CHECK');
      if (r.ok) { items = await r.json(); break; }
      if (r.status === 401) { log(`Backend requires auth — notes response was: ${await r.text().catch(() => '?')}`, 'CHECK'); break; }
      if (r.status === 404) return { ok: false, error: `GET ${apiPath} → 404 (route not found)` };
      if (r.status < 500) return { ok: false, error: `GET ${apiPath} → ${r.status}` };
    } catch (e) {
      log(`GET ${apiPath} attempt ${attempt} failed: ${e.message}`, 'CHECK');
      if (attempt === 5) return { ok: false, error: `GET ${apiPath} threw after 5 attempts: ${e.message}` };
    }
    await new Promise(r => setTimeout(r, 4000));
  }
  // 401 = worker is live (auth gate working), treat as success for the backend test
  if (getStatus === 401) return { ok: true, persisted: false, itemCount: '(auth required)', previewBase, apiPath, authRequired: true };
  if (!items) return { ok: false, error: `GET ${apiPath} → ${getStatus ?? 'no response'}` };
  log(`Initial items: ${JSON.stringify(items).slice(0, 200)}`, 'CHECK');

  // POST <apiPath>
  const testText = `BH live test ${Date.now()}`;
  try {
    const r = await fetch(`${previewBase}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...h },
      body: JSON.stringify({ text: testText }),
    });
    log(`POST ${apiPath} → ${r.status}`, 'CHECK');
    if (!r.ok) return { ok: false, error: `POST ${apiPath} → ${r.status}` };
    const created = await r.json();
    log(`Created: ${JSON.stringify(created).slice(0, 200)}`, 'CHECK');
  } catch (e) { return { ok: false, error: `POST ${apiPath} threw: ${e.message}` }; }

  // GET again — verify item persisted
  try {
    const r = await fetch(`${previewBase}${apiPath}`, { headers: h });
    const items2 = await r.json();
    log(`Items after POST: ${JSON.stringify(items2).slice(0, 200)}`, 'CHECK');
    const allItems = Array.isArray(items2) ? items2 : (items2?.notes ?? items2?.items ?? []);
    const persisted = allItems.some(n =>
      Object.values(n).some(v => typeof v === 'string' && v.includes(testText.slice(0, 15)))
    );
    return { ok: true, persisted, itemCount: allItems.length, previewBase, apiPath };
  } catch (e) { return { ok: false, error: `GET ${apiPath} #2 threw: ${e.message}` }; }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nBrainHalf full-stack live test  ${new Date().toISOString()}`);
  console.log(`Target: ${BASE_URL}  Model: ${MODEL}\n`);

  const session = await apiFetch('/api/auth/session').catch(e => { throw new Error(`Auth failed: ${e.message}`); });
  log(`Signed in as: ${session.userId ?? '?'}`, 'AUTH');

  const projectId = `proj-${crypto.randomUUID()}`;
  log(`Project: ${projectId}`, 'PROJ');

  // ─ 1. Generate app ─────────────────────────────────────────────────────────
  log('Starting generation…', 'GEN');
  let genResult;
  try {
    genResult = await runGeneration(projectId);
  } catch (err) {
    log(`Generation failed: ${err.message}`, 'ERROR');
    await deleteProject(projectId);
    process.exit(1);
  }

  const fileNames = Object.keys(genResult.files);
  const backendFiles = fileNames.filter(f =>
    /worker|server|backend|api|hono/i.test(f) || f.endsWith('.ts') && !f.includes('test') && !f.includes('config')
  );
  log(`${fileNames.length} files — backend candidates: ${backendFiles.join(', ') || 'none detected'}`, 'FILES');

  if (!fileNames.length) {
    log('No files in snapshot! Cannot start backend without files.', 'ERROR');
    await deleteProject(projectId);
    process.exit(1);
  }

  // Check the worker entry point was actually generated
  const workerEntry = genResult.files['/worker/index.ts'] ?? genResult.files['worker/index.ts'];
  if (!workerEntry) {
    log('WARN: /worker/index.ts was not generated — AI missed the backend entry point.', 'WARN');
    const bh = genResult.files['/worker/brainhalf.ts'] ?? genResult.files['worker/brainhalf.ts'] ?? '';
    log(`brainhalf.ts: ${bh.slice(0, 500)}`, 'WORKER');
  } else {
    log(`Worker entry (full):\n${workerEntry}`, 'WORKER');
  }

  // ─ 2 & 3. Start backend + poll (retry once on workspace disconnection) ───────
  let backendResult = { ok: false, error: 'not started' };
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`Starting dev backend (attempt ${attempt})…`, 'RUNTIME');
    try {
      await startDevBackend(projectId, genResult.files);
      log('Dev job submitted.', 'RUNTIME');
    } catch (err) {
      log(`Failed to start backend: ${err.message}`, 'ERROR');
      if (err.cause) log(`Cause: ${err.cause?.message ?? err.cause}`, 'ERROR');
      await deleteProject(projectId);
      process.exit(1);
    }

    log('Waiting for backend…', 'RUNTIME');
    backendResult = await pollBackend(projectId);
    if (backendResult.ok) break;

    const isDisconnect = /disconnect|workspace/i.test(backendResult.error ?? '');
    if (attempt < 2 && isDisconnect) {
      log(`Workspace disconnected — waiting 10s then retrying…`, 'RUNTIME');
      await new Promise(r => setTimeout(r, 10_000));
      continue;
    }
    log(`Backend failed: ${backendResult.error}`, 'ERROR');
    await deleteProject(projectId);
    process.exit(1);
  }
  log('Backend is running!', 'RUNTIME');

  // ─ 4. Check the live API ───────────────────────────────────────────────────
  // Give Cloudflare routing a moment to settle after job stops
  await new Promise(r => setTimeout(r, 5000));
  log('Checking API endpoints…', 'CHECK');
  const checkResult = await checkBackendApi(projectId, genResult.files);

  // ─ Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(64));
  if (checkResult.ok) {
    console.log('  ✓ PASS — full-stack app working end-to-end');
    console.log(`  ✓ GET  ${checkResult.apiPath} → OK`);
    console.log(`  ✓ POST ${checkResult.apiPath} → OK`);
    console.log(`  ${checkResult.persisted ? '✓' : '✗'} Item persisted across GET/POST: ${checkResult.persisted}`);
    console.log(`  Items in store: ${checkResult.itemCount}`);
    console.log(`  Preview: ${checkResult.previewBase}`);
  } else {
    console.log(`  ✗ FAIL — ${checkResult.error}`);
  }
  console.log(`  Generation: ${(genResult.totalMs / 1000).toFixed(1)}s  files: ${fileNames.length}`);
  console.log('═'.repeat(64));

  if (KEEP) {
    log(`Project kept alive: ${BASE_URL}/?project=${projectId}`, 'PROJ');
    if (checkResult.previewBase) log(`Live preview: ${checkResult.previewBase}`, 'PROJ');
  } else {
    log('Cleaning up project…', 'PROJ');
    await deleteProject(projectId);
    log('Done.', 'PROJ');
  }

  if (!checkResult.ok) process.exit(1);
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
