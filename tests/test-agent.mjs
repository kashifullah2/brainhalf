#!/usr/bin/env node
/**
 * ChatAgent end-to-end test harness
 * ----------------------------------
 * Exercises the agent from the OUTSIDE, the way a real client/browser would:
 * WebSocket lifecycle, HTTP preview serving, auth, rate limiting, checkpoints,
 * file deletion, and a genuine self-healing loop (break code -> observe error
 * captured -> ask agent to fix -> verify preview recovers).
 *
 * USAGE
 *   npm install ws
 *   WORKER_URL="https://your-worker.example.workers.dev" \
 *   AGENT_PATH="/agents/chat-agent/test-session-1" \
 *   AUTH_TOKEN="your-shared-secret" \
 *   node test-agent.mjs
 *
 * WORKER_URL   - origin of your deployed Worker (no trailing slash)
 * AGENT_PATH   - path that routes to a specific ChatAgent DO instance
 * AUTH_TOKEN   - value of AGENT_SHARED_SECRET configured on the Worker
 *                (omit or leave blank if you haven't set that secret yet —
 *                the auth tests will then assert the "open" dev-mode behavior
 *                instead of the "rejected" behavior)
 *
 * Each test is independent and prints PASS/FAIL with a reason. A summary
 * table is printed at the end. Exit code is non-zero if any REQUIRED test
 * fails (self-healing / model-behavior tests are marked informational since
 * they depend on live model output and aren't strictly deterministic).
 */

import WebSocket from 'ws';

const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const AGENT_PATH = process.env.AGENT_PATH || '/agents/chat-agent/test-session';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const WS_URL = WORKER_URL.replace(/^http/, 'ws') + AGENT_PATH;
const HTTP_URL = WORKER_URL + AGENT_PATH;

const results = [];
function record(name, pass, detail, informational = false) {
  results.push({ name, pass, detail, informational });
  const tag = informational ? (pass ? 'INFO ' : 'WARN ') : (pass ? 'PASS ' : 'FAIL ');
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function withToken(url) {
  if (!AUTH_TOKEN) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(AUTH_TOKEN)}`;
}

// Opens a WS connection, resolves once 'open' fires. Attaches a message
// buffer + waitFor helper for assertions.
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    ws.on('message', raw => {
      try { inbox.push(JSON.parse(raw.toString())); } catch { inbox.push({ raw: raw.toString() }); }
    });
    ws.once('open', () => resolve({ ws, inbox }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => {
      reject(new Error(`Unexpected response: ${res.statusCode}`));
    });
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

// Polls inbox until predicate matches an item or timeout elapses.
async function waitFor(inbox, predicate, timeoutMs = 15000, pollMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await sleep(pollMs);
  }
  return null;
}

function closeQuiet(ws) {
  try { ws.close(); } catch {}
}

// ---------------------------------------------------------------------------
// TEST 1: Unauthorized WebSocket connection is rejected (only meaningful if
// AGENT_SHARED_SECRET is actually configured on the Worker).
// ---------------------------------------------------------------------------
async function testAuthRejection() {
  if (!AUTH_TOKEN) {
    record('1. Auth rejection (no token)', true, 'AUTH_TOKEN not provided — skipping strict check, agent should be in open dev-mode', true);
    return;
  }
  try {
    const { ws, inbox } = await connect(WS_URL); // deliberately no token
    const unauthMsg = await waitFor(inbox, m => m.type === 'error' && /unauthor/i.test(m.error || ''), 4000);
    closeQuiet(ws);
    record('1. Auth rejection (no token)', !!unauthMsg, unauthMsg ? 'server sent Unauthorized error' : 'connection succeeded without rejection — check isAuthorized wiring');
  } catch (e) {
    // A hard socket-level rejection (401 on upgrade) is also an acceptable pass.
    record('1. Auth rejection (no token)', true, `connection rejected at transport level: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// TEST 2: Authorized WebSocket connection succeeds and receives history.
// ---------------------------------------------------------------------------
async function testAuthSuccessAndHistory() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    const history = await waitFor(inbox, m => m.type === 'history', 5000);
    closeQuiet(ws);
    record('2. Authorized connect + history load', !!history, history ? `received ${history.data?.length ?? 0} prior messages` : 'no history message received');
  } catch (e) {
    record('2. Authorized connect + history load', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 3: "New project" flow — clear chat + replace_all files — simulating a
// user starting a fresh project in an existing session at runtime.
// ---------------------------------------------------------------------------
async function testNewProjectCreation() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    send(ws, { type: 'clear' });
    const cleared = await waitFor(inbox, m => m.type === 'history' && Array.isArray(m.data) && m.data.length === 0, 5000);

    send(ws, {
      type: 'sync_files',
      replace_all: true,
      files: {
        '/src/App.jsx': `export default function App(){ return <div id="fresh-project">Fresh Project Marker</div>; }`,
        '/src/styles.css': `#fresh-project { color: lime; }`
      }
    });
    await sleep(1000); // sync_files has no ack message by design; give it a beat

    closeQuiet(ws);
    record('3. New project creation at runtime', !!cleared, cleared ? 'history cleared and files replaced' : 'clear did not produce empty history ack');
  } catch (e) {
    record('3. New project creation at runtime', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 4: Preview HTML shell is served and contains the mount harness.
// ---------------------------------------------------------------------------
async function testPreviewHtmlServed() {
  try {
    const res = await fetch(withToken(`${HTTP_URL.replace('/agents/', '/agents-http-shim/')}`), { redirect: 'manual' }).catch(() => null);
    // Fallback: hit the documented /preview/:id/ route directly if the above
    // shim path doesn't apply to your router — adjust PREVIEW_URL below to
    // match your actual routing (Agents SDK routes vary by project).
    const previewUrl = withToken(`${HTTP_URL}/preview/test/`);
    const previewRes = await fetch(previewUrl);
    const body = await previewRes.text();
    const ok = previewRes.status === 200 && body.includes('BrainHalf Edge Preview');
    record('4. Preview HTML shell served', ok, `status=${previewRes.status}, contains mount harness=${body.includes('mountApp')}`);
    return { setCookie: previewRes.headers.get('set-cookie') };
  } catch (e) {
    record('4. Preview HTML shell served', false, e.message);
    return {};
  }
}

// ---------------------------------------------------------------------------
// TEST 5: Preview sub-resource (relative asset) loads via the cookie set by
// test 4, WITHOUT the token in the query string — proves the cookie fallback
// for relative imports actually works and doesn't 401.
// ---------------------------------------------------------------------------
async function testPreviewCookieFallback(cookie) {
  if (AUTH_TOKEN && !cookie) {
    record('5. Preview sub-resource via cookie (no token)', false, 'no Set-Cookie received from test 4 — cookie auth path did not fire');
    return;
  }
  try {
    const assetUrl = `${HTTP_URL}/preview/test/src/App.jsx`; // deliberately no ?token=
    const res = await fetch(assetUrl, {
      headers: cookie ? { Cookie: cookie.split(';')[0] } : {}
    });
    const ok = res.status === 200;
    record('5. Preview sub-resource via cookie (no token)', ok, `status=${res.status}`);
  } catch (e) {
    record('5. Preview sub-resource via cookie (no token)', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 6: Preview sub-resource WITHOUT token or cookie is rejected when auth
// is configured.
// ---------------------------------------------------------------------------
async function testPreviewUnauthorizedAsset() {
  if (!AUTH_TOKEN) {
    record('6. Preview asset rejected without auth', true, 'AUTH_TOKEN not set — skipping strict check', true);
    return;
  }
  try {
    const res = await fetch(`${HTTP_URL}/preview/test/src/App.jsx`);
    record('6. Preview asset rejected without auth', res.status === 401, `status=${res.status}`);
  } catch (e) {
    record('6. Preview asset rejected without auth', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 7: Rate limiting kicks in after RATE_LIMIT_MAX_MESSAGES rapid sends.
// ---------------------------------------------------------------------------
async function testRateLimiting() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    // Spam more than the configured limit (20) with cheap 'stop' messages so
    // we don't burn LLM spend just to trigger the limiter.
    for (let i = 0; i < 30; i++) {
      send(ws, { type: 'stop' });
    }
    const limited = await waitFor(inbox, m => m.type === 'error' && /rate limit/i.test(m.error || ''), 5000);
    closeQuiet(ws);
    record('7. Rate limiting enforced', !!limited, limited ? 'server rejected excess messages' : 'no rate-limit error observed — check RATE_LIMIT_MAX_MESSAGES / wiring');
  } catch (e) {
    record('7. Rate limiting enforced', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 8: A real chat prompt streams tokens and eventually a file_updated
// event, then a stream-done signal. Exercises the full model round trip.
// ---------------------------------------------------------------------------
async function testChatStreamingAndFileWrite() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    send(ws, { type: 'prompt', prompt: 'Change the App.jsx heading text to say "Hello Test Suite".' });

    const firstChunk = await waitFor(inbox, m => m.type === 'stream' && m.chunk?.response, 20000);
    const fileUpdate = await waitFor(inbox, m => m.type === 'file_updated', 60000);
    const done = await waitFor(inbox, m => m.type === 'stream' && m.chunk?.done === true, 60000);

    closeQuiet(ws);
    record('8. Chat streaming produces output', !!firstChunk, firstChunk ? 'received streamed text chunks' : 'no streamed text observed');
    record('8b. Model wrote a file in response', !!fileUpdate, fileUpdate ? `wrote ${fileUpdate.path}` : 'no file_updated event — model may have replied without code', true);
    record('8c. Stream terminated cleanly', !!done, done ? 'received done=true' : 'stream never signaled completion');
  } catch (e) {
    record('8. Chat streaming produces output', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 9: Mid-stream stop actually halts generation (no further stream
// chunks arrive after 'stop' + a grace period, beyond one in-flight chunk).
// ---------------------------------------------------------------------------
async function testStopMidGeneration() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    send(ws, { type: 'prompt', prompt: 'Write a very long, detailed 500-line React component with extensive comments explaining every line.' });
    await waitFor(inbox, m => m.type === 'stream' && m.chunk?.response, 15000);

    const countBeforeStop = inbox.filter(m => m.type === 'stream').length;
    send(ws, { type: 'stop' });
    await sleep(3000);
    const countAfterGrace = inbox.filter(m => m.type === 'stream').length;

    closeQuiet(ws);
    // Allow a small number of in-flight chunks to land after stop is sent,
    // but generation should not have kept streaming indefinitely.
    const growth = countAfterGrace - countBeforeStop;
    record('9. Stop halts generation', growth < 20, `stream messages after stop: +${growth} (expect a small, bounded number)`);
  } catch (e) {
    record('9. Stop halts generation', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 10: delete_file removes a file and emits file_deleted.
// ---------------------------------------------------------------------------
async function testDeleteFile() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    send(ws, { type: 'sync_files', files: { '/src/ToDelete.jsx': 'export default function ToDelete(){return null;}' } });
    await sleep(500);

    send(ws, { type: 'delete_file', path: '/src/ToDelete.jsx' });
    const deleted = await waitFor(inbox, m => m.type === 'file_deleted' && m.path === '/src/ToDelete.jsx', 5000);

    closeQuiet(ws);
    record('10. delete_file removes file', !!deleted, deleted ? 'file_deleted event received' : 'no file_deleted event observed');
  } catch (e) {
    record('10. delete_file removes file', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 11-13: Checkpoint save / list / restore round trip.
// ---------------------------------------------------------------------------
async function testCheckpoints() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    send(ws, { type: 'sync_files', replace_all: true, files: { '/src/App.jsx': 'export default function App(){return <div>V1</div>;}' } });
    await sleep(500);

    send(ws, { type: 'checkpoint_save', label: 'v1' });
    const saved = await waitFor(inbox, m => m.type === 'checkpoint_saved', 5000);
    record('11. Checkpoint save', !!saved, saved ? `checkpoint id=${saved.id}` : 'no checkpoint_saved event');

    send(ws, { type: 'sync_files', replace_all: true, files: { '/src/App.jsx': 'export default function App(){return <div>V2 — changed</div>;}' } });
    await sleep(500);

    send(ws, { type: 'checkpoint_list' });
    const list = await waitFor(inbox, m => m.type === 'checkpoint_list', 5000);
    const found = list?.data?.some(c => c.id === saved?.id);
    record('12. Checkpoint list', !!found, found ? 'saved checkpoint appears in list' : 'saved checkpoint missing from list');

    if (saved?.id) {
      send(ws, { type: 'checkpoint_restore', id: saved.id });
      const restored = await waitFor(inbox, m => m.type === 'checkpoint_restored', 5000);
      const fileBack = await waitFor(inbox, m => m.type === 'file_updated' && m.path === '/src/App.jsx' && m.content.includes('V1'), 5000);
      record('13. Checkpoint restore', !!restored && !!fileBack, restored ? 'restore event + V1 content confirmed back' : 'restore did not roll back file content');
    } else {
      record('13. Checkpoint restore', false, 'skipped — no checkpoint id from save step');
    }

    closeQuiet(ws);
  } catch (e) {
    record('11-13. Checkpoint save/list/restore', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 14: rewrite_history overwrites message log as expected.
// ---------------------------------------------------------------------------
async function testRewriteHistory() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    send(ws, {
      type: 'rewrite_history',
      messages: [
        { role: 'user', content: 'synthetic test message' },
        { role: 'assistant', content: 'synthetic test reply' }
      ]
    });
    await sleep(500);

    closeQuiet(ws);
    const { ws: ws2, inbox: inbox2 } = await connect(withToken(WS_URL));
    const history2 = await waitFor(inbox2, m => m.type === 'history', 5000);
    closeQuiet(ws2);

    const matches = history2?.data?.some(m => m.content === 'synthetic test message');
    record('14. rewrite_history persists', !!matches, matches ? 'synthetic history confirmed on reconnect' : 'synthetic message not found after reconnect');
  } catch (e) {
    record('14. rewrite_history persists', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 15: Disconnect/reconnect preserves state (Durable Object persistence,
// not an in-memory-only illusion).
// ---------------------------------------------------------------------------
async function testReconnectPersistence() {
  try {
    const marker = `persist-check-${Date.now()}`;
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);
    send(ws, { type: 'sync_files', files: { '/src/PersistMarker.txt': marker } });
    await sleep(500);
    closeQuiet(ws);

    await sleep(500);

    const { ws: ws2 } = await connect(withToken(WS_URL));
    const assetRes = await fetch(withToken(`${HTTP_URL}/preview/test/PersistMarker.txt`));
    const body = await assetRes.text().catch(() => '');
    closeQuiet(ws2);

    record('15. State persists across reconnect', body.includes(marker), body.includes(marker) ? 'marker file survived disconnect' : `marker not found (status=${assetRes.status})`);
  } catch (e) {
    record('15. State persists across reconnect', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 16: write_file tool rejects syntactically broken JSX (server-side
// validation gate added in the "big functional fixes" pass).
// This is exercised indirectly: we can't force the model to emit broken
// code on demand, so we validate the same guarantee via sync_files (which
// intentionally does NOT validate, by design, since it's a bulk import path)
// followed by a direct preview fetch to confirm the transpile-error path
// fires and is caught server-side rather than crashing the Worker.
// ---------------------------------------------------------------------------
async function testBrokenSyntaxHandling() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);
    send(ws, { type: 'sync_files', files: { '/src/Broken.jsx': 'export default function Broken( { return <div>unclosed' } });
    await sleep(500);
    closeQuiet(ws);

    const res = await fetch(withToken(`${HTTP_URL}/preview/test/Broken.jsx`));
    const body = await res.text();
    const handledGracefully = res.status === 200 && /TranspileErrorView|Transpile Error/.test(body);
    record('16. Broken syntax handled without crashing', handledGracefully, `status=${res.status}, graceful fallback rendered=${handledGracefully}`);
  } catch (e) {
    record('16. Broken syntax handled without crashing', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 17 (SELF-HEALING LOOP): the flagship test.
//   a) Inject broken code directly (bypassing model + write_file validation).
//   b) Hit /preview/ to force the transpile error, which should persist to
//      agent_state.last_preview_error.
//   c) Send a follow-up prompt asking the agent to "fix the app" WITHOUT
//      telling it what's wrong.
//   d) Assert the model's response references the error and/or that the
//      resulting file_updated content is valid, syntactically clean JSX,
//      and that a subsequent preview fetch succeeds.
// This is inherently non-deterministic (depends on live model behavior), so
// it's marked informational rather than a hard pass/fail gate.
// ---------------------------------------------------------------------------
async function testSelfHealingLoop() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    // a) Inject broken App.jsx directly.
    send(ws, { type: 'sync_files', replace_all: true, files: {
      '/src/App.jsx': 'export default function App() { return <div>Missing closing tag'
    }});
    await sleep(500);

    // b) Force the transpile error to be observed and persisted server-side.
    await fetch(withToken(`${HTTP_URL}/preview/test/App.jsx`));
    await sleep(500);

    // c) Ask the agent to fix it, deliberately vague.
    send(ws, { type: 'prompt', prompt: 'The preview is broken, please fix it.' });

    const fileUpdate = await waitFor(inbox, m => m.type === 'file_updated' && m.path.includes('App.jsx'), 60000);
    await waitFor(inbox, m => m.type === 'stream' && m.chunk?.done === true, 60000);
    closeQuiet(ws);

    if (!fileUpdate) {
      record('17. Self-healing loop', false, 'agent never rewrote App.jsx after being told the preview was broken', true);
      return;
    }

    // d) Verify the fix actually parses and the preview now serves cleanly.
    const previewRes = await fetch(withToken(`${HTTP_URL}/preview/test/App.jsx`));
    const previewBody = await previewRes.text();
    const looksFixed = previewRes.status === 200 && !/TranspileErrorView/.test(previewBody);

    record('17. Self-healing loop', looksFixed, looksFixed
      ? 'agent rewrote App.jsx and the preview now transpiles cleanly'
      : 'agent wrote a file but the preview still shows a transpile error — fix was incomplete',
      true);
  } catch (e) {
    record('17. Self-healing loop', false, e.message, true);
  }
}

// ---------------------------------------------------------------------------
// TEST 18: Concurrent connections both receive broadcasted file updates
// (multiplayer wiring sanity check — not conflict *resolution*, just fan-out).
// ---------------------------------------------------------------------------
async function testMultiConnectionBroadcast() {
  try {
    const { ws: wsA, inbox: inboxA } = await connect(withToken(WS_URL));
    const { ws: wsB, inbox: inboxB } = await connect(withToken(WS_URL));
    await waitFor(inboxA, m => m.type === 'history', 5000);
    await waitFor(inboxB, m => m.type === 'history', 5000);

    send(wsA, { type: 'sync_files', files: { '/src/BroadcastCheck.jsx': 'export default function B(){return null;}' } });
    // sync_files doesn't broadcast (only write_file/edit paths do) — use
    // delete_file, which does broadcast, as the observable signal instead.
    await sleep(300);
    send(wsA, { type: 'delete_file', path: '/src/BroadcastCheck.jsx' });

    const seenOnB = await waitFor(inboxB, m => m.type === 'file_deleted' && m.path === '/src/BroadcastCheck.jsx', 5000);
    closeQuiet(wsA);
    closeQuiet(wsB);
    record('18. Multi-connection broadcast', !!seenOnB, seenOnB ? 'second connection observed first connection\'s delete' : 'broadcast not received on second connection');
  } catch (e) {
    record('18. Multi-connection broadcast', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 19: Malformed JSON message doesn't crash the DO (error is caught and
// reported, connection stays usable for the next message).
// ---------------------------------------------------------------------------
async function testMalformedMessageResilience() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    ws.send('{not valid json');
    await sleep(1000);

    // Connection should still be alive and respond to a normal message.
    send(ws, { type: 'stop' });
    await sleep(500);
    const stillAlive = ws.readyState === WebSocket.OPEN;
    closeQuiet(ws);
    record('19. Malformed message does not crash session', stillAlive, stillAlive ? 'socket remained open after garbage input' : 'socket dropped after malformed message');
  } catch (e) {
    record('19. Malformed message does not crash session', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// TEST 20: Loop / iteration — repeated small edits in sequence (simulating a
// user iterating many times in one session) all land correctly and in order.
// ---------------------------------------------------------------------------
async function testIterativeEditLoop() {
  try {
    const { ws, inbox } = await connect(withToken(WS_URL));
    await waitFor(inbox, m => m.type === 'history', 5000);

    let allOk = true;
    for (let i = 1; i <= 5; i++) {
      send(ws, { type: 'sync_files', files: { '/src/LoopCounter.txt': String(i) } });
      await sleep(300);
      const res = await fetch(withToken(`${HTTP_URL}/preview/test/LoopCounter.txt`));
      const body = await res.text();
      if (body.trim() !== String(i)) allOk = false;
    }

    closeQuiet(ws);
    record('20. Iterative edit loop consistency', allOk, allOk ? '5 sequential writes all read back correctly in order' : 'a write in the loop was not reflected before the next iteration');
  } catch (e) {
    record('20. Iterative edit loop consistency', false, e.message);
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Testing agent at ${WORKER_URL}${AGENT_PATH}`);
  console.log(AUTH_TOKEN ? 'Auth token provided — strict auth checks enabled.' : 'No AUTH_TOKEN provided — auth tests run in informational dev-mode.');
  console.log('---------------------------------------------------------------');

  await testAuthRejection();
  await testAuthSuccessAndHistory();
  await testNewProjectCreation();
  const { setCookie } = await testPreviewHtmlServed();
  await testPreviewCookieFallback(setCookie);
  await testPreviewUnauthorizedAsset();
  await testRateLimiting();
  await sleep(65000); // let the rate-limit window fully expire before hammering the model in later tests
  await testChatStreamingAndFileWrite();
  await testStopMidGeneration();
  await testDeleteFile();
  await testCheckpoints();
  await testRewriteHistory();
  await testReconnectPersistence();
  await testBrokenSyntaxHandling();
  await testSelfHealingLoop();
  await testMultiConnectionBroadcast();
  await testMalformedMessageResilience();
  await testIterativeEditLoop();

  console.log('---------------------------------------------------------------');
  const required = results.filter(r => !r.informational);
  const info = results.filter(r => r.informational);
  const passedRequired = required.filter(r => r.pass).length;
  const passedInfo = info.filter(r => r.pass).length;

  console.log(`Required tests: ${passedRequired}/${required.length} passed`);
  console.log(`Informational tests: ${passedInfo}/${info.length} passed (model-dependent, non-blocking)`);

  const failedRequired = required.filter(r => !r.pass);
  if (failedRequired.length > 0) {
    console.log('\nFAILED (required):');
    for (const f of failedRequired) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  } else {
    console.log('\nAll required tests passed.');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
