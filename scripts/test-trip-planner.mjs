import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startTripPlanner } from './trip-planner-harness.mjs';

const appDirectory = resolve(process.argv[2] || 'audit-artifacts/2026-09-23/trip-planner/app');
const reportPath = resolve(process.argv[3] || 'audit-artifacts/2026-09-23/trip-planner/api-results.json');
const stateDirectory = await mkdtemp(resolve(tmpdir(), 'brainhalf-trip-test-'));
const results = [];
let app;
let setupFailure;
let cookies = {};
async function login(user) {
  const response = await fetch(app.origin + '/__test/login', { method: 'POST', headers: { Origin: app.origin }, body: JSON.stringify({ user }) });
  assert.equal(response.status, 200);
  cookies[user] = response.headers.get('set-cookie').split(';')[0];
}
async function request(user, path, method = 'GET', body, options = {}) {
  const response = await fetch(app.origin + path, {
    method, headers: { Origin: app.origin, 'Content-Type': 'application/json', ...(cookies[user] ? { Cookie: cookies[user] } : {}), ...options.headers },
    body: body === undefined ? undefined : options.raw ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, data };
}
function status(response, expected) { assert.equal(response.status, expected, JSON.stringify(response.data)); return response.data; }
const key = () => randomUUID();
async function trip(capacity = 3, members = ['bob']) {
  const created = status(await request('alice', '/api/trips', 'POST', { title: 'Hunza expedition', capacity, budgetCents: 150000 }), 201).trip;
  assert.ok(created?.id, 'POST /api/trips must return {trip}');
  for (const userId of members) {
    const response = await request('alice', `/api/trips/${created.id}/members`, 'POST', { userId });
    assert.ok([200,201].includes(response.status), JSON.stringify(response.data));
  }
  return created;
}
const booking = (user, id, seats = 1, idempotency = key()) => request(user, `/api/trips/${id}/bookings`, 'POST', { seats }, { headers: { 'Idempotency-Key': idempotency } });
const expense = (user, id, body = { description: 'Dinner', amountCents: 1001 }, idempotency = key()) => request(user, `/api/trips/${id}/expenses`, 'POST', body, { headers: { 'Idempotency-Key': idempotency } });
const detail = async (id, user = 'alice') => status(await request(user, `/api/trips/${id}`), 200);
const audit = async id => status(await request('alice', `/api/trips/${id}/audit`), 200).events;
async function check(name, run) {
  const start = Date.now();
  try { await run(); results.push({ name, status: 'passed', ms: Date.now() - start }); console.log('PASS', name); }
  catch (error) { results.push({ name, status: 'failed', error: error.message, ms: Date.now() - start }); console.log('FAIL', name, error.message.slice(0, 800)); }
}
try {
  app = await startTripPlanner({ appDirectory, stateDirectory });
  for (const user of ['alice', 'bob', 'eve']) await login(user);
  await check('Real Worker health and D1 binding', async () => {
    const health = status(await request('', '/api/health'), 200);
    assert.ok(health.ok === true || health.status === 'ok');
    assert.ok(await app.db.prepare('SELECT 1 AS alive').first());
  });
  await check('Anonymous requests cannot spoof a trusted identity header', async () => {
    status(await request('', '/api/trips'), 401);
    status(await request('', '/api/trips', 'GET', undefined, { headers: { 'x-bh-user-id': 'alice' } }), 401);
  });
  await check('Standalone Worker fails closed without managed identity configuration', async () => {
    const response = await app.unmanagedRequest('/api/trips', { headers: { 'x-bh-user-id': 'alice' } });
    assert.equal(response.status, 401);
  });
  await check('Destinations persist and isolate owners', async () => {
    const item = status(await request('alice', '/api/items', 'POST', { title: 'Attabad Lake' }), 201).item;
    assert.ok(status(await request('alice', '/api/items'), 200).items.some(row => row.id === item.id));
    assert.ok(!status(await request('bob', '/api/items'), 200).items.some(row => row.id === item.id));
    status(await request('bob', `/api/items/${item.id}`, 'DELETE'), 404);
    status(await request('alice', `/api/items/${item.id}`, 'DELETE'), 200);
  });
  await check('Trip membership and lists isolate an outsider', async () => {
    const t = await trip();
    assert.ok(status(await request('bob', '/api/trips'), 200).trips.some(row => row.id === t.id));
    assert.ok(!status(await request('eve', '/api/trips'), 200).trips.some(row => row.id === t.id));
    assert.ok([403,404].includes((await request('eve', `/api/trips/${t.id}`)).status));
  });
  await check('Only trip owner can add members, rename, and read audit', async () => {
    const t = await trip();
    for (const [path, method, body] of [
      [`/api/trips/${t.id}/members`, 'POST', { userId: 'eve' }],
      [`/api/trips/${t.id}`, 'PATCH', { title: 'Hijacked', version: 1 }],
      [`/api/trips/${t.id}/audit`, 'GET', undefined],
    ]) assert.ok([403,404].includes((await request('bob', path, method, body)).status));
  });
  await check('Capacity and money reject fractions, strings, negative and oversized values', async () => {
    for (const capacity of [0,-1,1.5,'2',101,null]) status(await request('alice', '/api/trips', 'POST', { title: 'Invalid', capacity, budgetCents: 100 }), 400);
    for (const budgetCents of [-1,1.5,'100',100000001,null]) status(await request('alice', '/api/trips', 'POST', { title: 'Invalid', capacity: 3, budgetCents }), 400);
  });
  await check('Malformed, null and oversized JSON returns client errors', async () => {
    status(await request('alice', '/api/trips', 'POST', '{broken', { raw: true }), 400);
    status(await request('alice', '/api/trips', 'POST', null), 400);
    status(await request('alice', '/api/trips', 'POST', { title: 'x'.repeat(20000), capacity: 1, budgetCents: 0 }), 413);
  });
  await check('Cross-origin mutation cannot create a trip', async () => {
    status(await request('alice', '/api/trips', 'POST', { title: 'CSRF', capacity: 1, budgetCents: 0 }, { headers: { Origin: 'https://attacker.example' } }), 403);
  });
  await check('Competing users cannot oversell the last seat (12 requests)', async () => {
    const t = await trip(1);
    const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => booking(i % 2 ? 'alice' : 'bob', t.id)));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 409).length, 11);
    const rows = (await detail(t.id)).bookings;
    assert.equal(rows.filter(b => b.status !== 'cancelled').reduce((sum,b) => sum + b.seats, 0), 1);
    assert.equal((await audit(t.id)).filter(e => JSON.stringify(e).includes('booking')).length, 1);
  });
  await check('Ten simultaneous retries create exactly one booking and audit event', async () => {
    const t = await trip(2); const idempotency = key();
    const responses = await Promise.all(Array.from({ length: 10 }, () => booking('bob', t.id, 1, idempotency)));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 200).length, 9);
    assert.equal(new Set(responses.map(r => r.data.booking?.id)).size, 1);
    assert.equal((await detail(t.id)).bookings.length, 1);
    assert.equal((await audit(t.id)).filter(e => JSON.stringify(e).includes('booking')).length, 1);
  });
  await check('Reusing booking key for different seats returns conflict', async () => {
    const t = await trip(4); const idempotency = key();
    status(await booking('bob', t.id, 1, idempotency), 201);
    status(await booking('bob', t.id, 2, idempotency), 409);
    assert.equal((await detail(t.id)).bookings.length, 1);
  });
  await check('Idempotency keys are scoped independently by trip and user', async () => {
    const t = await trip(4); const other = await trip(4); const idempotency = key();
    const responses = await Promise.all([booking('alice', t.id, 1, idempotency), booking('bob', t.id, 1, idempotency), booking('bob', other.id, 1, idempotency)]);
    for (const r of responses) status(r, 201);
    assert.equal(new Set(responses.map(r => r.data.booking.id)).size, 3);
  });
  await check('Cancellation releases seats once under repeated concurrent requests', async () => {
    const t = await trip(1); const idempotency = key();
    const b = status(await booking('bob', t.id, 1, idempotency), 201).booking;
    const responses = await Promise.all(Array.from({ length: 8 }, () => request('bob', `/api/trips/${t.id}/bookings/${b.id}`, 'PATCH', { status: 'cancelled' })));
    for (const r of responses) status(r, 200);
    const replay = status(await booking('bob', t.id, 1, idempotency), 200).booking;
    assert.equal(replay.id, b.id); assert.equal(replay.status, 'cancelled');
    status(await booking('alice', t.id), 201);
    status(await booking('bob', t.id), 409);
    assert.equal((await audit(t.id)).filter(e => /cancel/i.test(JSON.stringify(e))).length, 1);
  });
  await check('Member cannot cancel somebody else’s booking; owner can', async () => {
    const t = await trip();
    const b = status(await booking('alice', t.id), 201).booking;
    assert.ok([403,404].includes((await request('bob', `/api/trips/${t.id}/bookings/${b.id}`, 'PATCH', { status: 'cancelled' })).status));
    const own = status(await booking('bob', t.id), 201).booking;
    status(await request('alice', `/api/trips/${t.id}/bookings/${own.id}`, 'PATCH', { status: 'cancelled' }), 200);
  });
  await check('Cross-trip booking identifier cannot cancel a booking', async () => {
    const t = await trip(); const other = await trip();
    const b = status(await booking('bob', t.id), 201).booking;
    status(await request('alice', `/api/trips/${other.id}/bookings/${b.id}`, 'PATCH', { status: 'cancelled' }), 404);
    assert.notEqual((await detail(t.id)).bookings[0].status, 'cancelled');
  });
  await check('Outsiders cannot book seats or add expenses', async () => {
    const t = await trip();
    assert.ok([403,404].includes((await booking('eve', t.id)).status));
    assert.ok([403,404].includes((await expense('eve', t.id)).status));
  });
  await check('Stale rename and two simultaneous edits preserve one winner', async () => {
    const t = await trip();
    const responses = await Promise.all(['Hunza north', 'Hunza south'].map(title => request('alice', `/api/trips/${t.id}`, 'PATCH', { title, version: t.version })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200,409]);
    const saved = (await detail(t.id)).trip;
    assert.equal(saved.version, t.version + 1);
    status(await request('alice', `/api/trips/${t.id}`, 'PATCH', { title: 'Outdated', version: t.version }), 409);
  });
  await check('Integer-cent expenses sum exactly and ignore a forged owner', async () => {
    const t = await trip();
    status(await expense('bob', t.id, { description: 'Tea', amountCents: 10, userId: 'alice' }), 201);
    status(await expense('bob', t.id, { description: 'Snack', amountCents: 20 }), 201);
    const saved = await detail(t.id);
    assert.equal(saved.trip.spentCents ?? saved.spentCents, 30);
    assert.equal(saved.expenses[0].userId ?? saved.expenses[0].user_id, 'bob');
  });
  await check('Expense retries and changed-payload conflicts do not double charge', async () => {
    const t = await trip(); const idempotency = key();
    const responses = await Promise.all(Array.from({ length: 8 }, () => expense('bob', t.id, { description: 'Jeep', amountCents: 12345 }, idempotency)));
    assert.equal(responses.filter(r => r.status === 201).length, 1);
    assert.equal(responses.filter(r => r.status === 200).length, 7);
    status(await expense('bob', t.id, { description: 'Jeep', amountCents: 12346 }, idempotency), 409);
    status(await expense('bob', t.id, { description: 'Changed', amountCents: 12345 }, idempotency), 409);
    assert.equal((await detail(t.id)).expenses.length, 1);
    assert.equal((await audit(t.id)).filter(e => /expense/i.test(JSON.stringify(e))).length, 1);
  });
  await check('Booking and expense validation rejects invalid keys and numeric types', async () => {
    const t = await trip();
    for (const seats of [0,-1,0.5,'1',null]) status(await booking('bob', t.id, seats), 400);
    for (const amountCents of [0,-1,1.5,'100',100000001,null]) status(await expense('bob', t.id, { description: 'Invalid', amountCents }), 400);
    for (const idempotency of ['', 'short', 'x'.repeat(101), 'unsafe key']) status(await booking('bob', t.id, 1, idempotency), 400);
  });
  await check('SQL injection stays literal text and cannot alter another user’s data', async () => {
    const title = "'); DROP TABLE trips; -- <img src=x onerror=alert(1)>";
    const t = status(await request('alice', '/api/trips', 'POST', { title, capacity: 1, budgetCents: 0 }), 201).trip;
    assert.equal((await detail(t.id)).trip.title, title);
    assert.ok(status(await request('alice', '/api/trips'), 200).trips.length > 0);
  });
  await check('Audit write failure rolls back booking, cancellation and expense atomically', async () => {
    const t = await trip(3);
    const b = status(await booking('bob', t.id), 201).booking;
    await app.db.prepare('CREATE TABLE harness_faults (trip_id TEXT PRIMARY KEY)').run();
    await app.db.prepare('INSERT INTO harness_faults VALUES (?)').bind(t.id).run();
    await app.db.prepare(`CREATE TRIGGER harness_reject_audit BEFORE INSERT ON audit_events
      WHEN EXISTS(SELECT 1 FROM harness_faults WHERE trip_id=NEW.trip_id)
      BEGIN SELECT RAISE(ABORT,'injected_audit_failure'); END`).run();
    try {
      status(await booking('alice',t.id),500);
      status(await expense('alice',t.id),500);
      status(await request('bob',`/api/trips/${t.id}/bookings/${b.id}`,'PATCH',{status:'cancelled'}),500);
      const saved=await detail(t.id);
      assert.equal(saved.trip.reserved_seats,1); assert.equal(saved.bookings.length,1);
      assert.equal(saved.bookings[0].status,'active'); assert.equal(saved.expenses.length,0);
      assert.equal((await audit(t.id)).length,1);
    } finally { await app.db.prepare('DROP TRIGGER harness_reject_audit').run(); }
    status(await booking('alice',t.id),201);
  });
  await check('Trip creation rolls back if automatic owner membership fails', async () => {
    const before=await app.db.prepare('SELECT COUNT(*) AS count FROM trips').first();
    await app.db.prepare(`CREATE TRIGGER harness_reject_membership BEFORE INSERT ON trip_members
      BEGIN SELECT RAISE(ABORT,'injected_membership_failure'); END`).run();
    try {
      status(await request('alice','/api/trips','POST',{title:'Must roll back',capacity:2,budgetCents:0}),500);
      assert.deepEqual(await app.db.prepare('SELECT COUNT(*) AS count FROM trips').first(),before);
    } finally { await app.db.prepare('DROP TRIGGER harness_reject_membership').run(); }
  });
  await check('Contact reaches real runtime SQLite inbox, with production inbox isolated', async () => {
    const email = `contact-${randomUUID()}@example.test`;
    assert.equal(status(await request('alice', '/api/contact', 'POST', { name: 'Audit visitor', email, message: 'Question about the Hunza itinerary.' }), 201).status, 'captured');
    const inbox = await (await app.control('/inbox')).json();
    assert.ok(inbox.messages.some(row => row.email === email));
    const production = await (await app.control('/inbox?environment=production')).json();
    assert.equal(production.messages.length, 0);
    status(await request('alice', '/api/contact', 'POST', { name: '', email: 'invalid', message: '' }), 400);
  });
  await check('Database and contact inbox survive complete Worker/server restart', async () => {
    const t = await trip();
    const b = status(await booking('bob', t.id), 201).booking;
    await app.close(); app = undefined;
    app = await startTripPlanner({ appDirectory, stateDirectory }); cookies = {};
    for (const user of ['alice', 'bob', 'eve']) await login(user);
    assert.ok((await detail(t.id, 'bob')).bookings.some(row => row.id === b.id));
    assert.ok((await (await app.control('/inbox')).json()).messages.length > 0);
  });
  await check('Logout revokes local test session and blocks private API', async () => {
    status(await request('eve', '/api/auth/logout', 'POST', {}), 200);
    status(await request('eve', '/api/trips'), 401);
  });
} catch (error) {
  setupFailure = error.message;
  throw error;
} finally {
  if (app) await app.close();
  const report = { scope: 'Generated Worker on local workerd, persistent local D1, real BrainHalf runtime contact inbox; controlled identities, no live Google/email/cloud provisioning.', stateDirectory, setupFailure, passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed').length, results };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed, reportPath }));
  if (report.failed) process.exitCode = 1;
}
