import { describe, it, expect, vi } from 'vitest';
import {
  AUTH_COOKIE,
  USER_ID_HEADER,
  extractToken,
  forbidden,
  getSessionSecret,
  injectUserId,
  isAllowedOrigin,
  unauthorized,
  verifySession,
} from '../lib/auth';
import { issueToken, sha256Hex } from '../lib/crypto';

const SECRET = 'gate-test-secret-must-be-32-chars-or-more';
const USER_ID = 'user-1';

/** The env verifySession reads: the signing secret plus the Registry stub. */
function envWith(registry: any) {
  return { SESSION_SECRET: SECRET, REGISTRY: registry as any };
}

/** Minimal Registry stub: 200 + {userId} for a known token hash, 401 otherwise. */
async function registryFor(token: string | null, userId = USER_ID) {
  const knownHash = token ? await sha256Hex(token) : null;
  const fetch = vi.fn(async (input: string | Request) => {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    if (url.pathname.startsWith('/sessions/') && knownHash && url.pathname.endsWith(knownHash)) {
      return new Response(JSON.stringify({ userId }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'no session' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  });
  return { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch })) };
}

describe('P1 Auth — session verification (fail closed)', () => {
  it('accepts a valid token carried in the Authorization header', async () => {
    const { token } = await issueToken(SECRET, USER_ID);
    const registry = await registryFor(token);
    const req = new Request('https://brainhalf.com/preview/proj-a/index.html', {
      headers: { authorization: `Bearer ${token}` },
    });
    const user = await verifySession(req, envWith(registry));
    expect(user).toEqual({ userId: USER_ID });
  });

  it('accepts a valid token carried in the session cookie', async () => {
    const { token } = await issueToken(SECRET, USER_ID);
    const registry = await registryFor(token);
    const req = new Request('https://brainhalf.com/preview/proj-a/index.html', {
      headers: { cookie: `${AUTH_COOKIE}=${token}; other=1` },
    });
    expect(await verifySession(req, envWith(registry))).toEqual({ userId: USER_ID });
  });

  it('accepts a valid token carried in the ?token= query (WebSocket transport)', async () => {
    const { token } = await issueToken(SECRET, USER_ID);
    const registry = await registryFor(token);
    const req = new Request(`https://brainhalf.com/agents/chat-agent/proj-a?token=${token}`);
    expect(await verifySession(req, envWith(registry))).toEqual({ userId: USER_ID });
  });

  it('denies a token whose session row has been revoked', async () => {
    const { token } = await issueToken(SECRET, USER_ID);
    const registry = await registryFor(null); // nothing is a known session
    const req = new Request('https://brainhalf.com/preview/proj-a/index.html', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await verifySession(req, envWith(registry))).toBeNull();
  });

  it('denies a session row belonging to a different user than the token claims', async () => {
    const { token } = await issueToken(SECRET, USER_ID);
    const registry = await registryFor(token, 'attacker');
    const req = new Request('https://brainhalf.com/preview/proj-a/index.html', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await verifySession(req, envWith(registry))).toBeNull();
  });

  it('denies when the Registry is unreachable (fail closed, no anonymous mode)', async () => {
    const { token } = await issueToken(SECRET, USER_ID);
    const broken = {
      idFromName: vi.fn(() => ({})),
      get: vi.fn(() => {
        throw new Error('Registry is down');
      }),
    };
    const req = new Request('https://brainhalf.com/preview/proj-a/index.html', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(await verifySession(req, envWith(broken))).toBeNull();
  });

  it('denies a missing token entirely', async () => {
    const registry = await registryFor(null);
    const req = new Request('https://brainhalf.com/preview/proj-a/index.html');
    expect(await verifySession(req, envWith(registry))).toBeNull();
  });
});

describe('P1 Auth — token extraction', () => {
  it('reads a bearer token and trims whitespace', () => {
    const req = new Request('https://x/y', { headers: { Authorization: 'Bearer   abc.def.ghi  ' } });
    expect(extractToken(req)).toBe('abc.def.ghi');
  });

  it('reads the first matching cookie among several', () => {
    const req = new Request('https://x/y', { headers: { cookie: `a=1; ${AUTH_COOKIE}=tok-abc; b=2` } });
    expect(extractToken(req)).toBe('tok-abc');
  });

  it('reads a query token', () => {
    const req = new Request('https://x/y?token=tok-q');
    expect(extractToken(req)).toBe('tok-q');
  });

  it('prefers the Authorization header, then cookie, then query', async () => {
    const req = new Request(`https://x/y?token=tok-q`, {
      headers: { authorization: 'Bearer tok-h', cookie: `${AUTH_COOKIE}=tok-c` },
    });
    expect(extractToken(req)).toBe('tok-h');
  });

  it('returns null when no token is present anywhere', () => {
    expect(extractToken(new Request('https://x/y'))).toBeNull();
    expect(extractToken(new Request('https://x/y', { headers: { authorization: 'Basic xyz' } }))).toBeNull();
  });
});

describe('P1 Auth — trusted user-id header', () => {
  it('sets the header on a copy and never mutates the original request', () => {
    const original = new Request('https://x/y', { method: 'POST' });
    const injected = injectUserId(original, USER_ID);
    expect(injected.headers.get(USER_ID_HEADER)).toBe(USER_ID);
    expect(original.headers.get(USER_ID_HEADER)).toBeNull();
  });

  it('strips a client-supplied copy before injecting', () => {
    const attacker = new Request('https://x/y', { headers: { [USER_ID_HEADER]: 'attacker' } });
    const injected = injectUserId(attacker, USER_ID);
    expect(injected.headers.get(USER_ID_HEADER)).toBe(USER_ID);
  });

  it('preserves the method and body of the original request', async () => {
    const original = new Request('https://x/y', { method: 'POST', body: 'payload' });
    const injected = injectUserId(original, USER_ID);
    expect(injected.method).toBe('POST');
    expect(await injected.text()).toBe('payload');
  });
});

describe('P1 Auth — origin allowlist', () => {
  it('allows the production and local dev origins', () => {
    expect(isAllowedOrigin('https://brainhalf.com')).toBe(true);
    expect(isAllowedOrigin('https://www.brainhalf.com')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:8788')).toBe(true);
  });

  it('rejects null, empty and foreign origins', () => {
    expect(isAllowedOrigin(null)).toBe(false);
    expect(isAllowedOrigin(undefined)).toBe(false);
    expect(isAllowedOrigin('')).toBe(false);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
    expect(isAllowedOrigin('https://brainhalf.com.evil.example')).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173.evil.example')).toBe(false);
  });
});

describe('P1 Auth — session secret resolution', () => {
  it('uses the configured secret when it is long enough', () => {
    const env = { SESSION_SECRET: SECRET };
    expect(getSessionSecret(env)).toBe(SECRET);
  });

  it('ignores a too-short configured secret and warns', () => {
    const env = { SESSION_SECRET: 'short' };
    expect(getSessionSecret(env)).not.toBe('short');
    expect(getSessionSecret(env).length).toBeGreaterThanOrEqual(32);
  });

  it('falls back to a random per-isolate key when unconfigured (never a hardcoded one)', () => {
    const a = getSessionSecret({});
    const b = getSessionSecret({ SESSION_SECRET: undefined });
    expect(a).toEqual(b); // memoised per isolate
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});

describe('P1 Auth — denial responses', () => {
  it('returns a 401 with a JSON body and a Bearer challenge', async () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(await res.json()).toEqual({ error: 'Authentication required' });
  });

  it('returns a 403 with a JSON body', async () => {
    const res = forbidden('You do not own this project');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'You do not own this project' });
  });
});
