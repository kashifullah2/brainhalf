import { describe, it, expect, vi } from 'vitest';

/**
 * The preview/agent request path used to carry the 30-day HMAC session token in
 * a query string on four non-WebSocket destinations (the live preview iframe,
 * two "open in a new tab" buttons, and the deploy modal's preview link) where an
 * httpOnly SameSite cookie already authenticated the navigation. Model-generated
 * code running at that URL could read the token out of `location.href`.
 *
 * The remaining URL transport is a single-use ticket, minted for an already
 * verified user, deleted on use. These tests cover both.
 */
import { extractWsTicket, issueWsTicket, verifyWsTicket } from '../lib/auth';
import { sha256Hex } from '../lib/crypto';

const USER_ID = 'user-1';

/** Registry double that models the real ticket store: hash-keyed, single-use. */
function ticketRegistry() {
  const store = new Map<string, { userId: string; expiresAt: number }>();
  const fetch = vi.fn(async (input: string | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? new URL(input) : new URL(input.url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.pathname === '/ws-tickets' && init?.method === 'POST') {
      // Real shape: a random secret, stored hashed, returned once.
      const ticket = 'bhwt_' + 'x'.repeat(32);
      store.set(await sha256Hex(ticket), {
        userId: body.userId,
        expiresAt: Date.now() + 60_000,
      });
      return new Response(JSON.stringify({ ticket }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/ws-tickets/verify' && init?.method === 'POST') {
      const hash = await sha256Hex(body.ticket);
      const row = store.get(hash);
      store.delete(hash); // single-use, exactly as the handler does
      if (!row) return new Response(JSON.stringify({ error: 'Ticket not found' }), { status: 401 });
      if (row.expiresAt <= Date.now())
        return new Response(JSON.stringify({ error: 'Ticket expired' }), { status: 401 });
      return new Response(JSON.stringify({ userId: row.userId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });
  return { idFromName: vi.fn(() => ({})), get: vi.fn(() => ({ fetch })) };
}

describe('P1 — WebSocket ticket transport', () => {
  it('mints a redeemable ticket for a verified user', async () => {
    const registry = ticketRegistry();
    const ticket = await issueWsTicket({ REGISTRY: registry as any }, USER_ID);
    expect(ticket).toMatch(/^bhwt_/);
    expect(await verifyWsTicket({ REGISTRY: registry as any }, ticket!)).toBe(USER_ID);
  });

  it('refuses a second use of the same ticket', async () => {
    const registry = ticketRegistry();
    const env = { REGISTRY: registry as any };
    const ticket = (await issueWsTicket(env, USER_ID))!;
    expect(await verifyWsTicket(env, ticket)).toBe(USER_ID);
    // Replay: the row is gone, so the handshake is refused.
    expect(await verifyWsTicket(env, ticket)).toBeNull();
  });

  it('refuses a ticket that was never issued', async () => {
    const registry = ticketRegistry();
    const env = { REGISTRY: registry as any };
    expect(await verifyWsTicket(env, 'bhwt_' + 'y'.repeat(32))).toBeNull();
  });

  it('fails closed when the Registry is unreachable', async () => {
    const broken = {
      idFromName: vi.fn(() => ({})),
      get: vi.fn(() => ({ fetch: vi.fn(() => Promise.reject(new Error('registry down'))) })),
    };
    expect(await issueWsTicket({ REGISTRY: broken as any }, USER_ID)).toBeNull();
    expect(await verifyWsTicket({ REGISTRY: broken as any }, 'bhwt_z')).toBeNull();
  });
});

describe('P1 — ticket extraction is format-checked', () => {
  it('reads a well-formed ?ticket= parameter', () => {
    const req = new Request('https://brainhalf.com/agents/chat-agent/proj-a?ticket=bhwt_abc123');
    expect(extractWsTicket(req)).toBe('bhwt_abc123');
  });

  it('returns null when the URL has no ticket', () => {
    const req = new Request('https://brainhalf.com/agents/chat-agent/proj-a');
    expect(extractWsTicket(req)).toBeNull();
  });

  it('returns null for a value that is not a ticket', () => {
    // A raw session token in a URL is no longer a recognized transport here.
    const req = new Request('https://brainhalf.com/agents/chat-agent/proj-a?token=bh_payload.sig');
    expect(extractWsTicket(req)).toBeNull();
  });
});

describe('P1 — the long-lived token is absent from navigational URLs', () => {
  // `withWsTokenQuery` no longer exists; `withWsAuthQuery` is the only URL
  // transport and it carries a ticket. This guards against the helper being
  // reintroduced at a destination that a script can read.
  it('exposes no token-appending helper for navigational destinations', async () => {
    const mod = await import('../lib/auth-client');
    expect(mod).not.toHaveProperty('withTokenQuery');
    expect(typeof mod.withWsAuthQuery).toBe('function');
  });

  // vitest runs in the node environment; auth-client talks to `localStorage`,
  // so a minimal store stands in for the browser one.
  function installLocalStorage(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    return () => delete (globalThis as any).localStorage;
  }

  it('rejects a ticket request when authentication is refused', async () => {
    const url = 'wss://brainhalf.com/agents/chat-agent/proj-a';
    // No stored session token → nothing to authenticate with → no credential
    // in the URL, and the caller surfaces the failure.
    const restore = installLocalStorage();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    try {
      const m = await mod_import();
      await expect(m.withWsAuthQuery(url)).rejects.toThrow('Session changed');
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  });

  it('never falls back to putting the session token in the URL', async () => {
    // A valid-looking stored token is present, but the ticket endpoint refuses.
    // The old behaviour appended the token itself; the URL must stay clean.
    const url = 'wss://brainhalf.com/agents/chat-agent/proj-a';
    const restore = installLocalStorage({ bh_session_token: 'bh_payload.signature' });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
    try {
      const m = await mod_import();
      await expect(m.withWsAuthQuery(url)).rejects.toThrow('Session changed');
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  });

  it('appends a ticket when one is issued', async () => {
    const url = 'wss://brainhalf.com/agents/chat-agent/proj-a';
    const restore = installLocalStorage({ bh_session_token: 'bh_payload.signature' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ticket: 'bhwt_abc123' }), { status: 201 })
    );
    try {
      const m = await mod_import();
      expect(await m.withWsAuthQuery(url)).toBe(`${url}?ticket=bhwt_abc123`);
    } finally {
      fetchSpy.mockRestore();
      restore();
    }
  });

  it('bounds a stalled ticket request without leaking the session token or waiting forever', async () => {
    vi.useFakeTimers();
    const restore = installLocalStorage({ bh_session_token: 'bh_private_session.signature' });
    let signal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      signal = init?.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    try {
      const m = await mod_import();
      const result = expect(m.withWsAuthQuery('wss://brainhalf.com/agents/chat-agent/proj-a')).rejects.toThrow('sign-in check timed out');
      await vi.advanceTimersByTimeAsync(15_000);
      await result;
      expect(signal?.aborted).toBe(true); expect(fetchSpy).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally { fetchSpy.mockRestore(); restore(); vi.useRealTimers(); }
  });
});

function mod_import() {
  return import('../lib/auth-client');
}
