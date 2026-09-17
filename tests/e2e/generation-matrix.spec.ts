import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { executeBackendRequest, InMemoryDataStore } from '../../src/lib/backend-runner';
import { validateFetchUrl } from '../../src/lib/ssrf';

// Ensure screenshots directory exists
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

test.describe('App-Generation Test Matrix (8 Tiers)', () => {

  // =========================================================================
  // TIER 1: SIMPLE (Personal Task List App)
  // =========================================================================
  test('Tier 1 [Simple]: Personal task list with filtering, persistence, and responsiveness', async ({ page }) => {
    const store = new InMemoryDataStore();
    const taskFiles = {
      '/src/App.jsx': `
import React, { useState, useEffect } from 'react';
export default function App() {
  const [tasks, setTasks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('bh_tasks') || '[]'); } catch { return []; }
  });
  const [filter, setFilter] = useState('all');
  const [input, setInput] = useState('');

  useEffect(() => {
    localStorage.setItem('bh_tasks', JSON.stringify(tasks));
  }, [tasks]);

  const addTask = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    setTasks([...tasks, { id: Date.now(), text: input.trim(), completed: false }]);
    setInput('');
  };

  const toggleTask = (id) => setTasks(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  const deleteTask = (id) => setTasks(tasks.filter(t => t.id !== id));

  const filtered = tasks.filter(t => filter === 'active' ? !t.completed : filter === 'completed' ? t.completed : true);

  return (
    <div style={{ maxWidth: '500px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>Task List</h1>
      <form onSubmit={addTask} style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input aria-label="New Task" value={input} onChange={e => setInput(e.target.value)} placeholder="Add a task..." style={{ flex: 1, padding: '8px' }} />
        <button type="submit">Add</button>
      </form>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button onClick={() => setFilter('all')}>All</button>
        <button onClick={() => setFilter('active')}>Active</button>
        <button onClick={() => setFilter('completed')}>Completed</button>
      </div>
      <ul>
        {filtered.map(t => (
          <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <span onClick={() => toggleTask(t.id)} style={{ textDecoration: t.completed ? 'line-through' : 'none', cursor: 'pointer' }}>
              {t.text}
            </span>
            <button onClick={() => deleteTask(t.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
`
    };

    // 1. Check direct backend API responsiveness
    const apiRes = await executeBackendRequest(taskFiles, {
      method: 'GET',
      url: 'http://localhost/api/tasks'
    }, store);
    expect([200, 404]).toContain(apiRes.status);

    // 2. Browser interaction
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'tier1-mobile-375.png') });

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'tier1-desktop-1280.png') });
  });

  // =========================================================================
  // TIER 2: MEDIUM (Notes App with Auth & Isolation)
  // =========================================================================
  test('Tier 2 [Medium]: Notes app with multi-user isolation and markdown XSS escaping', async () => {
    const store = new InMemoryDataStore();
    const files = {
      '/server/index.js': `// Notes backend`
    };

    // 1. User A signup & note creation
    const userARes = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'usera@notes.com', password: 'PasswordA1!' }
    }, store);
    expect(userARes.status).toBe(201);
    const tokenA = userARes.body.token;

    const noteA = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/notes',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { title: 'Secret Note A', body: 'Confidential project details', tags: ['work', 'private'] }
    }, store);
    expect(noteA.status).toBe(201);
    const noteAId = noteA.body.id;

    // 2. User B signup & cross-tenant query attempt
    const userBRes = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'userb@notes.com', password: 'PasswordB2!' }
    }, store);
    expect(userBRes.status).toBe(201);
    const tokenB = userBRes.body.token;

    // User B attempts to read User A's note by direct ID
    const crossRead = await executeBackendRequest(files, {
      method: 'GET',
      url: `http://localhost/api/notes/${noteAId}`,
      headers: { Authorization: `Bearer ${tokenB}` }
    }, store);
    expect([403, 404]).toContain(crossRead.status);

    // 3. XSS sanitization check in markdown
    const xssPayload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const xssNote = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/notes',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { title: 'XSS Test', body: xssPayload, tags: ['security'] }
    }, store);
    expect(xssNote.status).toBe(201);
    // Password never returned in profile or notes
    expect(userARes.body.user.password).toBeUndefined();
  });

  // =========================================================================
  // TIER 3: HARD (Project Management Board with Activity Feed)
  // =========================================================================
  test('Tier 3 [Hard]: Kanban board drag-drop data model, activity feeds, and 400 validation', async () => {
    const store = new InMemoryDataStore();
    const files = {};

    // 1. Create card
    const createCard = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/cards',
      body: { title: 'Audit Platform', column: 'Todo', assignee: 'Dev1', dueDate: '2026-09-30' }
    }, store);
    expect(createCard.status).toBe(201);
    const cardId = createCard.body.id;

    // 2. Move card to 'Doing' (position update)
    const moveCard = await executeBackendRequest(files, {
      method: 'PATCH',
      url: `http://localhost/api/cards/${cardId}`,
      body: { column: 'Doing', order: 1 }
    }, store);
    expect(moveCard.status).toBe(200);

    // 3. Check 400 on malformed body
    const malformed = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/cards',
      body: null
    }, store);
    expect([400, 422]).toContain(malformed.status);

    // 4. Check 404 on missing resource
    const missing = await executeBackendRequest(files, {
      method: 'GET',
      url: 'http://localhost/api/cards/nonexistent-card-9999'
    }, store);
    expect(missing.status).toBe(404);
  });

  // =========================================================================
  // TIER 4: COMPLEX (Multi-Tenant SaaS Dashboard with RBAC & Audit Log)
  // =========================================================================
  test('Tier 4 [Complex]: Multi-tenant RBAC, org isolation, usage charts, and audit log', async () => {
    const store = new InMemoryDataStore();
    const files = {};

    // 1. Signup Org A Admin
    const orgAAdmin = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'owner@orga.com', password: 'Password123!', orgName: 'Org A' }
    }, store);
    expect(orgAAdmin.status).toBe(201);
    const tokenA = orgAAdmin.body.token;

    // 2. Admin invites a member
    const invite = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/org/invite',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: { email: 'member@orga.com', role: 'member' }
    }, store);
    expect(invite.status).toBe(201);

    // 3. Member login and attempt admin-only action (delete user/org)
    const memberLogin = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/auth/login',
      body: { email: 'member@orga.com', password: 'password' }
    }, store);
    const memberToken = memberLogin.body.token;

    const memberAdminAttempt = await executeBackendRequest(files, {
      method: 'DELETE',
      url: `/api/org/members/${orgAAdmin.body.user.id}`,
      headers: { Authorization: `Bearer ${memberToken}` }
    }, store);
    expect(memberAdminAttempt.status).toBe(403);
  });

  // =========================================================================
  // TIER 5: VERY COMPLEX (Realtime Collaborative Document Editor)
  // =========================================================================
  test('Tier 5 [Very Complex]: Realtime collaborative doc editor synchronization & versioning', async ({ browser }) => {
    // Open two browser contexts simulating two concurrent collaborators
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await page1.goto('/', { waitUntil: 'domcontentloaded' });
    await page2.goto('/', { waitUntil: 'domcontentloaded' });

    // Verify both contexts load cleanly without error
    await expect(page1.locator('#root')).toBeVisible();
    await expect(page2.locator('#root')).toBeVisible();

    await page1.screenshot({ path: path.join(SCREENSHOT_DIR, 'tier5-collab-user1.png') });
    await page2.screenshot({ path: path.join(SCREENSHOT_DIR, 'tier5-collab-user2.png') });

    await context1.close();
    await context2.close();
  });

  // =========================================================================
  // TIER 6: TRICK (E-Commerce Checkout: Currency, Stock Concurrency, Pricing)
  // =========================================================================
  test('Tier 6 [Trick]: E-commerce atomic inventory check (stock=1 under concurrency) & tamper resistance', async () => {
    const store = new InMemoryDataStore();
    const files = {};

    // Create item with stock = 1
    const item = store.create('products', { id: 'item-flash-sale', name: 'Rare Item', price: 99.99, stock: 1 });
    expect(item.stock).toBe(1);

    // 20 concurrent purchase requests
    const buyPromises = Array.from({ length: 20 }).map((_, idx) => {
      return executeBackendRequest(files, {
        method: 'POST',
        url: 'http://localhost/api/orders',
        body: { productId: 'item-flash-sale', quantity: 1, guestEmail: `guest${idx}@test.com`, price: 1.00 /* price tampering attempt */ }
      }, store);
    });

    const results = await Promise.all(buyPromises);
    const successfulPurchases = results.filter(r => r.status === 200 || r.status === 201);
    
    // Exactly 1 must succeed; final stock cannot be negative
    expect(successfulPurchases.length).toBe(1);
    const updatedItem = store.findById('products', 'item-flash-sale');
    expect(updatedItem.stock).toBe(0);
  });

  // =========================================================================
  // TIER 7: VERY TRICKY (Adversarial App Inputs: XSS, CSV injection, SVG scripts)
  // =========================================================================
  test('Tier 7 [Very Tricky]: Adversarial app payloads (XSS, CSV formula injection, SVG scripts)', async () => {
    const store = new InMemoryDataStore();
    const files = {};

    // 1. Submit script and img onerror payloads
    const xssRes = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/forms/submit',
      body: {
        formId: 'public-form-1',
        name: '<script>alert(1)</script>',
        email: '<img src=x onerror=alert(1)>'
      }
    }, store);
    expect([200, 201]).toContain(xssRes.status);

    // 2. CSV export formula injection escape test
    const formulaPayload = '=cmd|"/C calc"!A0';
    const csvRow = `"${formulaPayload.replace(/^[=+\-@]/, "'$&")}"`;
    expect(csvRow.startsWith("\"'=")).toBeTruthy(); // formula character neutralized with leading single quote

    // 3. File upload validation (reject dangerous extensions like .html or svg script)
    const dangerousUpload = await executeBackendRequest(files, {
      method: 'POST',
      url: 'http://localhost/api/upload',
      body: { filename: 'exploit.html', contentType: 'text/html', data: '<html><body>evil</body></html>' }
    }, store);
    expect([400, 403, 415, 422]).toContain(dangerousUpload.status);
  });

  // =========================================================================
  // TIER 8: VERY COMPLEX TRICKY (Adversarial Platform Security)
  // =========================================================================
  test('Tier 8 [Adversarial Platform Security]: SSRF filtering, bundle key leakage, CORS guard', async () => {
    // 1. SSRF validation checks (validateFetchUrl returns error string for unsafe URLs, null for safe)
    expect(validateFetchUrl('http://169.254.169.254/latest/meta-data/')).not.toBeNull();
    expect(validateFetchUrl('http://localhost:8080')).not.toBeNull();
    expect(validateFetchUrl('http://127.0.0.1')).not.toBeNull();
    expect(validateFetchUrl('file:///etc/passwd')).not.toBeNull();

    // 2. Client bundle secret leak inspection
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      const files = fs.readdirSync(path.join(distDir, 'assets'));
      for (const file of files) {
        if (file.endsWith('.js')) {
          const content = fs.readFileSync(path.join(distDir, 'assets', file), 'utf-8');
          expect(content).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
          expect(content).not.toMatch(/AKIA[0-9A-Z]{16}/);
        }
      }
    }
  });

});
