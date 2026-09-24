import { RuntimeError } from './types';
import { readBoundedJson } from '../lib/http-body';

/** Only the control Worker holds this token. It is never bound to generated apps. */
export class CloudflareAPI {
  constructor(private accountId: string, private token: string | undefined) {}
  async request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
    if (!this.accountId || !this.token) throw new RuntimeError('Cloudflare resource provisioning is not configured.', 503);
    const headers = new Headers({ Authorization: `Bearer ${this.token}` });
    if (data && !(data instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}${path}`, {
      method, headers, body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(30_000), redirect: 'manual',
    });
    if (method === 'DELETE' && [204, 404].includes(response.status)) return undefined as T;
    if (!response.ok) { await response.body?.cancel(); throw new RuntimeError(`Cloudflare ${method} failed (${response.status}). Check the runtime token permissions and account limits.`, 502); }
    const body = await readBoundedJson<{ success?: boolean; result: T }>(response, 8_000_000);
    if (!response.ok || body.success === false) throw new RuntimeError(`Cloudflare ${method} failed (${response.status}). Check the runtime token permissions and account limits.`, 502);
    return body.result;
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
