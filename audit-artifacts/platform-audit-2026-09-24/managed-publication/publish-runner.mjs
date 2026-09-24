import { chromium, expect } from '/home/kashifullah/brainhalf/node_modules/@playwright/test/index.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForPlatformSignIn } from '/home/kashifullah/brainhalf/scripts/live-auth.mjs';
import { createEvidence, recordFrame, waitForGeneration } from '/home/kashifullah/brainhalf/scripts/test-live-model-apps.mjs';
import { CLIENT_SELECTABLE_MODELS, DEFAULT_MODEL_ID } from '/home/kashifullah/brainhalf/src/lib/models.ts';
import { BUSINESS_APPS, businessValidationPrompt } from '/home/kashifullah/brainhalf/src/lib/business-apps.ts';

if (process.argv[2] !== '--run') throw new Error('Use --run to create and publish one live test app.');
const origin = 'https://brainhalf.com';
const directory = resolve('audit-artifacts/platform-audit-2026-09-24/managed-publication');
mkdirSync(directory, { recursive: true });
const result = { startedAt: new Date().toISOString(), status: 'awaiting-sign-in' };
const save = () => writeFileSync(resolve(directory, 'fullstack-live.json'), JSON.stringify(result, null, 2) + '\n');
save();
const browser = await chromium.launchPersistentContext('/tmp/brainhalf-platform-audit-browser', { channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 } });
browser.setDefaultTimeout(30000);
const progressTimer = setInterval(save, 2000);
try {
  const context = browser;
  const login = await context.newPage();
  await login.goto(origin);
  console.log('Please sign in to BrainHalf in the opened Chrome window.');
  const page = await waitForPlatformSignIn(context, { origin, directory });
  result.status = 'creating'; save();
  const model = CLIENT_SELECTABLE_MODELS.find(item => item.name === DEFAULT_MODEL_ID);
  let evidence;
  page.on('websocket', socket => {
    if (!new URL(socket.url()).pathname.startsWith('/agents/')) return;
    socket.on('framesent', frame => { if (evidence) recordFrame(evidence, 'sent', frame.payload); if (evidence?.requests.length && !result.requestObservedAt) result.requestObservedAt = Date.now(); });
    socket.on('framereceived', frame => { if (evidence) recordFrame(evidence, 'received', frame.payload); if (evidence?.responseCharacters && !result.firstResponseAt) result.firstResponseAt = Date.now(); });
  });
  await page.goto(origin + '/?project=proj-0978089d-6817-4a1c-a648-03ca63075d39');
  await expect(page.getByLabel('Message to the app builder')).toBeVisible();
  const projectId = new URL(page.url()).searchParams.get('project');
  if (!projectId) throw new Error('No new project ID');
  result.projectId = projectId;
  await page.getByRole('button', { name: /^Rename project / }).click();
  await page.getByLabel('Rename project input').fill('Brainhalf Task Board Acceptance');
  await page.getByLabel('Rename project input').press('Enter');
  const files = JSON.parse(readFileSync('/tmp/brainhalf-managed-example-files.json', 'utf8'));
  result.projectId = projectId; result.source = 'Brainhalf managed Workers/D1 factory with a connected task-list frontend';
  result.status = 'syncing-source'; save();
  await page.goto(origin+'/dashboard');
  await page.evaluate(async ({projectId,files})=>{
    const session=await (await fetch('/api/auth/session')).json();
    const id=session.userId??session.user?.id; if(!id)throw new Error('No authenticated account');
    const prefix='brainhalf_account:'+encodeURIComponent(id)+':';
    localStorage.setItem(prefix+'brainhalf_files_'+projectId,JSON.stringify(files));
    await new Promise((resolve,reject)=>{const request=indexedDB.open('BrainHalfStorage');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const tx=db.transaction('files','readwrite');tx.objectStore('files').put(files,prefix+projectId);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  },{projectId,files});
  await context.request.get(origin + '/agents/chat-agent/' + projectId);
  const synced = await context.request.post(origin + '/preview/' + projectId + '/api/sync', { data: { files }, headers: { Origin: origin } });
  if (!synced.ok()) throw new Error('Source sync HTTP ' + synced.status() + ': ' + await synced.text());
  const saved = await (await context.request.get(origin + '/preview/' + projectId + '/api/files')).json();
  for (const [path, content] of Object.entries(files)) if (saved[path] !== content) throw new Error('Server source mismatch: ' + path);
  result.sourceFileCount = Object.keys(files).length;
  await page.goto(origin+'/?project='+projectId,{ waitUntil: 'networkidle' });
  await expect(page.getByRole('button', { name: 'Publish application', exact: true })).toBeVisible();

  const settings = await context.request.put(origin + '/api/projects/' + projectId + '/runtime/services?environment=production', {headers:{Origin:origin},data:{appName:'Brainhalf Task Board',passwordEnabled:false,magicLinkEnabled:false,emailEnabled:false,welcomeEnabled:false,googleEnabled:true}});
  if(!settings.ok()) throw new Error('Service setup failed: '+await settings.text());
  result.productionAuthentication='Google sign-in';
  result.status = 'publishing'; save();
  await expect.poll(async()=> {
    const r=await context.request.get(origin+'/api/projects/'+projectId+'/runtime/status?environment=development');
    const state=await r.json(); result.previewJobs=state.jobs;save();
    return (state.jobs||[]).some(j=>['queued','running','stopping'].includes(j.status));
  }, {timeout:12*60_000,intervals:[2000]}).toBe(false);
  const publishStarted = Date.now();
  await page.getByRole('button', { name: 'Publish application', exact: true }).click();
  let status;
  await expect.poll(async () => {
    const response = await context.request.get(`${origin}/api/projects/${projectId}/runtime/status?environment=production`);
    if (!response.ok()) throw new Error(`Runtime status HTTP ${response.status()}`);
    status = await response.json();
    result.dialog = await page.getByRole('dialog').innerText().catch(() => 'No dialog');
    await page.screenshot({path:resolve(directory,'publishing.png')});
    const job = status.jobs?.find(item => item.kind === 'publish' && item.createdAt >= publishStarted - 1000);
    result.currentJob = job; result.verification = status.verification; save();
    if (job && ['failed', 'stopped'].includes(job.status)) { const logs = await context.request.get(origin + '/api/projects/' + projectId + '/runtime/logs?environment=production&job=' + encodeURIComponent(job.id)); result.failureDetails = await logs.json(); save(); throw new Error(job.message || 'Publication failed'); }
    if (!job && Date.now()-publishStarted>20000) throw new Error('No publish job: '+result.dialog);
    return job?.status;
  }, { timeout: 12 * 60_000, intervals: [2000] }).toBe('passed');
  result.publishMs = Date.now() - publishStarted;
  result.productionUrl = status.productionUrl;
  result.release = status.activeRelease; result.verification = status.verification; result.jobs = status.jobs;
  const app = await context.newPage();
  const response = await app.goto(result.productionUrl);
  expect(response.status()).toBe(200);
  result.publicEndpoints = [];
  for (const path of ['/api/health', '/api/items']) { const start = Date.now(); const response = await context.request.get(result.productionUrl + path); result.publicEndpoints.push({ path, status: response.status(), ms: Date.now() - start }); }
  await app.screenshot({ path: resolve(directory, 'published-app.png'), fullPage: true });
  result.status = 'published'; result.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: result.status, url: result.productionUrl, generationMs: result.generationMs, publishMs: result.publishMs }));
} catch (error) {
  result.status = result.status === 'awaiting-sign-in' ? 'authentication-blocked' : 'failed';
  result.error = error.message; save(); console.error(error.message); process.exitCode = 1;
} finally { clearInterval(progressTimer); save(); await browser.close(); }
