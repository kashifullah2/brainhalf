import { RuntimeError } from './types';
import { readBoundedJson } from '../lib/http-body';

export interface CustomHostname {
  id: string;
  hostname: string;
  status: 'active' | 'pending' | 'active_redeploying' | 'deleted' | 'pending_deletion' | 'blocked' | 'error';
  ssl: { status: 'active' | 'pending_validation' | 'pending_issuance' | 'pending_deployment' | 'expired' | 'initializing' | 'deleted' | 'error'; validation_errors?: Array<{ message: string }> };
  ownership_verification?: { type: string; name: string; value: string };
  ownership_verification_http?: { http_url: string; http_body: string };
  verification_errors?: string[];
}

// Extracts Cloudflare's structured error text from a failed response body.
// Best effort: any parse failure still yields the status-only message.
async function errorDetail(response: Response): Promise<string> {
  try {
    // Bound the diagnostic read: a stalled error body must not hold the
    // request path for tens of seconds just to extract a message.
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 3000));
    const body = await Promise.race([
      readBoundedJson<{ errors?: Array<{ code?: number; message?: string }> }>(response, 64_000),
      timeout,
    ]);
    if (!body) { await response.body?.cancel().catch(() => {}); return ''; }
    const first = body.errors?.find(error => error?.message);
    return first ? `${first.message}${first.code ? ` (code ${first.code})` : ''}` : '';
  } catch {
    await response.body?.cancel().catch(() => {});
    return '';
  }
}

/** Only the control Worker holds this token. It is never bound to generated apps. */
export class CloudflareAPI {
  constructor(private accountId: string, private token: string | undefined, private zoneId?: string) {}
  async request<T>(path: string, method = 'GET', data?: unknown, base?: string): Promise<T> {
    if (!this.accountId || !this.token) throw new RuntimeError('Cloudflare resource provisioning is not configured.', 503);
    const headers = new Headers({ Authorization: `Bearer ${this.token}` });
    if (data && !(data instanceof FormData)) headers.set('Content-Type', 'application/json');
    const url = base
      ? `https://api.cloudflare.com/client/v4/${base}${path}`
      : `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}${path}`;
    const response = await fetch(url, {
      method, headers, body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(30_000), redirect: 'manual',
    });
    if (method === 'DELETE' && [204, 404].includes(response.status)) return undefined as T;
    // Always surface Cloudflare's own error text (e.g. "Authentication error"
    // code 10003, missing-permission errors) — a bare status code leaves
    // users guessing which token permission or limit actually failed.
    if (!response.ok) {
      const detail = await errorDetail(response);
      throw new RuntimeError(`Cloudflare ${method} failed (${response.status})${detail ? `: ${detail}` : ''}. Check the runtime token permissions and account limits.`, 502);
    }
    const body = await readBoundedJson<{ success?: boolean; errors?: Array<{ code?: number; message?: string }>; result: T }>(response, 8_000_000);
    if (body.success === false) {
      const first = body.errors?.find(error => error?.message);
      throw new RuntimeError(`Cloudflare ${method} failed (${response.status})${first ? `: ${first.message}${first.code ? ` (code ${first.code})` : ''}` : ''}. Check the runtime token permissions and account limits.`, 502);
    }
    return body.result;
  }


  private zoneRequest<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    if (!this.zoneId) throw new RuntimeError('Custom domain support is not configured for this account.', 503);
    return this.request<T>(path, method, data, `zones/${encodeURIComponent(this.zoneId)}`);
  }

  async addCustomHostname(hostname: string, fallbackOrigin: string): Promise<CustomHostname> {
    return this.zoneRequest<CustomHostname>('/custom_hostnames', 'POST', {
      hostname,
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
      custom_origin_server: fallbackOrigin,
    });
  }

  async getCustomHostname(id: string): Promise<CustomHostname> {
    return this.zoneRequest<CustomHostname>(`/custom_hostnames/${encodeURIComponent(id)}`);
  }

  async deleteCustomHostname(id: string): Promise<void> {
    await this.zoneRequest(`/custom_hostnames/${encodeURIComponent(id)}`, 'DELETE');
  }

  async findCustomHostname(hostname: string): Promise<CustomHostname | null> {
    const results = await this.zoneRequest<CustomHostname[]>(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`).catch(() => null);
    return results?.find(h => h.hostname === hostname) || null;
  }
  async createDatabase(name: string) {
    const lookup = async () => (await this.request<Array<{ uuid: string; name: string }>>(`/d1/database?name=${encodeURIComponent(name)}&per_page=100`)).find(database => database.name === name);
    const existing = await lookup(); if (existing) return existing;
    try { return await this.request<{ uuid: string; name: string }>('/d1/database', 'POST', { name }); }
    catch (error) { const recovered = await lookup(); if (recovered) return recovered; throw error; }
  }
  remove(path: string) { return this.request(path, 'DELETE'); }
  async query(id: string, sql: string, params: unknown[] = []) {
    const results = await this.request<Array<{ success: boolean; results: Record<string, unknown>[] }>>(`/d1/database/${encodeURIComponent(id)}/query`, 'POST', { sql, params });
    if (results.some(result => result.success === false)) throw new RuntimeError('The database rejected the query.', 422);
    return results.flatMap(result => result.results || []);
  }
  upload(namespace: string, name: string, module: string, databaseId: string, services?: { service: string; capability: string }) {
    const body = new FormData();
    body.set('metadata', JSON.stringify({ main_module: 'index.js', compatibility_date: '2026-09-22', compatibility_flags: ['nodejs_compat'], bindings: [{ name: 'DB', type: 'd1', id: databaseId }, { name: 'BRAINHALF_MANAGED', type: 'plain_text', text: 'true' }, ...(services ? [{ name: 'BRAINHALF_SERVICES', type: 'service', service: services.service, entrypoint: 'AppServicesAPI' }, { name: 'BRAINHALF_SERVICE_TOKEN', type: 'secret_text', text: services.capability }] : [])] }));
    body.set('index.js', new Blob([module], { type: 'application/javascript+module' }), 'index.js');
    return this.request(`/workers/dispatch/namespaces/${encodeURIComponent(namespace)}/scripts/${encodeURIComponent(name)}`, 'PUT', body);
  }
}
