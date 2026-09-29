/**
 * Capability-token auth for BrainHalf project previews.
 *
 * There are no user accounts at this layer, so each project's Durable Object
 * mints two unguessable capability tokens on first contact:
 *
 * - `ownerToken`: authorizes control-plane operations — the agent WebSocket,
 *   POST /preview/:id/api/sync and GET /preview/:id/api/files. It lives in
 *   the owner's browser localStorage only and is NEVER embedded in a served
 *   page.
 * - `previewToken`: authorizes calls to the project's generated backend
 *   (METHOD /preview/:id/api/*). It is injected into the served preview page's
 *   fetch bridge so the app's own frontend keeps working for anyone holding
 *   the preview link. It grants NO file or control-plane access.
 *
 * First-writer-wins bootstrap: when a project has no tokens yet, the first
 * mutation (first WebSocket connect, or first POST /api/sync) mints the pair
 * and hands the owner token to that caller. Project IDs are client-generated
 * random strings, so in practice the minter is the project creator.
 *
 * This is a framework-free module so it can be unit tested in isolation; the
 * ChatAgent Durable Object delegates to it.
 */

export interface ProjectTokens {
  ownerToken: string;
  previewToken: string;
}

/**
 * Minimal SQL interface: a template-tag function returning an iterable of
 * rows. Compatible with the Durable Object `this.sql` tag (whose cursor is
 * iterable) and with the in-memory stubs used in tests.
 */
export type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Iterable<Record<string, unknown>>;

export const OWNER_TOKEN_KEY = 'owner_token';
export const PREVIEW_TOKEN_KEY = 'preview_token';
export const TOKEN_HEADER = 'x-brainhalf-token';
export const TOKEN_QUERY_PARAM = 'token';

/** Maximum accepted token length (defense against absurd header/query values). */
const MAX_TOKEN_LENGTH = 256;

/**
 * Generates a 64-char hex capability secret. crypto.randomUUID is available
 * in Workers and in Node 19+.
 */
export function newCapabilitySecret(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return ((crypto as any).randomUUID() + (crypto as any).randomUUID()).replace(/-/g, '');
    }
  } catch {
    // fall through to Math.random fallback below
  }
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 48; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s + Date.now().toString(36);
}

/** Creates the project_meta table if it does not exist. Safe to call often. */
export function ensureTokenSchema(sql: SqlTag): void {
  try {
    sql`CREATE TABLE IF NOT EXISTS project_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
  } catch (e) {
    console.warn('ensureTokenSchema failed:', e);
  }
}

/** Returns the project's token pair, or null when the project is unclaimed. */
export function getProjectTokens(sql: SqlTag): ProjectTokens | null {
  try {
    const rows = [
      ...sql`SELECT key, value FROM project_meta WHERE key = ${OWNER_TOKEN_KEY} OR key = ${PREVIEW_TOKEN_KEY}`,
    ];
    let ownerToken: string | null = null;
    let previewToken: string | null = null;
    for (const row of rows) {
      if (row.key === OWNER_TOKEN_KEY && typeof row.value === 'string') ownerToken = row.value;
      if (row.key === PREVIEW_TOKEN_KEY && typeof row.value === 'string') previewToken = row.value;
    }
    if (ownerToken && previewToken) return { ownerToken, previewToken };
    return null;
  } catch {
    return null;
  }
}

/**
 * Mints and persists a fresh token pair (first-writer-wins). Callers must
 * ensure this only runs when getProjectTokens() returned null.
 */
export function mintProjectTokens(sql: SqlTag): ProjectTokens {
  const tokens: ProjectTokens = {
    ownerToken: newCapabilitySecret(),
    previewToken: newCapabilitySecret(),
  };
  sql`INSERT OR REPLACE INTO project_meta (key, value) VALUES (${OWNER_TOKEN_KEY}, ${tokens.ownerToken})`;
  sql`INSERT OR REPLACE INTO project_meta (key, value) VALUES (${PREVIEW_TOKEN_KEY}, ${tokens.previewToken})`;
  return tokens;
}

/** Returns existing tokens, minting them when the project is unclaimed. */
export function getOrCreateProjectTokens(sql: SqlTag): ProjectTokens {
  return getProjectTokens(sql) ?? mintProjectTokens(sql);
}

/**
 * Extracts a bearer token from a request: X-BrainHalf-Token header first,
 * then the ?token= query parameter (needed for WebSocket handshakes, where
 * browsers cannot set custom headers).
 */
export function readRequestToken(request: Request): string | null {
  try {
    const header = request.headers.get(TOKEN_HEADER);
    if (header && header.trim()) return sanitizeToken(header);
  } catch {
    // ignore and try the query param
  }
  try {
    const query = new URL(request.url).searchParams.get(TOKEN_QUERY_PARAM);
    if (query && query.trim()) return sanitizeToken(query);
  } catch {
    // ignore
  }
  return null;
}

function sanitizeToken(raw: string): string | null {
  const t = raw.trim();
  if (!t || t.length > MAX_TOKEN_LENGTH) return null;
  return t;
}

/**
 * Constant-time token comparison so a wrong guess leaks nothing useful
 * through timing.
 */
export function tokensEqual(presented: string | null | undefined, expected: string): boolean {
  if (typeof presented !== 'string' || presented.length !== expected.length || expected.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** JSON 403 response for missing/invalid capability tokens. */
export function tokenDeniedResponse(
  kind: 'owner' | 'preview',
  corsHeaders: Record<string, string> = {}
): Response {
  const message =
    kind === 'owner'
      ? 'Owner token required. This project is claimed by another browser session.'
      : 'Valid preview token required to call this project backend.';
  return new Response(JSON.stringify({ error: 'forbidden', message }), {
    status: 403,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
