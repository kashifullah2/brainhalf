/**
 * Fails a deploy when a required secret is missing from the target environment.
 *
 * Auth signs session cookies with env.SESSION_SECRET. When it is absent the Worker
 * does not refuse to boot — it falls back to an ephemeral random key and logs a
 * warning, which means a misconfigured deploy looks healthy until an isolate
 * restart invalidates every signed-in user's session. Running this before
 * `wrangler deploy` turns that silent degradation into a loud failure at the
 * moment the bad config would have shipped.
 *
 * Requires an authenticated `wrangler`; the same auth `wrangler deploy` needs.
 */
import { execFileSync } from 'node:child_process';

const REQUIRED = ['SESSION_SECRET', 'ATRIA_API_KEY'];

// Minimum key length the Worker itself enforces (src/lib/auth.ts).
const MIN_SESSION_SECRET_LEN = 32;

let listing;
try {
  listing = execFileSync('npx', ['wrangler', 'secret', 'list'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
} catch (err) {
  console.error(
    '\n✗ Could not list Worker secrets.\n' +
      '  Wrangler must be authenticated before deploying. Run `npx wrangler login`.\n' +
      `  Underlying error: ${err.stderr?.trim() || err.message}\n`
  );
  process.exitCode = 1;
  process.exit(process.exitCode);
}

// Wrangler emits JSON for `secret list` in the versions in use here; fall back
// to scanning the raw text if an older release prints a table instead.
let present = new Set();
try {
  const parsed = JSON.parse(listing);
  const names = Array.isArray(parsed) ? parsed : (parsed?.result ?? []);
  for (const row of names) {
    if (row && typeof row.name === 'string') present.add(row.name);
  }
} catch {
  const lines = listing.split('\n');
  const headerIdx = lines.findIndex((l) => l.trim().startsWith('NAME'));
  const rows = headerIdx >= 0 ? lines.slice(headerIdx + 1) : lines;
  for (const row of rows) {
    const name = (row.split(/\s{2,}/)[0] || '').trim();
    if (name) present.add(name);
  }
}

const missing = REQUIRED.filter((name) => !present.has(name));
if (missing.length) {
  console.error(
    '\n✗ Required secrets are missing from the Worker:\n' +
      missing.map((m) => `    - ${m}`).join('\n') +
      '\n\n  Set them before deploying:\n' +
      missing.map((m) => `    npx wrangler secret put ${m}`).join('\n') +
      '\n'
  );
  process.exitCode = 1;
}

if (present.has('SESSION_SECRET')) {
  // Wrangler does not return values, only names, so we cannot check the length
  // remotely. Re-check the local override used for `wrangler dev` so a too-short
  // key is caught at all.
  const local = process.env.SESSION_SECRET;
  if (local && local.length < MIN_SESSION_SECRET_LEN) {
    console.error(
      `\n✗ SESSION_SECRET in this environment is shorter than ${MIN_SESSION_SECRET_LEN} characters.\n` +
        '  The Worker rejects it and falls back to an ephemeral key.\n'
    );
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log('✓ Required secrets present on the Worker.');
}
process.exit(process.exitCode || 0);
