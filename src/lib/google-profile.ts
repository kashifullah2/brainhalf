import { readStreamJson } from '../runtime/integrations';
import { RuntimeError } from '../runtime/types';
import { isValidEmail } from './crypto';

export interface GoogleProfile { sub: string; email: string; name: string }
export async function exchangeGoogleCode(code: string, clientId: string, clientSecret: string, verifier: string, callback: string): Promise<GoogleProfile> {
  if (!code || code.length > 4096) throw new RuntimeError('Google sign-in was cancelled or expired.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: callback }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new RuntimeError('Google sign-in could not be completed.', 502); }
  const tokens = await readStreamJson(response.body, 64_000) as { access_token?: string };
  if (typeof tokens.access_token !== 'string' || tokens.access_token.length > 8192) throw new RuntimeError('Google sign-in could not be completed.', 502);
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { redirect: 'error', headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!profileResponse.ok) { await profileResponse.body?.cancel(); throw new RuntimeError('Google profile could not be verified.', 502); }
  const profile = await readStreamJson(profileResponse.body, 32_000) as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
  if (typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 255 || !isValidEmail(profile.email) || profile.email_verified !== true) throw new RuntimeError('A verified Google account is required.', 403);
  return { sub: profile.sub, email: profile.email.trim().toLowerCase(), name: typeof profile.name === 'string' ? profile.name.slice(0, 100) : '' };
}
