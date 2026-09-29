import { readStreamJson } from '../runtime/integrations';
import { RuntimeError } from '../runtime/types';
import { isValidEmail } from './crypto';

export interface GithubProfile { id: string; email: string; name: string }
export async function exchangeGithubCode(code: string, clientId: string, clientSecret: string, callback: string): Promise<GithubProfile> {
  if (!code || code.length > 4096) throw new RuntimeError('GitHub sign-in was cancelled or expired.');
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { Accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callback }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new RuntimeError('GitHub sign-in could not be completed.', 502); }
  const tokens = await readStreamJson(response.body, 64_000) as { access_token?: string };
  if (typeof tokens.access_token !== 'string' || tokens.access_token.length > 8192) throw new RuntimeError('GitHub sign-in could not be completed.', 502);
  const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'BrainHalf' };
  const userResponse = await fetch('https://api.github.com/user', { redirect: 'error', headers, signal: AbortSignal.timeout(15_000) });
  if (!userResponse.ok) { await userResponse.body?.cancel(); throw new RuntimeError('GitHub profile could not be verified.', 502); }
  const user = await readStreamJson(userResponse.body, 32_000) as { id?: unknown; name?: unknown; login?: unknown };
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) throw new RuntimeError('GitHub profile could not be verified.', 502);
  const emailsResponse = await fetch('https://api.github.com/user/emails', { redirect: 'error', headers, signal: AbortSignal.timeout(15_000) });
  if (!emailsResponse.ok) { await emailsResponse.body?.cancel(); throw new RuntimeError('GitHub profile could not be verified.', 502); }
  const emails = await readStreamJson(emailsResponse.body, 64_000) as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>;
  if (!Array.isArray(emails)) throw new RuntimeError('GitHub profile could not be verified.', 502);
  const primary = emails.find(entry => entry && entry.primary === true && entry.verified === true && isValidEmail(entry.email));
  if (!primary || !isValidEmail(primary.email)) throw new RuntimeError('A verified GitHub account email is required.', 403);
  const name = typeof user.name === 'string' && user.name.trim() ? user.name : typeof user.login === 'string' ? user.login : '';
  return { id: String(user.id), email: primary.email.trim().toLowerCase(), name: name.slice(0, 100) };
}
