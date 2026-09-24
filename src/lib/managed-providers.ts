import { WorkerEntrypoint } from 'cloudflare:workers';
import { getRegistry, type RegistryEnv } from './auth';
import { base64urlEncode, isValidEmail, randomId, sha256Hex, timingSafeEqual } from './crypto';
import { exchangeGoogleCode } from './google-profile';
import { readJson, readStreamJson, cookie, secureCookie } from '../runtime/integrations';
import { assertScope, environmentFrom, RuntimeError } from '../runtime/types';
import { MailProviderError, resendStatus, sendResend } from '../runtime/mail-provider';
import type { EmailPayload, ManagedContext, ProviderReadiness } from '../runtime/managed-types';

export interface ManagedProviderEnv extends RegistryEnv {
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string; RESEND_FROM_EMAIL?: string;
  MANAGED_AUTH_ORIGIN?: string; MANAGED_APPS_DOMAIN?: string;
}
const callbackPath = '/api/auth/google/callback';
const oauthCookie = '__Host-bh_apps_oauth';
const keyPattern = /^[A-Za-z0-9_-]{43}$/;
type Flow = ManagedContext & { kind: string; proofHash: string; verifier?: string; profile?: { sub: string; email: string; name: string } };
const originFor = (env: ManagedProviderEnv) => env.MANAGED_AUTH_ORIGIN || 'https://brainhalf.com';
async function registry<T>(env: ManagedProviderEnv, path: string, body?: unknown): Promise<T> {
  const response = await getRegistry(env).fetch('https://registry' + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) });
  if (!response.ok) throw new RuntimeError('Managed account service is unavailable.', 503);
  return await readStreamJson(response.body, 32_000) as T;
}
async function scopeFor(value: { projectId?: unknown; ownerId?: unknown; environment?: unknown }, env: ManagedProviderEnv): Promise<ManagedContext> {
  const scope = { projectId: String(value.projectId || ''), ownerId: String(value.ownerId || '') };
  assertScope(scope);
  const environment = environmentFrom(value.environment);
  const alias = (await sha256Hex(scope.projectId)).slice(0, 32);
  const origin = `https://${environment === 'development' ? 'dev-' : ''}${alias}.${env.MANAGED_APPS_DOMAIN || 'apps.brainhalf.com'}`;
  return { ...scope, environment, origin };
}
async function readiness(env: ManagedProviderEnv, ownerId: string): Promise<ProviderReadiness> {
  const owner = await registry<{ email: string; verified: boolean }>(env, '/admin/managed-owner?ownerId=' + encodeURIComponent(ownerId));
  return {
    ownerEmail: owner.email, ownerVerified: owner.verified,
    emailReady: owner.verified && !!env.RESEND_API_KEY && isValidEmail(env.RESEND_FROM_EMAIL),
    googleReady: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
    from: env.RESEND_FROM_EMAIL || '', googleCallback: originFor(env) + callbackPath,
  };
}
async function storeFlow(env: ManagedProviderEnv, flow: Flow, kind: 'state' | 'handoff') {
  const key = randomId('', 32);
  await registry(env, '/oauth/store', { key, kind, data: flow });
  return key;
}
async function consume(env: ManagedProviderEnv, key: unknown, kind: 'state' | 'handoff'): Promise<Flow | null> {
  if (typeof key !== 'string' || !keyPattern.test(key)) return null;
  return registry<Flow | null>(env, '/oauth/consume', { key, kind });
}

/** Only a trusted runtime service binding can call this entrypoint. */
export class ManagedProviders extends WorkerEntrypoint<ManagedProviderEnv> {
  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') throw new RuntimeError('Method not allowed.', 405);
      const input = await readJson(request, 32_000) as Record<string, unknown>;
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RuntimeError('Invalid request.');
      const scope = await scopeFor(input, this.env);
      const path = new URL(request.url).pathname;
      if (path === '/outcomes') {
        await registry(this.env, '/outcomes', { ...(input.event as object), ownerId: scope.ownerId, projectId: scope.projectId });
        return Response.json({ ok: true });
      }
      const config = await readiness(this.env, scope.ownerId);
      if (path === '/config') return Response.json(config);
      if (path === '/google/start') {
        if (!config.googleReady) throw new RuntimeError('BrainHalf Google sign-in is not configured.', 503);
        if (typeof input.proofHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.proofHash)) throw new RuntimeError('Invalid sign-in proof.');
        const ticket = await storeFlow(this.env, { ...scope, kind: 'managed_launch', proofHash: input.proofHash }, 'handoff');
        return Response.json({ url: originFor(this.env) + '/api/apps/google/start?ticket=' + ticket });
      }
      if (path === '/google/redeem') {
        const flow = await consume(this.env, input.code, 'handoff');
        if (!flow || flow.kind !== 'managed_identity' || flow.projectId !== scope.projectId || flow.ownerId !== scope.ownerId || flow.environment !== scope.environment || flow.origin !== scope.origin || typeof input.proofHash !== 'string' || !timingSafeEqual(flow.proofHash, input.proofHash) || !flow.profile) throw new RuntimeError('Sign-in expired. Start again.', 401);
        return Response.json(flow.profile);
      }
      if (path === '/email/status') return Response.json(await resendStatus(this.env.RESEND_API_KEY || '', String(input.id || '')));
      if (path === '/email') {
        if (!config.emailReady) throw new RuntimeError(config.ownerVerified ? 'Managed email is not configured.' : 'Verify your BrainHalf account email to activate managed email.', 503);
        const payload = input.payload as EmailPayload;
        if (!payload || !isValidEmail(payload.to) || typeof payload.subject !== 'string' || !payload.subject || payload.subject.length > 200 || /[\r\n]/.test(payload.subject) || typeof payload.text !== 'string' || payload.text.length > 12_000 || typeof payload.html !== 'string' || payload.html.length > 24_000 || (payload.replyTo && !isValidEmail(payload.replyTo))) throw new RuntimeError('Invalid email.');
        if (typeof input.key !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.key)) throw new RuntimeError('An email idempotency key is required.');
        const key = await sha256Hex(`${scope.ownerId}:${scope.projectId}:${scope.environment}:${input.key}`);
        const name = typeof input.appName === 'string' ? input.appName.replace(/[\r\n<>"\\]/g, '').slice(0, 60) : 'BrainHalf app';
        return Response.json(await sendResend(this.env.RESEND_API_KEY!, `${name} via BrainHalf <${config.from}>`, payload, key));
      }
      throw new RuntimeError('Managed service not found.', 404);
    } catch (error) {
      return Response.json({ error: error instanceof RuntimeError || error instanceof MailProviderError ? error.message : 'Managed service unavailable.', retryable: error instanceof MailProviderError ? error.retryable : true }, { status: error instanceof RuntimeError ? error.status : error instanceof MailProviderError ? 502 : 503 });
    }
  }
}

/** Public navigation endpoints. No credentials or Google tokens reach generated apps. */
export async function handleManagedGoogle(request: Request, env: ManagedProviderEnv): Promise<Response> {
  const url = new URL(request.url);
  const clear = secureCookie(oauthCookie, '', 0);
  let target = originFor(env) + '/';
  try {
    if (request.method !== 'GET' || url.origin !== originFor(env)) throw new RuntimeError('Invalid sign-in request.');
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new RuntimeError('Google sign-in is unavailable.', 503);
    if (url.pathname === '/api/apps/google/start') {
      const launch = await consume(env, url.searchParams.get('ticket'), 'handoff');
      if (!launch || launch.kind !== 'managed_launch') throw new RuntimeError('Sign-in link expired. Start from your app.', 401);
      const expected = await scopeFor(launch, env);
      if (launch.origin !== expected.origin) throw new RuntimeError('Invalid app origin.');
      const verifier = randomId('', 32);
      const key = await storeFlow(env, { ...launch, kind: 'managed_google', verifier }, 'state');
      const state = 'mg_' + key;
      const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorization.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: originFor(env) + callbackPath, response_type: 'code', scope: 'openid email profile', state, code_challenge: base64urlEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
      return new Response(null, { status: 303, headers: { Location: authorization.toString(), 'Set-Cookie': secureCookie(oauthCookie, state, 600), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    }
    const state = url.searchParams.get('state') || '';
    if (!/^mg_[A-Za-z0-9_-]{43}$/.test(state) || !timingSafeEqual(state, cookie(request, oauthCookie) || '')) throw new RuntimeError('Sign-in expired. Start again.', 401);
    const flow = await consume(env, state.slice(3), 'state');
    if (!flow || flow.kind !== 'managed_google' || !flow.verifier) throw new RuntimeError('Sign-in expired. Start again.', 401);
    const expected = await scopeFor(flow, env);
    if (flow.origin !== expected.origin) throw new RuntimeError('Invalid app origin.');
    target = flow.origin + '/__brainhalf/auth?mode=login&error=google';
    if (url.searchParams.has('error')) throw new RuntimeError('Google sign-in was cancelled.');
    const profile = await exchangeGoogleCode(url.searchParams.get('code') || '', env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, flow.verifier, originFor(env) + callbackPath);
    const code = await storeFlow(env, { ...expected, kind: 'managed_identity', proofHash: flow.proofHash, profile }, 'handoff');
    target = flow.origin + '/api/auth/google/complete?code=' + code;
  } catch { /* Only fixed, server-validated destinations are used for errors. */ }
  return new Response(null, { status: 303, headers: { Location: target, 'Set-Cookie': clear, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
