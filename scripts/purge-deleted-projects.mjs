/**
 * Permanently purges all soft-deleted projects from production.
 *
 * Usage:
 *   node scripts/purge-deleted-projects.mjs <session-token>
 *
 * Get your session token from the browser console at brainhalf.com:
 *   localStorage.getItem('bh_session_token')
 */

const token = process.argv[2];
if (!token) {
  console.error('Usage: node scripts/purge-deleted-projects.mjs <session-token>');
  console.error('');
  console.error('Get your token from the browser console at brainhalf.com:');
  console.error('  localStorage.getItem(\'bh_session_token\')');
  process.exit(1);
}

const ORIGIN = 'https://brainhalf.com';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path) {
  const res = await fetch(`${ORIGIN}${path}`, { method, headers });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

console.log('Fetching all projects from admin API…');
const { ok, status, body } = await api('GET', '/api/admin/projects');

if (status === 401) {
  console.error('Token rejected (401). Make sure you copied the full token from localStorage.');
  process.exit(1);
}
if (status === 403) {
  console.error('Account is not an operator (403). Sign in with kashifullah919@gmail.com or whyai4@gmail.com.');
  process.exit(1);
}
if (!ok || !Array.isArray(body?.projects)) {
  console.error(`Unexpected response (${status}):`, body);
  process.exit(1);
}

const all = body.projects;
const deleted = all.filter(p => p.deleted === true);

console.log(`Total projects: ${all.length}`);
console.log(`Soft-deleted:   ${deleted.length}`);

if (deleted.length === 0) {
  console.log('Nothing to purge.');
  process.exit(0);
}

console.log('');
console.log('Projects to purge:');
for (const p of deleted) {
  console.log(`  ${p.id}  "${p.name}"  (owner: ${p.ownerEmail})`);
}

console.log('');
console.log(`Purging ${deleted.length} project(s)…`);

let purged = 0;
let failed = 0;
for (const p of deleted) {
  process.stdout.write(`  DELETE ${p.id} "${p.name}" … `);
  const { ok: delOk, status: delStatus, body: delBody } = await api('DELETE', `/api/admin/projects/${encodeURIComponent(p.id)}`);
  if (delOk) {
    process.stdout.write(`OK\n`);
    purged++;
  } else {
    process.stdout.write(`FAILED (${delStatus}) ${JSON.stringify(delBody)}\n`);
    failed++;
  }
}

console.log('');
console.log(`Done. Purged: ${purged}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
