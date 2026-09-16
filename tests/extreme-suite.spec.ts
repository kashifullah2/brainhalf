import { test, expect } from '@playwright/test';
import { runPlatformLevelChecks } from './platform-checks';
import { InMemoryDataStore, executeBackendRequest, validateBackendFiles } from '../src/lib/backend-runner';
import { pulseBoardFiles } from '../src/lib/templates/pulseboard';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';

/**
 * Test ID: extreme-1
 * Tier: extreme_full_stack
 * Title: Multi-Tenant SaaS Analytics Platform (PulseBoard)
 */
test.describe('Tier 6: Extreme Full-Stack — PulseBoard Multi-Tenant SaaS Analytics Platform', () => {

  // =========================================================================
  // PHASE 1: BUILD INTEGRITY & CODE TAB VERIFICATION
  // =========================================================================
  test('Phase 1: Build integrity, separate full-stack architecture, and zero console errors', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');

    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Run platform level stability checks
    await runPlatformLevelChecks(page, 'extreme-1: build integrity');

    // Verify full-stack architecture files
    expect(pulseBoardFiles['/server/index.js']).toBeDefined();
    expect(pulseBoardFiles['/server/.env']).toBeDefined();
    expect(pulseBoardFiles['/src/App.jsx']).toBeDefined();

    // Verify backend syntax & configuration validation
    const validation = validateBackendFiles(pulseBoardFiles);
    expect(validation).toBeNull(); // clean syntax

    expect(consoleErrors).toHaveLength(0);
  });

  // =========================================================================
  // PHASE 2: AUTH & MULTI-TENANT ISOLATION (ZERO LEAKAGE SLA)
  // =========================================================================
  test('Phase 2: Complete multi-tenant authentication and hard tenant data isolation', async () => {
    const store = new InMemoryDataStore();

    // 1. Sign up Org A admin
    const orgASignup = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'admin_a@acme.com', password: 'SecretPassword123!', orgName: 'Acme Corp' }
    }, store);

    expect(orgASignup.status).toBe(201);
    expect(orgASignup.body.token).toBeDefined();
    expect(orgASignup.body.user.role).toBe('admin');
    const tokenA = orgASignup.body.token;
    const orgAId = orgASignup.body.user.orgId;

    // 2. Reject duplicate email
    const duplicateSignup = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'admin_a@acme.com', password: 'DifferentPassword' }
    }, store);
    expect(duplicateSignup.status).toBe(400);
    expect(duplicateSignup.body.code).toBe('EMAIL_EXISTS');

    // 3. Login as Org A admin
    const orgALogin = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/login',
      body: { email: 'admin_a@acme.com', password: 'SecretPassword123!' }
    }, store);
    expect(orgALogin.status).toBe(200);
    expect(orgALogin.body.token).toBeDefined();

    // 4. Sign up Org B admin
    const orgBSignup = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'admin_b@beta.com', password: 'BetaPassword123!', orgName: 'Beta Logistics' }
    }, store);
    expect(orgBSignup.status).toBe(201);
    const tokenB = orgBSignup.body.token;
    const orgBId = orgBSignup.body.user.orgId;
    expect(orgBId).not.toBe(orgAId); // strictly distinct orgs

    // 5. As Org A admin, create 5 events
    for (let i = 1; i <= 5; i++) {
      const evRes = await executeBackendRequest(pulseBoardFiles, {
        method: 'POST',
        url: 'http://localhost/api/events',
        headers: { Authorization: `Bearer ${tokenA}` },
        body: { name: `Acme Event ${i}`, value: i * 100, category: 'Revenue' }
      }, store);
      expect(evRes.status).toBe(201);
    }

    // 6. Hard tenancy verification: Query events as Org B
    const orgBEvents = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/events',
      headers: { Authorization: `Bearer ${tokenB}` }
    }, store);
    expect(orgBEvents.status).toBe(200);
    // Org B must see 0 events (never Acme's events)
    const orgBEventsList = orgBEvents.body.events || orgBEvents.body;
    expect(orgBEventsList).toHaveLength(0);

    // 7. Cross-tenant tamper test: Org B attempts to access Org A's analytics endpoint directly
    const crossTenantAnalytics = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: `http://localhost/api/analytics?orgId=${orgAId}`,
      headers: { Authorization: `Bearer ${tokenB}` }
    }, store);
    expect(crossTenantAnalytics.status).toBe(403); // Forbidden
  });

  // =========================================================================
  // PHASE 3: EVENTS, SERVER-SIDE AGGREGATIONS & PAGINATION
  // =========================================================================
  test('Phase 3: Events CRUD, pagination (10 per page), and server-side aggregation math', async () => {
    const store = new InMemoryDataStore();

    // Signup user
    const signup = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'analyst@corp.com', password: 'Pass' }
    }, store);
    const token = signup.body.token;

    // Create 16 events across 2 categories and 3 dates
    const testEvents = [
      { name: 'Subscription Alpha', value: 120, category: 'Revenue', timestamp: '2026-09-01T10:00:00Z' },
      { name: 'Subscription Beta', value: 250, category: 'Revenue', timestamp: '2026-09-01T14:00:00Z' },
      { name: 'User Signup 1', value: 10, category: 'Signups', timestamp: '2026-09-01T16:00:00Z' },
      { name: 'Enterprise Contract', value: 1500, category: 'Revenue', timestamp: '2026-09-02T09:00:00Z' },
      { name: 'User Signup 2', value: 10, category: 'Signups', timestamp: '2026-09-02T11:00:00Z' },
      { name: 'User Signup 3', value: 10, category: 'Signups', timestamp: '2026-09-02T12:00:00Z' },
      { name: 'Add-on License', value: 80, category: 'Revenue', timestamp: '2026-09-03T08:00:00Z' },
      { name: 'Upgrade Tier', value: 300, category: 'Revenue', timestamp: '2026-09-03T10:00:00Z' },
      { name: 'User Signup 4', value: 10, category: 'Signups', timestamp: '2026-09-03T11:00:00Z' },
      { name: 'User Signup 5', value: 10, category: 'Signups', timestamp: '2026-09-03T12:00:00Z' },
      // Page 2 items
      { name: 'Extra Item 1', value: 50, category: 'Revenue', timestamp: '2026-09-03T13:00:00Z' },
      { name: 'Extra Item 2', value: 50, category: 'Revenue', timestamp: '2026-09-03T14:00:00Z' },
      { name: 'Extra Item 3', value: 50, category: 'Revenue', timestamp: '2026-09-03T15:00:00Z' },
      { name: 'Extra Item 4', value: 50, category: 'Revenue', timestamp: '2026-09-03T16:00:00Z' },
      { name: 'Extra Item 5', value: 50, category: 'Revenue', timestamp: '2026-09-03T17:00:00Z' },
      { name: 'Extra Item 6', value: 50, category: 'Revenue', timestamp: '2026-09-03T18:00:00Z' },
    ];

    let expectedTotalValue = 0;
    for (const ev of testEvents) {
      expectedTotalValue += ev.value;
      const res = await executeBackendRequest(pulseBoardFiles, {
        method: 'POST',
        url: 'http://localhost/api/events',
        headers: { Authorization: `Bearer ${token}` },
        body: ev
      }, store);
      expect(res.status).toBe(201);
    }

    // Check pagination: Page 1 must have exactly 10 rows
    const page1Res = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/events?page=1&limit=10',
      headers: { Authorization: `Bearer ${token}` }
    }, store);
    expect(page1Res.status).toBe(200);
    expect(page1Res.body.events).toHaveLength(10);
    expect(page1Res.body.total).toBe(16);
    expect(page1Res.body.totalPages).toBe(2);

    // Check pagination: Page 2 must have 6 rows
    const page2Res = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/events?page=2&limit=10',
      headers: { Authorization: `Bearer ${token}` }
    }, store);
    expect(page2Res.status).toBe(200);
    expect(page2Res.body.events).toHaveLength(6);

    // Server-side Aggregated Analytics Verification
    const analyticsRes = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/analytics',
      headers: { Authorization: `Bearer ${token}` }
    }, store);
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.kpis.totalEvents).toBe(16);
    // Exact sum check (tolerance 0.01)
    expect(Math.abs(analyticsRes.body.kpis.totalValue - expectedTotalValue)).toBeLessThan(0.01);

    // Date range filter test: only 2026-09-01
    const filteredAnalytics = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/analytics?startDate=2026-09-01T00:00:00Z&endDate=2026-09-01T23:59:59Z',
      headers: { Authorization: `Bearer ${token}` }
    }, store);
    expect(filteredAnalytics.status).toBe(200);
    expect(filteredAnalytics.body.kpis.totalEvents).toBe(3);
    expect(filteredAnalytics.body.kpis.totalValue).toBe(380); // 120 + 250 + 10
  });

  // =========================================================================
  // PHASE 4: ROLES & ORG SETTINGS (ADMIN VS MEMBER RESTRICTIONS)
  // =========================================================================
  test('Phase 4: Role-based access control, member invitation, and member session revocation', async () => {
    const store = new InMemoryDataStore();

    // 1. Signup Admin
    const adminSignup = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'ceo@saas.com', password: 'SecretAdminPassword' }
    }, store);
    const adminToken = adminSignup.body.token;

    // 2. Admin invites a member
    const inviteRes = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/org/invite',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email: 'staff@saas.com', role: 'member' }
    }, store);
    expect(inviteRes.status).toBe(201);
    const memberId = inviteRes.body.member.id;

    // 3. Login as the non-admin member
    const memberLogin = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/login',
      body: { email: 'staff@saas.com', password: 'some_password' }
    }, store);
    const memberToken = memberLogin.body.token;

    // 4. Non-admin member attempts to delete another member -> must be rejected with 403
    const unauthorizedRemoval = await executeBackendRequest(pulseBoardFiles, {
      method: 'DELETE',
      url: `http://localhost/api/org/members/${adminSignup.body.user.id}`,
      headers: { Authorization: `Bearer ${memberToken}` }
    }, store);
    expect(unauthorizedRemoval.status).toBe(403); // Forbidden

    // 5. Admin removes the member
    const adminRemoval = await executeBackendRequest(pulseBoardFiles, {
      method: 'DELETE',
      url: `http://localhost/api/org/members/${memberId}`,
      headers: { Authorization: `Bearer ${adminToken}` }
    }, store);
    expect(adminRemoval.status).toBe(200);

    // 6. Verify removed member's active session is now invalidated
    const memberSubsequentCall = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/events',
      headers: { Authorization: `Bearer ${memberToken}` }
    }, store);
    expect(memberSubsequentCall.status).toBe(401); // Unauthorized: Session revoked
  });

  // =========================================================================
  // PHASE 5: RESILIENCE, IDEMPOTENCY & LOGOUT
  // =========================================================================
  test('Phase 5: Rapid form submission deduplication, session invalidation, and logout flow', async () => {
    const store = new InMemoryDataStore();

    const signup = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/signup',
      body: { email: 'tester@pulse.com', password: 'Pass' }
    }, store);
    const token = signup.body.token;

    // 1. Rapid 10x event submission in rapid burst (< 500ms)
    const burstPromises = Array.from({ length: 10 }).map(() => {
      return executeBackendRequest(pulseBoardFiles, {
        method: 'POST',
        url: 'http://localhost/api/events',
        headers: { Authorization: `Bearer ${token}` },
        body: { name: 'Rapid Click Event', value: 99.99, category: 'Revenue' }
      }, store);
    });
    const burstResults = await Promise.all(burstPromises);
    for (const r of burstResults) {
      expect([200, 201]).toContain(r.status);
    }

    // Verify deduplication prevented 10 duplicate rows
    const allEvents = store.findAll('events');
    expect(allEvents.length).toBe(1); // deduplicated into 1 event

    // 2. Logout flow
    const logoutRes = await executeBackendRequest(pulseBoardFiles, {
      method: 'POST',
      url: 'http://localhost/api/auth/logout',
      headers: { Authorization: `Bearer ${token}` }
    }, store);
    expect(logoutRes.status).toBe(200);

    // 3. Direct API call with logged-out token must be rejected
    const postLogoutCall = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/events',
      headers: { Authorization: `Bearer ${token}` }
    }, store);
    expect(postLogoutCall.status).toBe(401);
  });

  // =========================================================================
  // AUTO-FIX EVALUATION HARNESS
  // =========================================================================
  test('Auto-Fix Evaluation: backend attribution, route mismatch detection, and zero security regressions', async () => {
    // 1. Backend syntax error test
    const brokenBackendFiles = {
      '/server/index.js': `const app = express(;; // Syntax error`,
      '/server/.env': `PORT=4000`
    };
    const syntaxReport = validateBackendFiles(brokenBackendFiles);
    expect(syntaxReport).not.toBeNull();
    expect(syntaxReport?.error).toContain('[Backend Error]');
    expect(syntaxReport?.file).toBe('/server/index.js');

    // 2. Tenancy security verification: Assert no cross-tenant query bypass
    const store = new InMemoryDataStore();
    store.create('events', { orgId: 100, name: 'Private 100', value: 100 });
    store.create('events', { orgId: 200, name: 'Private 200', value: 200 });

    const tenantCheck = await executeBackendRequest(pulseBoardFiles, {
      method: 'GET',
      url: 'http://localhost/api/events',
      headers: { Authorization: 'Bearer invalid_or_missing_token' }
    }, store);
    expect(tenantCheck.status).toBe(401); // Requires auth, rejects open access
  });

});
