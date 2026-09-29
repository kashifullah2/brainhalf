import { afterEach, describe, expect, it, vi } from 'vitest';
import { exchangeGithubCode } from '../lib/github-profile';
import { validateIntegration } from '../runtime/secrets';

function githubApi(profile: { id?: unknown; name?: unknown; login?: unknown } = {}, emails: unknown[] = [{ email: 'Person@Example.com', primary: true, verified: true }]) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes('login/oauth/access_token')) return Response.json({ access_token: 'github-access-token' });
    if (url.endsWith('api.github.com/user')) return Response.json({ id: 424242, name: 'Test Person', login: 'testperson', ...profile });
    return Response.json(emails);
  });
}

describe('GitHub profile exchange', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('trades the code for a token and resolves the primary verified email', async () => {
    const provider = githubApi();
    vi.stubGlobal('fetch', provider);
    const profile = await exchangeGithubCode('single-use-code', 'Ov23liTESTCLIENT123', 'secret', 'https://app.example.com/api/auth/github/callback');
    expect(profile).toEqual({ id: '424242', email: 'person@example.com', name: 'Test Person' });
    const tokenRequest = provider.mock.calls[0];
    expect(String(tokenRequest[0])).toBe('https://github.com/login/oauth/access_token');
    expect(((tokenRequest[1] as RequestInit).body as URLSearchParams).get('client_secret')).toBe('secret');
    expect(String(provider.mock.calls[1][0])).toBe('https://api.github.com/user');
    expect(((provider.mock.calls[1][1] as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer github-access-token');
  });
  it('falls back to the login name and rejects unverified primary email', async () => {
    vi.stubGlobal('fetch', githubApi({ name: null }, [{ email: 'person@example.com', primary: true, verified: false }]));
    await expect(exchangeGithubCode('code', 'client', 'secret', 'https://app.example.com/cb')).rejects.toMatchObject({ status: 403 });
    vi.stubGlobal('fetch', githubApi({ name: null }));
    await expect(exchangeGithubCode('code', 'client', 'secret', 'https://app.example.com/cb')).resolves.toMatchObject({ name: 'testperson' });
  });
  it('fails without leaking provider details on token, profile, or malformed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'sensitive' }, { status: 400 })));
    await expect(exchangeGithubCode('code', 'client', 'secret', 'https://app.example.com/cb')).rejects.toMatchObject({ status: 502, message: 'GitHub sign-in could not be completed.' });
    vi.stubGlobal('fetch', githubApi({ id: 'not-a-number' }));
    await expect(exchangeGithubCode('code', 'client', 'secret', 'https://app.example.com/cb')).rejects.toMatchObject({ status: 502 });
    await expect(exchangeGithubCode('', 'client', 'secret', 'https://app.example.com/cb')).rejects.toThrow('cancelled or expired');
  });
});

describe('GitHub integration validation', () => {
  it('accepts current and legacy client ID shapes and keeps an existing secret', () => {
    expect(validateIntegration('github', { clientId: 'Ov23liABCDEFGH12', clientSecret: 'new-secret' })).toEqual({ clientId: 'Ov23liABCDEFGH12', clientSecret: 'new-secret' });
    expect(validateIntegration('github', { clientId: '0123456789abcdef0123', clientSecret: '' }, { clientId: '0123456789abcdef0123', clientSecret: 'kept-secret' })).toMatchObject({ clientSecret: 'kept-secret' });
    expect(validateIntegration('github', { clientId: 'Iv1.0123456789abcdef', clientSecret: 'app-secret' })).toMatchObject({ clientId: 'Iv1.0123456789abcdef' });
    expect(() => validateIntegration('github', { clientId: 'not a client', clientSecret: 'secret' })).toThrow('GitHub OAuth client ID');
    expect(() => validateIntegration('github', { clientId: 'Ov23liABCDEFGH12', clientSecret: '' })).toThrow('client secret');
  });
});
