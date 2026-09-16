import { test, expect } from '@playwright/test';
import { runPlatformLevelChecks } from './platform-checks';
import { InMemoryDataStore, executeBackendRequest, validateBackendFiles } from '../src/lib/backend-runner';
import { generateProjectZipBlob } from '../src/lib/zip-export';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

test.describe('Tier 5: Ultra-Advanced Next-Level Stress & Full-Stack Reliability', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
  });

  // =========================================================================
  // ADVANCED TEST 1: 50 Concurrent Mixed REST Operations & Store Integrity
  // =========================================================================
  test('adv-1: High-concurrency 50-request stress test on preview backend data store', async () => {
    const store = new InMemoryDataStore();
    const mockFiles: Record<string, string> = {
      '/server/index.js': `// server entry`,
      '/server/.env': `PORT=3001\nJWT_SECRET=super_secret_key`
    };

    // Spawn 25 concurrent POST creates
    const createPromises = Array.from({ length: 25 }).map((_, idx) => {
      return executeBackendRequest(mockFiles, {
        method: 'POST',
        url: 'http://localhost/api/stress_records',
        body: { name: `Record #${idx}`, value: idx * 10 }
      }, store);
    });

    const createResponses = await Promise.all(createPromises);
    for (const res of createResponses) {
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    }

    // Verify all 25 are stored without race conditions
    const allRecords = store.findAll('stress_records');
    expect(allRecords.length).toBe(25);

    // Now fire 25 concurrent mixed operations (10 reads, 10 updates, 5 deletes)
    const mixedPromises = [
      ...Array.from({ length: 10 }).map((_, idx) => {
        const id = allRecords[idx].id;
        return executeBackendRequest(mockFiles, {
          method: 'GET',
          url: `http://localhost/api/stress_records/${id}`
        }, store);
      }),
      ...Array.from({ length: 10 }).map((_, idx) => {
        const id = allRecords[idx + 10].id;
        return executeBackendRequest(mockFiles, {
          method: 'PUT',
          url: `http://localhost/api/stress_records/${id}`,
          body: { status: 'processed', priority: idx }
        }, store);
      }),
      ...Array.from({ length: 5 }).map((_, idx) => {
        const id = allRecords[idx + 20].id;
        return executeBackendRequest(mockFiles, {
          method: 'DELETE',
          url: `http://localhost/api/stress_records/${id}`
        }, store);
      })
    ];

    const mixedResponses = await Promise.all(mixedPromises);
    for (const res of mixedResponses) {
      expect(res.status).toBe(200);
    }

    // Remaining count should be exactly 20 (25 - 5 deleted)
    const remaining = store.findAll('stress_records');
    expect(remaining.length).toBe(20);
  });

  // =========================================================================
  // ADVANCED TEST 2: Dual-Layer Error Attribution & Auto-Fix Recovery Simulation
  // =========================================================================
  test('adv-2: Dual-layer error diagnosis (Frontend vs Backend) and auto-fix attribution', async () => {
    // 1. Validate clean backend
    const cleanFiles = {
      '/server/index.js': `import express from 'express'; const app = express();`,
      '/src/App.jsx': `export default function App() { return <div>Hello</div>; }`
    };
    const cleanError = validateBackendFiles(cleanFiles);
    expect(cleanError).toBeNull();

    // 2. Inject syntax error in backend file
    const brokenBackendFiles = {
      '/server/routes/api.js': `const router = express.Router(; // intentional syntax corruption`,
      '/src/App.jsx': `export default function App() { return <div>Hello</div>; }`
    };
    const backendError = validateBackendFiles(brokenBackendFiles);
    expect(backendError).not.toBeNull();
    expect(backendError?.error).toContain('[Backend Error]');
    expect(backendError?.file).toBe('/server/routes/api.js');

    // 3. Verify backend requests on broken runtime correctly attribute errors to backend layer
    const reqRes = await executeBackendRequest(brokenBackendFiles, {
      method: 'GET',
      url: 'http://localhost/api/health'
    });
    expect(reqRes.layer).toBe('backend');
  });

  // =========================================================================
  // ADVANCED TEST 3: Multi-Project Complete Data Isolation & State Switching
  // =========================================================================
  test('adv-3: Multi-project database and session isolation', async ({ page }) => {
    // Platform sanity check
    const platformResults = await runPlatformLevelChecks(page, 'adv-3');
    for (const res of platformResults) {
      expect(res.passed, `Platform check failed: ${res.checkName} - ${res.error}`).toBe(true);
    }

    // Test API store isolation by namespace
    const storeA = new InMemoryDataStore();
    const storeB = new InMemoryDataStore();

    storeA.create('projects', { name: 'Project Alpha Data', secretKey: 'alpha_999' });
    storeB.create('projects', { name: 'Project Beta Data', secretKey: 'beta_888' });

    const itemsA = storeA.findAll('projects');
    const itemsB = storeB.findAll('projects');

    expect(itemsA.length).toBe(1);
    expect(itemsB.length).toBe(1);
    expect(itemsA[0].name).toBe('Project Alpha Data');
    expect(itemsB[0].name).toBe('Project Beta Data');
    expect(itemsA[0].secretKey).not.toBe(itemsB[0].secretKey);
  });

  // =========================================================================
  // ADVANCED TEST 4: Full-Stack Project ZIP Export Structure
  // =========================================================================
  test('adv-4: Full-stack dual-service ZIP packaging verification', async () => {
    const fullStackFiles = {
      '/package.json': JSON.stringify({ name: 'fullstack-app', scripts: { dev: 'vite' } }),
      '/src/App.jsx': `export default function App() { return <h1>Full Stack</h1>; }`,
      '/server/index.js': `import express from 'express'; const app = express();`,
      '/server/routes/api.js': `export const router = {};`,
      '/server/controllers/items.js': `export const getItems = () => {};`,
      '/server/db.js': `export const db = {};`,
      '/server/.env': `PORT=3001\nJWT_SECRET=production_secret_key`
    };

    const zipBlob = await generateProjectZipBlob(fullStackFiles, 'FullStack_App_Test');
    expect(zipBlob).toBeDefined();
    expect(zipBlob.size).toBeGreaterThan(100);

    // Verify it generates a real binary zip buffer
    const arrayBuffer = await zipBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    // Standard ZIP signature is PK\x03\x04 (0x50, 0x4B, 0x03, 0x04)
    expect(uint8[0]).toBe(0x50);
    expect(uint8[1]).toBe(0x4B);
    expect(uint8[2]).toBe(0x03);
    expect(uint8[3]).toBe(0x04);
  });

  // =========================================================================
  // ADVANCED TEST 5: Edge Runtime Route & Subworker Dispatch Resolution
  // =========================================================================
  test('adv-5: Edge routing and live preview endpoint resilience', async ({ request }) => {
    // Healthcheck endpoint
    const healthRes = await request.get(`${BASE_URL}/preview/default/api/health`);
    expect(healthRes.status()).toBe(200);
    const health = await healthRes.json();
    expect(health.status).toBe('ok');

    // Query parameters filtering
    await request.post(`${BASE_URL}/preview/default/api/catalog`, {
      data: { category: 'electronics', title: 'Laptop Pro', price: 999 }
    });
    await request.post(`${BASE_URL}/preview/default/api/catalog`, {
      data: { category: 'books', title: 'Code Architecture', price: 49 }
    });

    const filteredRes = await request.get(`${BASE_URL}/preview/default/api/catalog?category=electronics`);
    expect(filteredRes.status()).toBe(200);
    const filtered = await filteredRes.json();
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    for (const item of filtered) {
      expect(item.category).toBe('electronics');
    }
  });
});
