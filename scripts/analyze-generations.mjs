/**
 * Query the last 20 generations for a project and report timing stats +
 * repair-turn breakdown, grouped by model.
 *
 * Usage:
 *   PROJECT_ID=<id> SESSION_TOKEN=<bh_...> node scripts/analyze-generations.mjs
 *
 * Optional:
 *   BASE_URL=https://brainhalf.com   (default)
 */

const BASE_URL = process.env.BASE_URL ?? 'https://brainhalf.com';
const PROJECT_ID = process.env.PROJECT_ID;
const SESSION_TOKEN = process.env.SESSION_TOKEN;

if (!PROJECT_ID || !SESSION_TOKEN) {
  console.error('Required: PROJECT_ID and SESSION_TOKEN env vars');
  process.exit(1);
}

const res = await fetch(`${BASE_URL}/agents/chat-agent/${PROJECT_ID}/usage`, {
  headers: { Authorization: `Bearer ${SESSION_TOKEN}`, Origin: BASE_URL },
});

if (!res.ok) {
  console.error(`HTTP ${res.status}: ${await res.text()}`);
  process.exit(1);
}

const rows = await res.json();
if (!Array.isArray(rows) || rows.length === 0) { console.log('No generations found.'); process.exit(0); }

// ── helpers ────────────────────────────────────────────────────────────────

function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(nums) {
  const clean = nums.filter(n => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!clean.length) return { n: 0, median: null, p90: null };
  return { n: clean.length, median: pct(clean, 50), p90: pct(clean, 90) };
}

function ms(v) { return v == null ? '—' : `${Math.round(v)}ms`; }
function ratio(e, r) {
  if (e == null && r == null) return '—';
  const total = (e ?? 0) + (r ?? 0);
  if (!total) return '0/0';
  return `${Math.round(((e ?? 0) / total) * 100)}% edit / ${Math.round(((r ?? 0) / total) * 100)}% rewrite`;
}

// ── group by model ─────────────────────────────────────────────────────────

const byModel = {};
for (const row of rows) {
  const model = (row.model ?? 'unknown').replace(/@cf\//, '').replace(/^anthropic\./, '');
  (byModel[model] ??= []).push(row);
}

// ── print stats ────────────────────────────────────────────────────────────

console.log(`\n=== Generation stats — last ${rows.length} runs ===\n`);

for (const [model, gens] of Object.entries(byModel)) {
  const firstToken = gens.map(g => g.first_response_at && g.started_at ? g.first_response_at - g.started_at : null);
  const total     = gens.map(g => g.finished_at && g.started_at ? g.finished_at - g.started_at : null);
  const genMs     = gens.map(g => g.generation_ms);
  const extMs     = gens.map(g => g.extraction_ms);
  const chkMs     = gens.map(g => g.checks_ms);

  const ttft   = stats(firstToken);
  const totSt  = stats(total);
  const genSt  = stats(genMs);
  const extSt  = stats(extMs);
  const chkSt  = stats(chkMs);

  const editRatios  = gens.map(g => [g.edit_chars, g.rewrite_chars]);
  const totalEdit   = editRatios.reduce((s, [e]) => s + (e ?? 0), 0);
  const totalRewrite = editRatios.reduce((s, [, r]) => s + (r ?? 0), 0);
  const totalChars  = totalEdit + totalRewrite;

  console.log(`── ${model} (n=${gens.length}) ──`);
  console.log(`  Time to first token  median=${ms(ttft.median)}  p90=${ms(ttft.p90)}`);
  console.log(`  Total time           median=${ms(totSt.median)}  p90=${ms(totSt.p90)}`);
  console.log(`  generation_ms        median=${ms(genSt.median)}  p90=${ms(genSt.p90)}`);
  console.log(`  extraction_ms        median=${ms(extSt.median)}  p90=${ms(extSt.p90)}`);
  console.log(`  checks_ms            median=${ms(chkSt.median)}  p90=${ms(chkSt.p90)}`);
  if (totalChars) {
    console.log(`  edit vs rewrite      ${Math.round((totalEdit / totalChars) * 100)}% edit (${totalEdit.toLocaleString()} chars) / ${Math.round((totalRewrite / totalChars) * 100)}% rewrite (${totalRewrite.toLocaleString()} chars)`);
  } else {
    console.log(`  edit vs rewrite      —`);
  }
  console.log();
}

// ── repair turns ───────────────────────────────────────────────────────────

const withRepair = rows.filter(g => g.repair_types && g.repair_types.trim());
console.log(`=== Repair turns: ${withRepair.length} / ${rows.length} generations needed a repair ===\n`);

const repairCounts = {};
for (const g of withRepair) {
  for (const t of g.repair_types.split(',')) {
    const key = t.trim();
    if (key) repairCounts[key] = (repairCounts[key] ?? 0) + 1;
  }
}

if (Object.keys(repairCounts).length) {
  const sorted = Object.entries(repairCounts).sort(([, a], [, b]) => b - a);
  for (const [type, count] of sorted) {
    console.log(`  ${type.padEnd(36)} ${count}×`);
  }
} else {
  console.log('  (none)');
}

console.log();

// ── individual rows (compact) ──────────────────────────────────────────────

console.log('=== Individual generations (newest first) ===\n');
const header = ['#', 'model (short)', 'status', 'ttft', 'total', 'gen_ms', 'ext_ms', 'chk_ms', 'files', 'repair'];
console.log(header.map((h, i) => h.padEnd([3,22,10,7,7,7,7,7,5,0][i])).join(' '));
console.log('-'.repeat(90));

rows.forEach((g, i) => {
  const shortModel = (g.model ?? '?').replace(/.*\//,'').replace(/^claude-/,'').slice(0,20);
  const ttft = g.first_response_at && g.started_at ? g.first_response_at - g.started_at : null;
  const total = g.finished_at && g.started_at ? g.finished_at - g.started_at : null;
  console.log([
    String(i + 1).padEnd(3),
    shortModel.padEnd(22),
    (g.status ?? '?').padEnd(10),
    ms(ttft).padEnd(7),
    ms(total).padEnd(7),
    ms(g.generation_ms).padEnd(7),
    ms(g.extraction_ms).padEnd(7),
    ms(g.checks_ms).padEnd(7),
    String(g.files_written ?? '?').padEnd(5),
    g.repair_types || '—',
  ].join(' '));
});
console.log();
