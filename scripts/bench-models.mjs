#!/usr/bin/env node
/**
 * Live model benchmark — tests every client-selectable CF model with a simple
 * generation request and reports time-to-first-token and total wall-clock time.
 *
 * Usage:
 *   BH_TOKEN="<your-bh_session_token>" node scripts/bench-models.mjs
 *
 * Get BH_TOKEN from the browser console on brainhalf.com:
 *   localStorage.getItem('bh_session_token')
 *
 * Optional:
 *   BH_URL="http://localhost:8787"  to test against local wrangler dev
 */

const BASE_URL = (process.env.BH_URL ?? 'https://brainhalf.com').replace(/\/$/, '');
const TOKEN = process.env.BH_TOKEN ?? '';

if (!TOKEN) {
  console.error('Error: BH_TOKEN env var not set.');
  console.error("Get it from the browser console:  localStorage.getItem('bh_session_token')");
  process.exit(1);
}

const CF_MODELS = [
  { name: 'Flash (default)',   id: '@cf/deepseek-ai/deepseek-v4-flash-0731' },
  { name: 'DeepSeek V4 Pro',  id: '@cf/deepseek-ai/deepseek-v4-pro-0813' },
  { name: 'Kimi K2.7 Code',   id: '@cf/moonshotai/kimi-k2.7-code' },
  { name: 'GPT-OSS 120B',     id: '@cf/openai/gpt-oss-120b' },
  { name: 'Qwen 3.8 27B',     id: '@cf/qwen/qwen3.8-27b' },
  { name: 'Llama 4 Scout',    id: '@cf/meta/llama-4-scout-17b-16e-instruct' },
  { name: 'Mistral Small 3.1',id: '@cf/mistralai/mistral-small-3.1-24b-instruct' },
  { name: 'Qwen 2.5 Coder',   id: '@cf/qwen/qwen2.5-coder-32b-instruct' },
  { name: 'DeepSeek R1 32B',  id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b' },
];

const PROMPT = 'Build a simple click counter: a button and a number that increments. React only.';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Origin: 'https://brainhalf.com' };

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, { ...opts, headers: { ...HEADERS, ...opts.headers } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 100)}`);
  }
  return res.json();
}

function createProject() {
  // Projects are claimed on first WS connection — no server create step needed.
  return `proj-${crypto.randomUUID()}`;
}

async function deleteProject(id) {
  await fetch(`${BASE_URL}/api/projects/${id}`, { method: 'DELETE', headers: HEADERS }).catch(() => {});
}

async function getWsTicket() {
  const data = await apiFetch('/api/auth/ws-ticket', { method: 'POST', body: '{}' });
  if (!data.ticket) throw new Error('ws-ticket: no ticket in response');
  return data.ticket;
}

// ── WebSocket generation ──────────────────────────────────────────────────────

function runGeneration(projectId, modelId) {
  return new Promise(async (resolve, reject) => {
    const start = performance.now();
    let ttft = -1;
    let dispatchMs = -1;
    let fileCount = 0;
    const timer = setTimeout(() => { ws?.close(); reject(new Error('Timeout after 120s')); }, 120_000);

    let ticket;
    try { ticket = await getWsTicket(); } catch (e) { clearTimeout(timer); reject(e); return; }

    const wsUrl = BASE_URL.replace(/^https?/, s => s === 'https' ? 'wss' : 'ws')
      + `/agents/chat-agent/${projectId}?ticket=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'generate',
        prompt: PROMPT,
        model: modelId,
        fast_mode: true,
        max_tokens: 8192,
        idempotencyKey: crypto.randomUUID(),
      }));
    });

    ws.addEventListener('message', ({ data: raw }) => {
      let data;
      try { data = JSON.parse(raw); } catch { return; }

      if (data.type === 'generation_notice' && data.stage === 'model' && dispatchMs < 0)
        dispatchMs = performance.now() - start;

      if (data.type === 'stream' && data.chunk?.response && ttft < 0)
        ttft = performance.now() - start;

      if (data.type === 'files_changed')
        fileCount = (data.files ?? []).length;

      if (data.type === 'error') {
        clearTimeout(timer); ws.close();
        reject(new Error(data.error ?? 'generation error'));
      }

      if (data.type === 'stream' && data.chunk?.done) {
        clearTimeout(timer); ws.close();
        resolve({ totalMs: performance.now() - start, ttft, dispatchMs, fileCount });
      }

      if (data.type === 'generation_interrupted') {
        clearTimeout(timer); ws.close();
        reject(new Error('generation_interrupted'));
      }
    });

    ws.addEventListener('error', e => { clearTimeout(timer); reject(new Error(e.message ?? 'ws error')); });
  });
}

// ── formatting ────────────────────────────────────────────────────────────────

const ms = n => n < 0 ? '  —  ' : n >= 60_000 ? `${(n / 60_000).toFixed(1)}m` : `${(n / 1000).toFixed(1)}s`;
const bar = (v, max) => '█'.repeat(Math.max(1, Math.round((v / max) * 24)));

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nBrainHalf model benchmark  ${new Date().toISOString()}`);
  console.log(`Target: ${BASE_URL}\n`);

  const session = await apiFetch('/api/auth/session').catch(e => { throw new Error(`Auth failed: ${e.message}`); });
  console.log(`Signed in as: ${session.userId ?? '?'}\n`);

  const results = [];

  for (const model of CF_MODELS) {
    process.stdout.write(`  ${model.name.padEnd(20)} `);
    const projectId = createProject();
    const t0 = performance.now();
    try {
      const r = await runGeneration(projectId, model.id);
      results.push({ ...model, ...r, error: null });
      process.stdout.write(`dispatch ${ms(r.dispatchMs)}  ttft ${ms(r.ttft)}  total ${ms(r.totalMs)}  files=${r.fileCount}\n`);
    } catch (err) {
      const elapsed = performance.now() - t0;
      results.push({ ...model, totalMs: elapsed, ttft: -1, dispatchMs: -1, fileCount: 0, error: err.message });
      process.stdout.write(`FAIL (${ms(elapsed)})  ${err.message.slice(0, 60)}\n`);
    } finally {
      await deleteProject(projectId);
    }
  }

  // ── summary table ─────────────────────────────────────────────────────────
  const ok = results.filter(r => !r.error);
  const maxMs = Math.max(...ok.map(r => r.totalMs), 1);

  console.log('\n' + '─'.repeat(74));
  console.log(`  ${'Model'.padEnd(20)} ${'Dispatch'.padStart(9)} ${'TTFT'.padStart(8)} ${'Total'.padStart(8)}   Bar`);
  console.log('─'.repeat(74));
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.name.padEnd(20)} ${'FAIL'.padStart(9)}                    ${r.error.slice(0, 32)}`);
    } else {
      console.log(`  ${r.name.padEnd(20)} ${ms(r.dispatchMs).padStart(9)} ${ms(r.ttft).padStart(8)} ${ms(r.totalMs).padStart(8)}   ${bar(r.totalMs, maxMs)}`);
    }
  }
  console.log('─'.repeat(74));

  if (ok.length > 0) {
    const fastest = ok.reduce((a, b) => a.totalMs < b.totalMs ? a : b);
    const slowest = ok.reduce((a, b) => a.totalMs > b.totalMs ? a : b);
    console.log(`\n  Fastest : ${fastest.name}  (${ms(fastest.totalMs)})`);
    console.log(`  Slowest : ${slowest.name}  (${ms(slowest.totalMs)})`);
    console.log(`  Avg TTFT: ${ms(ok.reduce((s, r) => s + r.ttft, 0) / ok.length)}`);
    console.log(`  Passed  : ${ok.length}/${results.length}\n`);
  }
}

main().catch(err => { console.error('\nFatal:', err.message); process.exit(1); });
