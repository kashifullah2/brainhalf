import { test, expect } from '@playwright/test';

test.describe('API Endpoint Verification', () => {
  test('reaches API endpoints and receives structured responses', async ({ request }) => {
    // Test that backend dev middleware responds to /api/ requests
    const res = await request.get('/api/auth/session');
    expect(res.status()).toBeLessThan(500); // Should return 401/404 or 200, never an unhandled 500 crash
    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('application/json');
  });
});
