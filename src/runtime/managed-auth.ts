import { base64urlEncode, hashPassword, isValidEmail, isValidPassword, randomId, sha256Hex, timingSafeEqual, verifyPassword } from '../lib/crypto';
import { exchangeGoogleCode, type GoogleProfile } from '../lib/google-profile';
import { cookie, readJson, secureCookie } from './integrations';
import { ManagedStore, type StoredUser } from './managed-store';
import { ManagedMail } from './managed-mail';
import { RuntimeError, type ProjectEnvironment } from './types';

const accepted = () => Response.json({ ok: true, message: 'If this address can be used, a link has been sent. In development, check the project test inbox.' }, { status: 202 });
const actionKinds = ['verify_email', 'reset_password', 'magic_link'] as const;
type ActionKind = typeof actionKinds[number];
const invalidLink = () => new RuntimeError('This link is invalid or expired. Request a new one.');
interface Action extends Record<string, SqlStorageValue> { user_id: string; kind: ActionKind }

export class ManagedAuth {
  constructor(readonly store: ManagedStore, readonly mail: ManagedMail) {}
  private async rate(request: Request, environment: ProjectEnvironment, email = '') {
    const ip = await sha256Hex(request.headers.get('CF-Connecting-IP') || 'unknown');
    this.store.limit(`auth-ip:${environment}:${ip}`, 20, 60_000);
    if (email) this.store.limit(`auth-email:${environment}:${await sha256Hex(email)}`, 6, 60_000);
  }
  private capacity(environment: ProjectEnvironment) {
    const count = this.store.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM managed_users WHERE environment=?', environment).toArray()[0].count;
    if (count >= 1000) throw new RuntimeError('This pilot app has reached its user limit.', 429);
  }
  private addUser(environment: ProjectEnvironment, email: string, name: string, passwordHash: string | null, google: string | null = null) {
    this.capacity(environment);
    const id = google ? 'google:' + google : 'app_' + crypto.randomUUID();
    this.store.sql.exec('INSERT INTO managed_users (environment,id,email,name,password_hash,google_sub,verified,created) VALUES (?,?,?,?,?,?,?,?)', environment, id, email, name, passwordHash, google, google ? 1 : 0, Date.now());
    return this.store.user(environment, id)!;
  }
  private async issue(environment: ProjectEnvironment, user: StoredUser, kind: ActionKind) {
    const raw = randomId('', 32); const hash = await sha256Hex(raw);
    // Keep previous links usable until their expiry. This prevents a third party
    // repeatedly requesting a new link from invalidating the owner's email.
    this.store.sql.exec('DELETE FROM managed_actions WHERE expires<=?', Date.now());
    this.store.sql.exec('INSERT INTO managed_actions VALUES (?,?,?,?,?)', hash, environment, user.id, kind, Date.now() + 30 * 60_000);
    const mode = kind === 'verify_email' ? 'verify' : kind === 'reset_password' ? 'reset' : 'magic';
    const actionUrl = `${this.store.deps.origin(environment)}/__brainhalf/auth?mode=${mode}#token=${raw}`;
    try { await this.mail.enqueue(environment, kind, user.email, { name: user.name || user.email, actionUrl }, hash); }
    catch (error) { this.store.sql.exec('DELETE FROM managed_actions WHERE hash=?', hash); throw error; }
  }
  async user(request: Request, environment: ProjectEnvironment): Promise<Record<string, unknown> | null> {
    const session = await this.store.deps.session(cookie(request, '__Host-bh_app'), 'app', environment);
    if (!session || typeof session.id !== 'string') return null;
    const managed = this.store.user(environment, session.id);
    if (!managed) return session; // Existing project Google sessions and private verification fixtures.
    return managed.disabled || !managed.verified ? null : { ...this.store.publicUser(managed) };
  }
  private async signIn(environment: ProjectEnvironment, user: StoredUser, redirect = false) {
    if (user.disabled || !user.verified) throw new RuntimeError('This account cannot sign in.', 403);
    this.store.sql.exec('UPDATE managed_users SET last_login=? WHERE environment=? AND id=?', Date.now(), environment, user.id);
    const identity = this.store.publicUser(this.store.user(environment, user.id)!);
    const session = await this.store.deps.createSession('app', environment, identity, 604800);
    const fresh = this.store.user(environment, user.id);
    if (!fresh || fresh.disabled || !fresh.verified || fresh.revision !== user.revision) {
      await this.store.deps.session(session, 'app', environment, true);
      throw new RuntimeError('Account changed. Sign in again.', 401);
    }
    const headers = new Headers({ 'Set-Cookie': secureCookie('__Host-bh_app', session, 604800), 'Cache-Control': 'no-store' });
    if (redirect) { headers.set('Location', '/'); headers.append('Set-Cookie', secureCookie('__Host-bh_oauth', '', 0)); return new Response(null, { status: 303, headers }); }
    return Response.json({ user: identity }, { headers });
  }
  private async googleUser(environment: ProjectEnvironment, profile: GoogleProfile) {
    let user = this.store.sql.exec<StoredUser>('SELECT * FROM managed_users WHERE environment=? AND google_sub=?', environment, profile.sub).toArray()[0];
    if (user) return user;
    user = this.store.byEmail(environment, profile.email);
    if (user) {
      if (user.disabled || (user.google_sub && user.google_sub !== profile.sub)) throw new RuntimeError('This account cannot use that Google identity.', 403);
      // Google proves mailbox ownership. An unverified pre-existing signup must
      // not retain an attacker's password or old links after this proof.
      if (!user.verified) this.store.revoke(environment, user.id);
      this.store.sql.exec('UPDATE managed_users SET google_sub=?,verified=1,password_hash=?,name=? WHERE environment=? AND id=?', profile.sub, user.verified ? user.password_hash : null, profile.name, environment, user.id);
      return this.store.user(environment, user.id)!;
    }
    return this.addUser(environment, profile.email, profile.name, null, profile.sub);
  }
  async handle(request: Request, environment: ProjectEnvironment): Promise<Response> {
    const url = new URL(request.url); const path = url.pathname;
    const settings = this.store.settings(environment);
    if (path === '/api/auth/config' && request.method === 'GET') {
      const providers = await this.store.readiness(environment);
      return Response.json({ appName: settings.appName, passwordEnabled: settings.passwordEnabled, magicLinkEnabled: settings.magicLinkEnabled, googleEnabled: settings.googleEnabled, emailReady: providers.emailReady, googleReady: providers.googleReady, development: environment === 'development' });
    }
    if (path === '/api/auth/session' && request.method === 'GET') return Response.json({ user: await this.user(request, environment) });
    if (path === '/api/auth/logout' && request.method === 'POST') {
      await this.store.deps.session(cookie(request, '__Host-bh_app'), 'app', environment, true);
      return Response.json({ ok: true }, { headers: { 'Set-Cookie': secureCookie('__Host-bh_app', '', 0) } });
    }
    if (path.startsWith('/api/auth/google/')) return this.google(request, environment);
    if (request.method !== 'POST') throw new RuntimeError('Method not allowed.', 405);
    const body = await readJson(request) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RuntimeError('Invalid authentication request.');
    if (['/api/auth/verify-email', '/api/auth/reset-password', '/api/auth/magic-link/complete'].includes(path)) {
      await this.rate(request, environment);
      const kind: ActionKind = path.endsWith('verify-email') ? 'verify_email' : path.endsWith('reset-password') ? 'reset_password' : 'magic_link';
      if ((kind === 'magic_link' && !settings.magicLinkEnabled) || (kind === 'reset_password' && !settings.passwordEnabled)) throw new RuntimeError('This sign-in method is disabled.', 403);
      if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token)) throw invalidLink();
      if (kind === 'reset_password' && !isValidPassword(body.password)) throw new RuntimeError('Use 8–512 printable characters for your password.');
      const hash = await sha256Hex(body.token);
      const lookup = () => this.store.sql.exec<Action>('SELECT user_id,kind FROM managed_actions WHERE hash=? AND environment=? AND kind=? AND expires>?', hash, environment, kind, Date.now()).toArray()[0];
      if (!lookup()) throw invalidLink();
      const passwordHash = kind === 'reset_password' ? await hashPassword(body.password as string) : null;
      // Recheck after hashing. Lookup, mutation and revocation have no awaits.
      const action = lookup(); if (!action) throw invalidLink();
      const user = this.store.user(environment, action.user_id);
      if (!user || user.disabled) throw invalidLink();
      if (kind === 'reset_password') {
        this.store.sql.exec('UPDATE managed_users SET password_hash=?,verified=1 WHERE environment=? AND id=?', passwordHash, environment, user.id);
        this.store.revoke(environment, user.id);
      } else {
        if (kind === 'magic_link' && !user.verified) {
          this.store.sql.exec('UPDATE managed_users SET password_hash=NULL WHERE environment=? AND id=?', environment, user.id);
          this.store.revoke(environment, user.id);
        }
        this.store.sql.exec('UPDATE managed_users SET verified=1 WHERE environment=? AND id=?', environment, user.id);
        this.store.sql.exec('DELETE FROM managed_actions WHERE environment=? AND user_id=? AND kind=?', environment, user.id, kind);
      }
      if (!user.verified && settings.welcomeEnabled) {
        try { await this.mail.enqueue(environment, 'welcome', user.email, { name: user.name || user.email }, 'welcome:' + user.id); }
        catch { /* Optional welcome delivery must not undo successful verification. */ }
      }
      if (kind === 'magic_link') return this.signIn(environment, this.store.user(environment, user.id)!);
      return Response.json({ ok: true, message: kind === 'reset_password' ? 'Password updated. Sign in with your new password.' : 'Email verified. You can now sign in.' });
    }
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!isValidEmail(email)) throw new RuntimeError('Enter a valid email address.');
    await this.rate(request, environment, email);
    if (path === '/api/auth/login') {
      if (!settings.passwordEnabled) throw new RuntimeError('Password sign-in is disabled.', 403);
      const user = this.store.byEmail(environment, email);
      const DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012';
      const hashToVerify = user?.password_hash || DUMMY_HASH;
      const valid = isValidPassword(body.password) && await verifyPassword(body.password, hashToVerify) && user?.password_hash;
      if (!valid || !user || user.disabled) throw new RuntimeError('Email or password is incorrect.', 401);
      if (!user.verified) throw new RuntimeError('Verify your email before signing in.', 403);
      // A reset/disable may have happened while password hashing was pending.
      const fresh = this.store.user(environment, user.id);
      if (!fresh || fresh.disabled || fresh.password_hash !== user.password_hash) throw new RuntimeError('Email or password is incorrect.', 401);
      return this.signIn(environment, fresh);
    }
    if (!['/api/auth/signup', '/api/auth/forgot-password', '/api/auth/resend-verification', '/api/auth/magic-link'].includes(path)) throw new RuntimeError('Authentication route not found.', 404);
    if (!(await this.store.readiness(environment)).emailReady) throw new RuntimeError('Email sign-in is not ready. Ask the app owner to finish email setup.', 503);
    let user = this.store.byEmail(environment, email);
    if (path === '/api/auth/signup') {
      if (!settings.passwordEnabled) throw new RuntimeError('Password signup is disabled.', 403);
      if (!isValidPassword(body.password)) throw new RuntimeError('Use 8–512 printable characters for your password.');
      if (!user) {
        const passwordHash = await hashPassword(body.password);
        user = this.store.byEmail(environment, email);
        if (!user) user = this.addUser(environment, email, typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '', passwordHash);
      }
      if (!user.verified && !user.disabled) await this.issue(environment, user, 'verify_email');
    } else if (path === '/api/auth/magic-link') {
      if (!settings.magicLinkEnabled) throw new RuntimeError('Email-link sign-in is disabled.', 403);
      if (!user) user = this.addUser(environment, email, '', null);
      if (!user.disabled) await this.issue(environment, user, 'magic_link');
    } else if (user && !user.disabled) {
      if (path === '/api/auth/forgot-password' && settings.passwordEnabled) await this.issue(environment, user, 'reset_password');
      if (path === '/api/auth/resend-verification' && !user.verified) await this.issue(environment, user, 'verify_email');
    }
    return accepted();
  }
  private async google(request: Request, environment: ProjectEnvironment) {
    const settings = this.store.settings(environment); const url = new URL(request.url);
    if (!settings.googleEnabled || request.method !== 'GET') throw new RuntimeError('Google sign-in is disabled.', 403);
    if (url.pathname === '/api/auth/google/start') {
      await this.rate(request, environment);
      if (!(await this.store.readiness(environment)).googleReady) throw new RuntimeError('Google sign-in is not configured for this app.', 503);
      const verifier = randomId('', 32);
      const state = await this.store.deps.createSession('oauth', environment, { verifier, mode: settings.googleMode }, 600);
      let location: string;
      if (settings.googleMode === 'managed') {
        const result = await this.store.platform<{ url: string }>('/google/start', environment, { proofHash: await sha256Hex(state) });
        location = result.url;
      } else {
        const config = (await this.store.deps.integration(environment)).google;
        if (!config) throw new RuntimeError('Google sign-in is not configured.', 503);
        const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        authorization.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: this.store.deps.origin(environment) + '/api/auth/google/callback', response_type: 'code', scope: 'openid email profile', state, code_challenge: base64urlEncode(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))), code_challenge_method: 'S256' }).toString();
        location = authorization.toString();
      }
      return new Response(null, { status: 302, headers: { Location: location, 'Set-Cookie': secureCookie('__Host-bh_oauth', state, 600) } });
    }
    const state = cookie(request, '__Host-bh_oauth');
    if (!state) throw invalidLink();
    if (url.pathname === '/api/auth/google/callback' && !timingSafeEqual(state, url.searchParams.get('state') || '')) throw invalidLink();
    const flow = await this.store.deps.session(state, 'oauth', environment, true);
    if (!flow) throw invalidLink();
    let profile: GoogleProfile;
    if (url.pathname === '/api/auth/google/complete' && flow.mode === 'managed') {
      profile = await this.store.platform<GoogleProfile>('/google/redeem', environment, { code: url.searchParams.get('code'), proofHash: await sha256Hex(state) });
    } else if (url.pathname === '/api/auth/google/callback' && flow.mode === 'custom' && typeof flow.verifier === 'string') {
      const config = (await this.store.deps.integration(environment)).google;
      if (!config) throw new RuntimeError('Google sign-in is not configured.', 503);
      profile = await exchangeGoogleCode(url.searchParams.get('code') || '', config.clientId, config.clientSecret, flow.verifier, this.store.deps.origin(environment) + '/api/auth/google/callback');
    } else throw invalidLink();
    return this.signIn(environment, await this.googleUser(environment, profile), true);
  }
  users(environment: ProjectEnvironment) {
    return this.store.sql.exec<StoredUser>('SELECT * FROM managed_users WHERE environment=? ORDER BY created DESC LIMIT 100', environment).toArray().map(user => this.store.publicUser(user));
  }
  updateUser(environment: ProjectEnvironment, id: string, input: Record<string, unknown>) {
    const user = this.store.user(environment, id); if (!user) throw new RuntimeError('User not found.', 404);
    if ('disabled' in input && typeof input.disabled !== 'boolean') throw new RuntimeError('Invalid account status.');
    if ('role' in input && input.role !== 'user' && input.role !== 'admin') throw new RuntimeError('Choose user or admin.');
    const disabled = typeof input.disabled === 'boolean' ? Number(input.disabled) : user.disabled;
    this.store.sql.exec('UPDATE managed_users SET disabled=?,role=? WHERE environment=? AND id=?', disabled, typeof input.role === 'string' ? input.role : user.role, environment, id);
    if (disabled) this.store.revoke(environment, id);
    return this.store.publicUser(this.store.user(environment, id)!);
  }
}
