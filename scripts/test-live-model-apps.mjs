import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { CLIENT_SELECTABLE_MODELS, DEFAULT_MODEL_ID } from '../src/lib/models.ts';
import { requireLiveTestOptIn } from '../tests/browser-policy.ts';
import { waitForPlatformSignIn } from './live-auth.mjs';

const origin = 'https://brainhalf.com';
const generationTimeout = 12 * 60 * 1000;

export function createEvidence(model, projectId) {
  return { model: model.name, provider: model.provider, projectId, requests: [], files: [], errors: [], response: '', responseCharacters: 0, completed: false, continuationPending: false };
}

// Record only test-project metadata, never WebSocket URLs, tickets or auth headers.
export function recordFrame(evidence, direction, raw) {
  let data;
  try { data = JSON.parse(String(raw)); } catch { return; }
  if (!data || typeof data !== 'object') return;
  if (direction === 'sent') {
    if (typeof data.prompt !== 'string') return;
    evidence.requests.push({ model: data.model, provider: data.provider, projectId: data.projectId });
    evidence.completed = false;
    evidence.continuationPending = false;
    if (data.model !== evidence.model || data.provider !== evidence.provider || data.projectId !== evidence.projectId) {
      evidence.errors.push('The generation request did not use the selected model, provider and test project.');
    }
    return;
  }
  if (evidence.requests.length === 0) return;
  if (data.type === 'error') evidence.errors.push(String(data.error || data.message || 'Generation failed'));
  if (data.type === 'trigger-auto-reply') evidence.continuationPending = true;
  if (data.type === 'stream' && typeof data.chunk?.response === 'string') {
    evidence.responseCharacters += data.chunk.response.length;
    evidence.response = (evidence.response + data.chunk.response).slice(0, 64000);
  }
  if (data.type === 'stream' && data.chunk?.done) evidence.completed = true;
  if (data.type === 'stopped') evidence.errors.push('Generation stopped before the app check completed.');
  if (data.type === 'file_updated' && typeof data.path === 'string' && !evidence.files.includes(data.path)) evidence.files.push(data.path);
}

export function assertGenerationEvidence(evidence) {
  if (evidence.errors.length) throw new Error(evidence.errors.join('\n'));
  if (!evidence.requests.length) throw new Error('No generation request was observed.');
  if (!evidence.completed || evidence.continuationPending) throw new Error('Generation has not completed.');
  if (!evidence.files.length) throw new Error('No generated file updates were observed; the starter is not a successful app.');
}

export function appPrompt(title) {
  return `/build Create a complete responsive React task tracker named "${title}". Implement the app now, not just a plan. This is a browser-only app: no backend, hosting job or external API is needed. Use localStorage for persistence. Include one visible h1 with exactly "${title}". Provide a text input with the accessible label "New task", a button named "Add task", and a list with the accessible label "Tasks". Each task is a list item containing its text, a checkbox labelled "Complete TASK_TEXT", and a button labelled "Delete TASK_TEXT" (replace TASK_TEXT with that task's actual text). Adding, completing and deleting must work; added tasks and completion state must survive reload. Use a polished pink and yellow design with no horizontal overflow on a 390px screen. Write all required app files and finish without asking questions.`;
}

export async function waitForGeneration(page, evidence) {
  const deadline = Date.now() + generationTimeout;
  while (Date.now() < deadline) {
    if (evidence.errors.length) throw new Error(evidence.errors.join('\n'));
    const download = page.getByRole('button', { name: 'Build downloadable app', exact: true });
    if (await download.isVisible()) await download.click();
    if (evidence.completed && !evidence.continuationPending && !await page.getByTestId('stop-generation-btn').isVisible()) {
      assertGenerationEvidence(evidence);
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error('App generation did not finish within 12 minutes.');
}

async function checkComposer(page, testId) {
  const button = page.getByTestId(testId);
  await expect(button).toBeVisible();
  await expect.poll(() => button.evaluate(element => {
    const box = element.getBoundingClientRect();
    const composer = element.closest('.chat-input-wrapper');
    if (!composer) return false;
    const wrapper = composer.getBoundingClientRect();
    const css = getComputedStyle(composer);
    return box.width >= 44 && box.height >= 44
      && box.right <= wrapper.right - parseFloat(css.paddingRight) + 1
      && box.left >= wrapper.left + parseFloat(css.paddingLeft) - 1
      && box.bottom <= wrapper.bottom - parseFloat(css.paddingBottom) + 1;
  })).toBe(true);
}

async function checkApp(page, title, directory, slug) {
  const preview = page.frameLocator('iframe[title="Application Preview"]').first();
  await expect(preview.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 60000 });
  const task = `Check ${slug}`;
  await preview.getByRole('textbox', { name: 'New task', exact: true }).fill(task);
  await preview.getByRole('button', { name: 'Add task', exact: true }).click();
  const row = preview.getByRole('list', { name: 'Tasks', exact: true }).getByRole('listitem').filter({ hasText: task });
  await expect(row).toHaveCount(1);
  await row.getByRole('checkbox', { name: `Complete ${task}`, exact: true }).check();
  await expect(row.getByRole('checkbox')).toBeChecked();
  await page.screenshot({ path: resolve(directory, `${slug}-desktop.png`), fullPage: true });

  // Reload the real workspace: the generated source and task state must persist.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(preview.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 60000 });
  await expect(row.getByRole('checkbox', { name: `Complete ${task}`, exact: true })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await checkComposer(page, 'send-prompt-btn');
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  await expect(preview.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect.poll(() => preview.locator('html').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await row.getByRole('button', { name: `Delete ${task}`, exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.screenshot({ path: resolve(directory, `${slug}-mobile.png`), fullPage: true });
}

export function selectedModels(args) {
  return args.includes('--all-models') ? CLIENT_SELECTABLE_MODELS : CLIENT_SELECTABLE_MODELS.filter(model => model.name === DEFAULT_MODEL_ID);
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/test-live-model-apps.mjs --run [--all-models]\nChecks one task app with the default model. --all-models explicitly checks every model. Sign in or create and verify an account in the opened Chrome window. Keep Chrome open until testing finishes. Keeps the test projects and writes screenshots/results under audit-artifacts/live-model-apps/. No local server or saved credentials are required.');
    return;
  }
  if (args.some(arg => !['--run', '--all-models'].includes(arg))) throw new Error('Unknown argument. Use --help.');
  requireLiveTestOptIn({ ...process.env, ...(args.includes('--run') ? { BRAINHALF_ALLOW_LIVE_TESTS: '1' } : {}) });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = resolve('audit-artifacts/live-model-apps', runId);
  mkdirSync(directory, { recursive: true });
  const models = selectedModels(args);
  const results = models.map(model => ({ model: model.name, provider: model.provider, status: 'not-run' }));
  const save = () => writeFileSync(resolve(directory, 'results.json'), JSON.stringify({ origin, runId, results }, null, 2) + '\n');
  save();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: false });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const login = await context.newPage();
    await login.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('Sign in to BrainHalf in the opened Chrome window. Testing starts after the server confirms your session and the signed-in page loads. You can use any tab in this window. Enter credentials only in the website.');
    await waitForPlatformSignIn(context, { origin, directory });
    for (const [index, model] of models.entries()) {
      const result = results[index];
      const slug = `${index + 1}-${model.name.replace(/[^a-zA-Z0-9-]+/g, '-')}`;
      const title = `BrainHalf ${runId} model ${index + 1}`;
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      let evidence;
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('websocket', socket => {
        if (!new URL(socket.url()).pathname.startsWith('/agents/')) return;
        socket.on('framesent', event => { if (evidence) recordFrame(evidence, 'sent', event.payload); });
        socket.on('framereceived', event => { if (evidence) recordFrame(evidence, 'received', event.payload); });
      });
      result.status = 'running';
      result.startedAt = new Date().toISOString();
      save();
      console.log(`[${index + 1}/${results.length}] Creating an app with ${model.name}`);
      try {
        await page.goto(`${origin}/dashboard`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'New project', exact: true }).click();
        await expect(page.getByLabel('Message to the app builder')).toBeVisible();
        const projectId = new URL(page.url()).searchParams.get('project');
        if (!projectId) throw new Error('New project did not produce a project URL.');
        result.projectUrl = `${origin}/?project=${encodeURIComponent(projectId)}`;
        evidence = createEvidence(model, projectId);
        const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
        if (await advanced.isVisible()) await advanced.click();
        await page.getByTestId('model-picker-btn').click();
        const option = page.getByTestId(`model-option-${model.name}`);
        if (await option.count() !== 1) throw new Error('Model is absent from the deployed picker. Deploy the current catalog before testing this model.');
        await option.click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.getByLabel('Message to the app builder').fill(appPrompt(title));
        await checkComposer(page, 'send-prompt-btn');
        await page.getByTestId('send-prompt-btn').click();
        // Assert containment during generation as well as in the idle state.
        await checkComposer(page, 'stop-generation-btn');
        await page.screenshot({ path: resolve(directory, `${slug}-generating-mobile.png`), fullPage: true });
        await page.setViewportSize({ width: 1440, height: 900 });
        await waitForGeneration(page, evidence);
        await checkApp(page, title, directory, slug);
        if (pageErrors.length) throw new Error(`Browser errors: ${pageErrors.join('; ')}`);
        result.status = 'passed';
        result.checks = ['selected model sent', 'generated files', 'unique app rendered', 'add task', 'complete task', 'reload persistence', 'delete task', 'mobile layout', 'Send/Stop containment'];
      } catch (error) {
        result.status = 'failed';
        result.error = error instanceof Error ? error.message : String(error);
        await page.screenshot({ path: resolve(directory, `${slug}-failed.png`), fullPage: true }).catch(() => {});
      } finally {
        result.evidence = evidence;
        result.browserErrors = pageErrors;
        result.finishedAt = new Date().toISOString();
        save();
        console.log(`${result.status.toUpperCase()}: ${model.name}${result.error ? ` — ${result.error}` : ''}`);
        // Stop only this runner's new project if a failed check leaves it active.
        const stop = page.getByTestId('stop-generation-btn');
        if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
        await page.close({ runBeforeUnload: false });
      }
    }
  } catch (error) {
    writeFileSync(resolve(directory, 'runner-error.txt'), String(error) + '\n');
    throw error;
  } finally {
    save();
    await browser?.close();
    console.log(`Results: ${resolve(directory, 'results.json')}`);
  }
  const passed = results.filter(result => result.status === 'passed').length;
  console.log(`${passed} passed; ${results.length - passed} failed or not run.`);
  if (passed !== results.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
