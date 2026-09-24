import { getRegistry, getSessionSecret, isAllowedOrigin, json, sessionResponse, type RegistryEnv } from './auth';
import { base64urlEncode, issueToken, randomId, sha256Hex, TOKEN_TTL_SECONDS } from './crypto';

interface GoogleEnv extends RegistryEnv { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }
const COOKIE = 'bh_google';
const CALLBACK = '/api/auth/google/callback';
const FLOW_TTL = 600;

function cookie(value: string, request: Request, seconds: number): string {
  return `${COOKIE}=${value}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${seconds}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
function readCookie(request: Request): string {
  return (request.headers.get('cookie') || '').match(/(?:^|;\s*)bh_google=([A-Za-z0-9_-]+)/)?.[1] || '';
}
async function registry(env: RegistryEnv, path: string, body: unknown): Promise<any> {
  const response = await getRegistry(env).fetch(`https://registry${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error('Registry unavailable');
  return result;
}
function redirect(request: Request, returnTo: string, result: string, handoff?: string): Response {
  const target = new URL(returnTo);
  target.searchParams.set('google', result);
  return new Response(null, { status: 303, headers: {
    Location: target.toString(), 'Set-Cookie': cookie(handoff || '', request, handoff ? 60 : 0),
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } });
}

/** Authorization code flow: PKCE and a browser-bound, single-use state. */
export async function handleGoogleAuth(request: Request, env: GoogleEnv): Promise<Response> {
  const url = new URL(request.url);
  const callback = url.pathname === CALLBACK;
  if (request.method !== (callback ? 'GET' : 'POST')) return json(405, { error: 'Method not allowed' });
  // Fetch endpoints must be initiated by the app. Only the state-checked
  // callback accepts a top-level navigation from Google.
  const origin = request.headers.get('origin');
  if (!callback && (!origin || !isAllowedOrigin(origin))) return json(403, { error: 'Untrusted request origin' });
  let returnTo = `${url.origin}/`;
  try {
    if (url.pathname === '/api/auth/google/complete') {
      const ticket = readCookie(request);
      if (!ticket) return json(401, { error: 'Google sign-in expired. Please try again.' });
      const user = await registry(env, '/oauth/consume', { key: ticket, kind: 'handoff' });
      if (!user?.userId || !user?.email) return json(401, { error: 'Google sign-in expired. Please try again.' });
      const { token } = await issueToken(getSessionSecret(env), user.userId, TOKEN_TTL_SECONDS);
      await registry(env, '/sessions', { tokenHash: await sha256Hex(token), userId: user.userId, expiresAt: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS });
      const response = sessionResponse(200, { user: { id: user.userId, email: user.email }, token });
      response.headers.append('Set-Cookie', cookie('', request, 0));
      return response;
    }
    if (!env.GOOGLE_CLIENT_ID?.trim() || !env.GOOGLE_CLIENT_SECRET?.trim()) {
      return callback ? redirect(request, returnTo, 'unavailable') : json(503, { error: 'Google sign-in is not available yet. Please continue with email.' });
    }
    if (!callback) {
      const body = await request.json().catch(() => null) as { project?: unknown } | null;
      const target = new URL('/', origin!);
      if (typeof body?.project === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(body.project)) target.searchParams.set('project', body.project);
      const state = randomId('', 32);
      const verifier = randomId('', 32);
      const redirectUri = `${url.origin}${CALLBACK}`;
      await registry(env, '/oauth/store', { key: state, kind: 'state', data: { verifier, returnTo: target.toString(), redirectUri }, ttl: FLOW_TTL });
      const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorization.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile',
        state, code_challenge: base64urlEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
        code_challenge_method: 'S256', prompt: 'select_account',
      }).toString();
      const response = json(200, { url: authorization.toString() });
      response.headers.set('Set-Cookie', cookie(state, request, FLOW_TTL));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const state = url.searchParams.get('state');
    if (!state || state.length !== 43 || state !== readCookie(request)) return redirect(request, returnTo, 'expired');
    const flow = await registry(env, '/oauth/consume', { key: state, kind: 'state' });
    if (!flow?.verifier || !flow?.returnTo || !isAllowedOrigin(new URL(flow.returnTo).origin)) return redirect(request, returnTo, 'expired');
    returnTo = flow.returnTo;
    if (url.searchParams.has('error')) return redirect(request, returnTo, 'cancelled');
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) return redirect(request, returnTo, 'failed');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000),
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: flow.redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }),
    });
    const tokens = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokens.access_token) return redirect(request, returnTo, 'failed');
    // Identity comes from Google's authenticated userinfo endpoint, never from
    // an unverified decoded ID token or client-supplied email.
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000),
    });
    const profile = await profileResponse.json() as { sub?: string; email?: string; email_verified?: boolean };
    if (!profileResponse.ok || profile.email_verified !== true || !profile.sub || !profile.email) return redirect(request, returnTo, 'unverified');
    const identity = await registry(env, '/auth/google', { subject: profile.sub, email: profile.email });
    if (identity.conflict) return redirect(request, returnTo, 'existing_account');
    if (!identity.userId || !identity.email) return redirect(request, returnTo, 'failed');
    const handoff = randomId('', 32);
    await registry(env, '/oauth/store', { key: handoff, kind: 'handoff', data: identity, ttl: 60 });
    // The URL carries only a UI status. The one-use handoff stays HttpOnly;
    // the durable session is issued on the app's subsequent POST.
    return redirect(request, returnTo, 'complete', handoff);
  } catch {
    return callback ? redirect(request, returnTo, 'failed') : json(503, { error: 'Google sign-in could not finish. Please try again or use email.' });
  }
}
