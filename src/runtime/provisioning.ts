import { readStreamJson } from './integrations';

interface AccessCheck {
  service: 'user_token' | 'account_token' | 'database' | 'deployment';
  ok: boolean;
  httpStatus: number;
  codes: number[];
  tokenStatus?: 'active' | 'disabled' | 'expired';
}

/** Read-only operator diagnostics. Never return tokens, account data or API messages. */
export async function provisioningCheck(accountId: string, token: string | undefined, namespace: string) {
  if (!accountId || !token || !namespace) return { readAccess: false, credential: 'missing', checks: [] };
  if (/\s|["'`]/.test(token)) {
    return { readAccess: false, credential: 'format_issue', message: 'Paste only the token value, without quotes, whitespace, or a Bearer prefix.', checks: [] };
  }
  const account = '/accounts/' + encodeURIComponent(accountId);
  const probe = async (service: AccessCheck['service'], path: string): Promise<AccessCheck> => {
    let httpStatus = 0;
    try {
      const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
      });
      httpStatus = response.status;
      const body = await readStreamJson(response.body, 64_000) as {
        success?: boolean; result?: { status?: string }; errors?: Array<{ code?: unknown }>;
      };
      const check: AccessCheck = {
        service, ok: response.ok && body?.success === true, httpStatus,
        codes: Array.isArray(body?.errors) ? body.errors.map(error => error?.code).filter((code): code is number => typeof code === 'number' && Number.isSafeInteger(code)).slice(0, 10) : [],
      };
      const status = body?.result?.status;
      if (['user_token', 'account_token'].includes(service) && (status === 'active' || status === 'disabled' || status === 'expired')) check.tokenStatus = status;
      return check;
    } catch { return { service, ok: false, httpStatus, codes: [] }; }
  };
  const checks = await Promise.all([
    probe('user_token', '/user/tokens/verify'),
    probe('database', account + '/d1/database?per_page=1'),
    probe('deployment', account + '/workers/dispatch/namespaces/' + encodeURIComponent(namespace) + '/scripts?per_page=1'),
  ]);
  if (!checks[0].ok || checks[0].tokenStatus !== 'active') checks.push(await probe('account_token', account + '/tokens/verify'));
  return {
    credential: 'present',
    // Successful listing does not establish create/delete permissions; the live app test must still pass.
    readAccess: checks.filter(check => ['database', 'deployment'].includes(check.service)).every(check => check.ok),
    checks,
  };
}
