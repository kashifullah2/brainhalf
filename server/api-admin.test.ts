import { describe, expect, it } from 'vitest';

import { onRequestGet as adminMetricsGet } from '../functions/api/admin/metrics';
import { onRequestGet as adminUsersGet } from '../functions/api/admin/users';
import { onRequestGet as meGet } from '../functions/api/auth/me';
import type { AppEnv } from './http';

// ---------------------------------------------------------------------------
// Authorization at the API layer, not in the UI.
//
// The admin gate used to be a client-side substring match on the signed-in
// user's email, display name and first name — and `firstName` comes straight from
// the signup form, so registering as "Kashif" was enough. There was no
// server-side admin endpoint to defeat, because there was no server-side admin
// endpoint at all.
//
// These tests exercise the endpoint directly: the browser has no say.
// ---------------------------------------------------------------------------

function stubEnv(email: string, extra: Partial<AppEnv> = {}): AppEnv {
  const userRow = {
    id: 'usr_1',
    email,
    first_name: 'Kashif',
    last_name: 'Ullah',
    picture_url: null,
    email_verified: 1,
    expires_at: '2099-01-01 00:00:00',
  };

  const make = (sql: string, _args?: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => make(sql, next),
    first: async () => (sql.includes('FROM sessions') ? userRow : null),
    run: async () => ({ success: true, meta: { changes: 1 } }),
    all: async () => ({ success: true, results: [] }),
  });

  return {
    DB: {
      prepare: (sql: string) => make(sql),
      batch: async (statements: Array<Record<string, unknown>>) =>
        statements.map(() => ({ success: true, results: [{ total: 0 }] })),
    },
    DOCUMENTS: {},
    ADMIN_EMAILS: 'owner@brainhalf.com',
    ...extra,
  } as unknown as AppEnv;
}

type Handler = (ctx: unknown) => Promise<Response>;

function call(handler: unknown, url: string, env: AppEnv): Promise<Response> {
  const request = new Request(url, {
    headers: { Cookie: 'bh_session=test-session-token' },
  });
  return (handler as Handler)({
    request,
    env,
    params: {},
    waitUntil: () => {},
  }) as Promise<Response>;
}

const METRICS_URL = 'https://app.example.com/api/admin/metrics';

describe('GET /api/admin/metrics', () => {
  it('serves an allowlisted account', async () => {
    const response = await call(adminMetricsGet, METRICS_URL, stubEnv('owner@brainhalf.com'));
    expect(response.status).toBe(200);
  });

  it('refuses an account whose first name matches the old client-side rule', async () => {
    // `first_name` is 'Kashif' in the stub row. Under the previous check that was
    // sufficient. It grants nothing now.
    const response = await call(adminMetricsGet, METRICS_URL, stubEnv('someone@example.com'));
    expect(response.status).toBe(404);
  });

  it('refuses an address that merely contains an allowlisted one', async () => {
    const response = await call(
      adminMetricsGet,
      METRICS_URL,
      stubEnv('owner@brainhalf.com.attacker.example'),
    );
    expect(response.status).toBe(404);
  });

  it('refuses an anonymous caller', async () => {
    const env = stubEnv('owner@brainhalf.com');
    const request = new Request(METRICS_URL);
    const response = await (adminMetricsGet as unknown as Handler)({
      request,
      env,
      params: {},
      waitUntil: () => {},
    });
    expect(response.status).toBe(401);
  });

  it('never returns a credential, or any part of one', async () => {
    const env = stubEnv('owner@brainhalf.com', {
      AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      HUNYUAN_API_KEY: 'hy-secret-value',
      RESEND_API_KEY: 're_secret_value',
    } as Partial<AppEnv>);

    const response = await call(adminMetricsGet, METRICS_URL, env);
    const body = await response.text();

    // The panel this replaces printed "AKIAX...4YZ" and "ONEDu...pAJ" — the first
    // and last characters of the real key and secret.
    expect(body).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(body).not.toContain('wJalrXUtnFEMI');
    expect(body).not.toContain('hy-secret-value');
    expect(body).not.toContain('re_secret_value');
    expect(body).not.toContain('AKIA');
    // Presence is reported, and nothing else.
    expect(JSON.parse(body).providers).toMatchObject({
      awsConfigured: true,
      defaultTier: 'hunyuan',
      transactionalEmail: true,
    });
  });
});

describe('GET /api/auth/me', () => {
  it('reports isAdmin from the server allowlist', async () => {
    const admin = await call(meGet, 'https://app.example.com/api/auth/me', stubEnv('owner@brainhalf.com'));
    expect((await admin.json() as { isAdmin: boolean }).isAdmin).toBe(true);

    const other = await call(meGet, 'https://app.example.com/api/auth/me', stubEnv('someone@example.com'));
    expect((await other.json() as { isAdmin: boolean }).isAdmin).toBe(false);
  });

  it('reports isAdmin false for an anonymous caller', async () => {
    const env = stubEnv('owner@brainhalf.com');
    const response = await (meGet as unknown as Handler)({
      request: new Request('https://app.example.com/api/auth/me'),
      env,
      params: {},
      waitUntil: () => {},
    });
    const body = await response.json() as { user: unknown; isAdmin: boolean };
    expect(body.user).toBeNull();
    expect(body.isAdmin).toBe(false);
  });
});

describe('GET /api/admin/users', () => {
  it('refuses an anonymous caller', async () => {
    const env = stubEnv('owner@brainhalf.com');
    const response = await (adminUsersGet as unknown as Handler)({
      request: new Request('https://app.example.com/api/admin/users'),
      env,
      params: {},
      waitUntil: () => {},
    });
    expect(response.status).toBe(401);
  });

  it('returns 404 for a signed-in non-admin', async () => {
    const response = await call(adminUsersGet, 'https://app.example.com/api/admin/users', stubEnv('user@example.com'));
    expect(response.status).toBe(404);
  });

  it('returns user list and summary metrics for an admin', async () => {
    const response = await call(adminUsersGet, 'https://app.example.com/api/admin/users', stubEnv('owner@brainhalf.com'));
    expect(response.status).toBe(200);
    const body = await response.json() as { summary: { totalUsers: number }; users: unknown[]; count: number };
    expect(body.summary).toBeDefined();
    expect(Array.isArray(body.users)).toBe(true);
  });
});

