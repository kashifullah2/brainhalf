import { test, expect, type Page } from '@playwright/test';
import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';

const scenariosPath = path.resolve(process.cwd(), 'tests/agent-scenarios.json');
const scenarios = JSON.parse(fs.readFileSync(scenariosPath, 'utf-8'));

const WORKER_URL = process.env.WORKER_URL || scenarios.config.workerUrl;
const AGENT_PATH = process.env.AGENT_PATH || scenarios.config.agentPath;
const AUTH_TOKEN = process.env.AUTH_TOKEN !== undefined ? process.env.AUTH_TOKEN : scenarios.config.authToken;

const WS_URL = WORKER_URL.replace(/^http/, 'ws') + AGENT_PATH;
const HTTP_URL = WORKER_URL + AGENT_PATH;
const PREVIEW_BASE = WORKER_URL + scenarios.config.previewBasePath;

function withToken(url: string, token: string) {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

async function connectAgentWS(token: string): Promise<{ ws: WebSocket, inbox: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(withToken(WS_URL, token));
    const inbox: any[] = [];
    ws.on('message', raw => {
      try { inbox.push(JSON.parse(raw.toString())); } catch { inbox.push({ raw: raw.toString() }); }
    });
    ws.once('open', () => resolve({ ws, inbox }));
    ws.once('error', reject);
    ws.once('unexpected-response', (_req, res) => reject(new Error(`Unexpected response: ${res.statusCode}`)));
  });
}

async function waitFor(inbox: any[], predicate: (m: any) => boolean, timeoutMs = 30000, pollMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = inbox.find(predicate);
    if (hit) return hit;
    await new Promise(r => setTimeout(r, pollMs));
  }
  return null;
}

test.describe('Agent E2E Scenarios', () => {
  test.setTimeout(90000);

  for (const t of scenarios.tests) {
    test(`[${t.id}] ${t.feature}`, async ({ page, request }) => {
      const sessionId = `test-session-${t.id}-${Date.now()}`;
      const uniqueAgentPath = `/agents/chat-agent/${sessionId}`;
      const uniqueWsUrl = WORKER_URL.replace(/^http/, 'ws') + uniqueAgentPath;
      const uniquePreviewUrl = `${WORKER_URL}/preview/${sessionId}`;

      const skipAuth = t.skipAuth === true;
      const effectiveToken = skipAuth ? '' : AUTH_TOKEN;

      async function connectUniqueWS(token: string) {
        return new Promise<{ ws: WebSocket, inbox: any[] }>((resolve, reject) => {
          const ws = new WebSocket(withToken(uniqueWsUrl, token));
          const inbox: any[] = [];
          ws.on('message', raw => {
            try { inbox.push(JSON.parse(raw.toString())); } catch { inbox.push({ raw: raw.toString() }); }
          });
          ws.once('open', () => resolve({ ws, inbox }));
          ws.once('error', reject);
        });
      }

      // 1. Setup Phase
      if (t.setupFiles && !skipAuth) {
        const { ws } = await connectUniqueWS(effectiveToken);
        const augmentedFiles: Record<string, string> = {};
        for (const [path, content] of Object.entries(t.setupFiles as Record<string, string>)) {
          let augmented = content;
          if ((path.endsWith('.jsx') || path.endsWith('.tsx')) && !augmented.includes('import React')) {
            augmented = "import React from 'react';\n" + augmented;
          }
          augmentedFiles[path] = augmented;
        }
        ws.send(JSON.stringify({ type: 'sync_files', files: augmentedFiles, replace_all: false }));
        await new Promise(r => setTimeout(r, 500));
        ws.close();
      }

      // 2. Chat Phase (if applicable)
      if (t.type.startsWith('chat_')) {
        const { ws, inbox } = await connectUniqueWS(effectiveToken);
        
        const prompts = t.promptSequence || (t.prompt ? [t.prompt] : []);
        for (let i = 0; i < prompts.length; i++) {
          ws.send(JSON.stringify({ type: 'prompt', prompt: prompts[i] }));
          // Wait for stream to finish
          const done = await waitFor(inbox, m => m.type === 'stream' && m.chunk?.done === true, 60000);
          expect(done).toBeTruthy();
          
          if (t.expect.fileUpdatedPathContains) {
            const fileUpdate = inbox.find(m => m.type === 'file_updated' && m.path.includes(t.expect.fileUpdatedPathContains));
            expect(fileUpdate).toBeTruthy();
          }
          inbox.length = 0; // Clear inbox for next turn
        }
        ws.close();
      }

      // 3. Preview Phase
      if (t.expect.httpStatus) {
        if (skipAuth && !AUTH_TOKEN) {
           console.log(`Skipping strict auth check for ${t.id} because no AUTH_TOKEN configured`);
           return;
        }
        const reqUrl = t.navigateWithTokenFirst ? withToken(uniquePreviewUrl, effectiveToken) : (skipAuth ? uniquePreviewUrl : withToken(uniquePreviewUrl, effectiveToken));
        const res = await request.get(reqUrl);
        expect(res.status()).toBe(t.expect.httpStatus);
        if (t.expect.httpStatus !== 200) return; // test ends
      }

      // We need to capture postMessage to the parent window
      page.on('console', msg => console.log(`[PAGE CONSOLE] ${msg.type()}: ${msg.text()}`));
      await page.addInitScript(() => {
        window.__postMessages = [];
        window.parent = window as any; // Trick the iframe into sending to itself
        window.addEventListener('message', (e) => {
          if (e.data && e.data.type) {
            window.__postMessages.push(e.data.type);
          }
        });
      });

      const navUrl = t.navigateWithTokenFirst ? withToken(uniquePreviewUrl, effectiveToken) : uniquePreviewUrl;
      await page.goto(navUrl, { waitUntil: 'networkidle' });

      if (t.thenReloadWithoutToken) {
        await page.goto(uniquePreviewUrl, { waitUntil: 'networkidle' }); // load without token
      }

      // 4. Assertions
      const exp = t.expect;

      if (exp.postMessageType || exp.postMessageTypeAfterFix) {
        const targetType = exp.postMessageType || exp.postMessageTypeAfterFix;
        await page.waitForFunction((type) => (window as any).__postMessages.includes(type), targetType, { timeout: 10000 }).catch(() => {});
        const msgs: string[] = await page.evaluate(() => (window as any).__postMessages);
        expect(msgs).toContain(targetType);
      }

      if (exp.domSelector || exp.domSelectorAfterFix) {
        const sel = exp.domSelector || exp.domSelectorAfterFix;
        await page.waitForSelector(sel, { timeout: 10000 });
      }

      if (exp.domTextContains || exp.domTextContainsAfterFix) {
        const sel = exp.domSelector || exp.domSelectorAfterFix || 'body';
        const txt = exp.domTextContains || exp.domTextContainsAfterFix;
        const locator = page.locator(sel).first();
        await expect(locator).toContainText(txt, { timeout: 10000 });
      }

      if (exp.domShouldNotContain) {
        const bodyText = await page.locator('body').innerText();
        expect(bodyText).not.toContain(exp.domShouldNotContain);
      }
    });
  }
});
