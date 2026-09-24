import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { BUSINESS_APPS, businessValidationPrompt } from '../src/lib/business-apps.ts';
import { CLIENT_SELECTABLE_MODELS, DEFAULT_MODEL_ID } from '../src/lib/models.ts';
import { createEvidence, recordFrame, waitForGeneration } from './test-live-model-apps.mjs';
import { waitForPlatformSignIn } from './live-auth.mjs';

const origin = 'https://brainhalf.com';
const model = CLIENT_SELECTABLE_MODELS.find(item => item.name === DEFAULT_MODEL_ID);
async function runtime(page, projectId, path = '/status', method = 'GET') {
  return page.evaluate(async ({ projectId, path, method }) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runtime${path}${path.includes('?') ? '&' : '?'}environment=production`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Runtime HTTP ${response.status}`);
    return body;
  }, { projectId, path, method });
}
export async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}
async function signInApp(context, url, label) {
  const page = await context.newPage();
  const authEvidence = { signup: false, verification: false, login: false };
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (response.request().method() !== 'POST' || !response.ok()) return;
    if (path === '/api/auth/signup') authEvidence.signup = true;
    if (path === '/api/auth/verify-email') authEvidence.verification = true;
    if (path === '/api/auth/login') authEvidence.login = true;
  });
  await page.goto(url + '/__brainhalf/auth');
  console.log(`${label}: sign up and verify your own test email, or sign in, in the opened app tab. Use a different account for the second user. Keep Chrome open.`);
  await expect.poll(async () => {
    try { return (await api(page, '/api/auth/session')).body.user?.id || ''; } catch { return ''; }
  }, { timeout: 10 * 60_000, intervals: [1000] }).not.toBe('');
  await page.goto(url);
  return { page, authEvidence };
}
async function archiveSource(page, directory, filename) {
  await page.getByRole('button', { name: 'Project actions', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download source ZIP', exact: true }).click();
  await (await download).saveAs(resolve(directory, filename));
}
async function assertDatabaseRecord(monitor, projectId, record, fields) {
  const database = await runtime(monitor, projectId, '/database?table=records');
  const persisted = database.rows.find(row => row.id === record.id);
  expect(persisted?.name).toBe(record.name);
  expect(persisted.owner_id).toBe(record.ownerId);
  expect(JSON.parse(persisted.payload)).toMatchObject(fields);
}
async function publish(page, monitor, projectId, previousRelease) {
  await page.getByRole('button', { name: 'Publish application', exact: true }).click();
  let observedJob;
  await expect.poll(async () => {
    const status = await runtime(monitor, projectId);
    const job = status.jobs?.find(item => item.kind === 'publish' && (!previousRelease || item.releaseId !== previousRelease));
    if (job) observedJob = job;
    return !!job;
  }, { timeout: 30_000, intervals: [1000] }).toBe(true);
  // Publishing must continue when its workspace closes.
  await page.close();
  let latest;
  await expect.poll(async () => {
    latest = await runtime(monitor, projectId);
    const job = latest.jobs.find(item => item.id === observedJob.id);
    if (job && ['failed', 'stopped'].includes(job.status)) throw new Error(job.message || 'Publishing failed');
    return job?.status;
  }, { timeout: 11 * 60_000, intervals: [2000] }).toBe('passed');
  if (!latest.activeRelease || latest.activeRelease.id === previousRelease) throw new Error('No new active production release');
  return latest;
}

export async function checkBusinessData(app, first, other, anonymous, title) {
  await expect(first.getByRole('heading', { name: title, exact: true })).toBeVisible();
  const name = `Acceptance ${app.id} ${Date.now()}`;
  await first.getByLabel('Name', { exact: true }).fill(name);
  for (const [key, value] of Object.entries(app.fields)) {
    const field = first.getByLabel(key, { exact: true });
    if (await field.evaluate(element => element.tagName === 'SELECT')) await field.selectOption(String(value));
    else await field.fill(await field.getAttribute('type') === 'datetime-local' ? String(value).slice(0, 16) : String(value));
  }
  await first.getByRole('button', { name: 'Add record', exact: true }).click();
  await expect(first.getByRole('list', { name: 'Records', exact: true }).getByText(name, { exact: true })).toBeVisible();
  const list = await api(first, '/api/records'); expect(list.status).toBe(200);
  const record = list.body.records.find(item => item.name === name); expect(record?.id).toBeTruthy();
  if (app.id === 'booking') {
    expect(record.customer).toBe(app.fields.customer); expect(record.status).toBe(app.fields.status);
    for (const key of ['start', 'end']) expect(Date.parse(record[key])).toBe(Date.parse(app.fields[key]));
  } else expect(record).toMatchObject(app.fields);
  const path = '/api/records/' + encodeURIComponent(record.id);
  expect((await api(anonymous, '/api/records')).status).toBe(401);
  const otherList = await api(other, '/api/records'); expect(otherList.status).toBe(200);
  expect(otherList.body.records.some(item => item.id === record.id)).toBe(false);
  for (const method of ['GET', 'PATCH', 'DELETE']) expect((await api(other, path, method, method === 'PATCH' ? { name: 'Stolen' } : undefined)).status).toBe(404);
  expect((await api(first, path, 'PATCH', app.invalid)).status).toBe(400);
  if (app.id === 'booking') {
    expect((await api(first, '/api/records', 'POST', { name: 'Overlapping', ...app.fields })).status).toBe(409);
    // A different empty slot catches check-then-insert races.
    const slot = { ...app.fields, start: '2030-06-04T09:00:00Z', end: '2030-06-04T10:00:00Z' };
    const competing = await Promise.all([api(first, '/api/records', 'POST', { name: 'Race one', ...slot }), api(first, '/api/records', 'POST', { name: 'Race two', ...slot })]);
    expect(competing.map(item => item.status).sort()).toEqual([201, 409]);
  }
  expect((await api(first, path, 'PATCH', app.update)).status).toBe(200);
  await first.reload();
  expect((await api(first, path)).body.record).toMatchObject({ name, ...app.update });
  await first.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => first.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const ownerId = (await api(first, '/api/auth/session')).body.user.id;
  const spoof = await api(other, '/api/records', 'POST', { name: 'Owner spoof attempt', ...app.fields, ownerId, userId: ownerId });
  expect([201, 400]).toContain(spoof.status);
  if (spoof.status === 201) {
    const spoofPath = '/api/records/' + encodeURIComponent(spoof.body.record.id);
    expect((await api(first, spoofPath)).status).toBe(404);
    expect((await api(other, spoofPath, 'DELETE')).status).toBe(200);
  }
  return { id: record.id, ownerId, name, path };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { console.log('Usage: node scripts/test-business-apps.mjs --run\nCreates five real default-model apps sequentially, tests domain behavior and one-click publish/update. Uses visible Chrome for platform and two app-user sign-ins/verification with your own test accounts. No passwords or tokens are stored. Only projects created by this run are deleted after evidence is saved, keeping the three-hosted-app limit intact. Run the simple model check first.'); return; }
  if (args.length !== 1 || args[0] !== '--run') throw new Error('Explicit --run is required; use --help.');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = resolve('audit-artifacts/business-apps', runId); mkdirSync(directory, { recursive: true });
  const results = BUSINESS_APPS.map(app => ({ app: app.id, status: 'not-run', checks: [] }));
  const save = () => writeFileSync(resolve(directory, 'results.json'), JSON.stringify({ runId, origin, model: model.name, authentication: 'Interactive real signup/sign-in; existing sessions do not prove signup', results }, null, 2) + '\n');
  save(); let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false });
    const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const login = await owner.newPage(); await login.goto(origin);
    console.log('Sign in or create and verify your BrainHalf test account. Keep Chrome open.');
    const monitor = await waitForPlatformSignIn(owner, { origin, directory });
    for (const [index, app] of BUSINESS_APPS.entries()) {
      const result = results[index]; result.status = 'running'; result.startedAt = Date.now(); save();
      let page = await owner.newPage(); let projectId; let evidence; const contexts = [];
      const listen = target => target.on('websocket', socket => { if (!new URL(socket.url()).pathname.startsWith('/agents/')) return; socket.on('framesent', frame => { if (evidence) recordFrame(evidence, 'sent', frame.payload); }); socket.on('framereceived', frame => { if (evidence) recordFrame(evidence, 'received', frame.payload); }); });
      listen(page);
      try {
        await page.goto(origin + '/dashboard'); await page.getByRole('button', { name: 'New project', exact: true }).click();
        await expect(page.getByLabel('Message to the app builder')).toBeVisible();
        projectId = new URL(page.url()).searchParams.get('project'); if (!projectId) throw new Error('No new project ID');
        result.projectId = projectId; evidence = createEvidence(model, projectId);
        const title = `BrainHalf ${app.label} ${runId}`;
        await page.getByLabel('Message to the app builder').fill(`/build ${businessValidationPrompt(app, title)}`); await page.getByTestId('send-prompt-btn').click();
        await waitForGeneration(page, evidence); result.generation = evidence; result.checks.push('default model generated files');
        await archiveSource(page, directory, `${app.id}-initial.zip`);
        const firstRelease = await publish(page, monitor, projectId); result.firstLiveMs = Date.now() - result.startedAt;
        result.checks.push('one click publishes frontend/backend and survives workspace close');
        const [firstContext, otherContext, anonContext] = await Promise.all([browser.newContext({ timezoneId: 'UTC' }), browser.newContext({ timezoneId: 'UTC' }), browser.newContext({ timezoneId: 'UTC' })]); contexts.push(firstContext, otherContext, anonContext);
        const firstLogin = await signInApp(firstContext, firstRelease.productionUrl, `${app.label}: first app user`);
        const otherLogin = await signInApp(otherContext, firstRelease.productionUrl, `${app.label}: second app user`);
        const first = firstLogin.page; const other = otherLogin.page;
        result.appAuthentication = [firstLogin.authEvidence, otherLogin.authEvidence];
        expect(firstLogin.authEvidence, 'Create and verify a new app account to validate signup').toEqual({ signup: true, verification: true, login: true });
        result.checks.push('real app signup, email verification and login');
        expect((await api(first, '/api/auth/session')).body.user.id).not.toBe((await api(other, '/api/auth/session')).body.user.id);
        const anon = await anonContext.newPage(); await anon.goto(firstRelease.productionUrl);
        const record = await checkBusinessData(app, first, other, anon, title);
        await assertDatabaseRecord(monitor, projectId, record, app.update);
        result.checks.push('production D1 persistence confirmed independently', 'UI saves real API data', 'domain validation', 'anonymous and second-user isolation', 'reopen persistence', 'mobile layout');
        await first.screenshot({ path: resolve(directory, `${app.id}-mobile.png`), fullPage: true });
        page = await owner.newPage(); listen(page); await page.goto(`${origin}/?project=${encodeURIComponent(projectId)}`);
        evidence = createEvidence(model, projectId);
        const marker = `Updated ${app.id} ${runId}`;
        await page.getByLabel('Message to the app builder').fill(`Add visible text exactly ${JSON.stringify(marker)} to the app. Preserve the existing schema, records, API contract and behavior. Implement this small change now.`);
        await page.getByTestId('send-prompt-btn').click(); await waitForGeneration(page, evidence);
        await archiveSource(page, directory, `${app.id}-updated.zip`);
        await publish(page, monitor, projectId, firstRelease.activeRelease.id);
        await assertDatabaseRecord(monitor, projectId, record, app.update);
        await first.reload(); await expect(first.getByText(marker, { exact: true })).toBeVisible();
        expect((await api(first, record.path)).body.record).toMatchObject({ name: record.name, ...app.update });
        expect((await api(first, record.path, 'DELETE')).status).toBe(200);
        expect((await api(first, record.path)).status).toBe(404);
        result.checks.push('updated release visible', 'production data survives update', 'own record deletion'); result.status = 'passed';
      } catch (error) { result.status = 'failed'; result.error = error.message; }
      finally {
        result.finishedAt = Date.now(); if (!result.generation) result.generation = evidence; save();
        for (const context of contexts) await context.close();
        await page.close().catch(() => {});
        if (projectId) {
          // Exact ID is captured from the project created above; never cleans existing projects.
          result.cleanup = await monitor.evaluate(async id => { const response = await fetch('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' }); return response.status; }, projectId).catch(() => 'failed');
          save();
        }
        console.log(`${result.status.toUpperCase()}: ${app.label}`);
      }
    }
  } finally { save(); await browser?.close(); console.log(`Results: ${directory}/results.json`); }
  if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
