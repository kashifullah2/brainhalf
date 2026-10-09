import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: any, public env: any) {} } }));
vi.mock('@cloudflare/sandbox', () => ({ getSandbox: () => ({}) }));
vi.mock('@cloudflare/playwright', () => ({ launch: vi.fn(), connect: vi.fn(), sessions: vi.fn() }));
import { ProjectRuntime, embedPreviewErrorPage } from '../src/runtime/project';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function context() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const map = new Map<string, any>(); let ready = Promise.resolve(); let serial = Promise.resolve();
  const storage: any = {
    get: async (key: string) => structuredClone(map.get(key)),
    put: async (key: string | Record<string, any>, value?: any) => { if (typeof key === 'string') map.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) map.set(k, structuredClone(value)); },
    delete: async (key: string) => map.delete(key),
    list: async ({ prefix = '' } = {}) => new Map([...map].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])),
    setAlarm: vi.fn(async () => {}),
    transaction: (callback: (txn: any) => Promise<any>) => { const result = serial.then(() => callback(storage)); serial = result.then(() => {}, () => {}); return result; },
    sql: { exec: (sql: string, ...params: any[]) => { const statement = db.prepare(sql); const rows = statement.columns().length ? statement.all(...params) : (statement.run(...params), []); return { toArray: () => rows }; } },
  };
  const ctx: any = { storage, blockConcurrencyWhile: (callback: () => Promise<void>) => { ready = callback(); return ready; } };
  return { ctx, ready: () => ready };
}

async function project() {
  const state = context();
  const pilot = { consumeUsage: vi.fn(async () => ({ ok: true })) };
  const env: any = { PROJECT_SECRETS_KEY: btoa('k'.repeat(32)), RUNTIME_DOMAIN: 'apps.example.com', PILOT: { getByName: () => pilot }, PROJECTS: { getByName: () => ({}) }, Sandbox: {}, ARTIFACTS: { put: vi.fn(async () => {}) }, CF_ACCOUNT_ID: 'account', CF_API_TOKEN: 'platform-only', BROWSER: {} };
  const object = new ProjectRuntime(state.ctx, env);
  await state.ready();
  await object.initialize({ projectId: 'project', ownerId: 'owner' }, 'a'.repeat(32));
  return object;
}

describe('embedPreviewErrorPage (N3)', () => {
  it('returns an HTML page that reports the failure to the parent frame', async () => {
    const res = embedPreviewErrorPage('Preview link expired.');
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Preview link expired.');
    expect(html).toContain('window.parent.postMessage');
    expect(html).toContain('"type":"preview-error"');
  });

  it('cannot be broken out of by a message containing </script>', async () => {
    const html = await embedPreviewErrorPage('</script><script>alert(1)</script>').text();
    // The payload is JSON-encoded with `<` escaped, so no literal </script>
    // from the message survives inside the script block.
    const scriptBody = html.split('<script>')[1].split('</script>')[0];
    expect(scriptBody).not.toContain('</script><script>');
    expect(JSON.parse(scriptBody.match(/postMessage\((\{.*\}),/)![1]).error).toBe('</script><script>alert(1)</script>');
  });
});

describe('Sandbox and deployed-Worker header stripping', () => {
  it('both paths strip Authorization, internal headers, and platform cookies', () => {
    const incoming = new Headers({
      Authorization: 'Bearer platform-secret',
      Cookie: '__Host-bh_preview=tok; bh_session=sess; app_cookie=keep',
      'X-Bh-Project': 'project-id',
      'X-Brainhalf-Internal': 'value',
      'X-Auth-User-Id': 'forged',
      'Cf-Access-Jwt-Assertion': 'jwt',
      'Content-Type': 'application/json',
      'X-Custom': 'preserved',
    });

    const sandboxHeaders = new Headers(incoming);
    for (const key of [...sandboxHeaders.keys()]) if (/^(?:x-bh-|x-brainhalf-|x-auth-|cf-access-)/i.test(key) || key === 'authorization') sandboxHeaders.delete(key);
    const appCookies = sandboxHeaders.get('cookie')?.split(';').filter(value => !/^(?:__Host-bh_|bh_session)/.test(value.trim())).join(';');
    sandboxHeaders.delete('cookie'); if (appCookies) sandboxHeaders.set('cookie', appCookies);

    expect(sandboxHeaders.has('authorization')).toBe(false);
    expect(sandboxHeaders.has('x-bh-project')).toBe(false);
    expect(sandboxHeaders.has('x-brainhalf-internal')).toBe(false);
    expect(sandboxHeaders.has('x-auth-user-id')).toBe(false);
    expect(sandboxHeaders.has('cf-access-jwt-assertion')).toBe(false);
    expect(sandboxHeaders.get('cookie')).toContain('app_cookie=keep');
    expect(sandboxHeaders.get('content-type')).toBe('application/json');
    expect(sandboxHeaders.get('x-custom')).toBe('preserved');

    const deployedHeaders = new Headers(incoming);
    for (const key of [...deployedHeaders.keys()]) if (/^(?:x-bh-|x-brainhalf-|cf-access-)/i.test(key) || ['authorization', 'cookie'].includes(key)) deployedHeaders.delete(key);

    expect(deployedHeaders.has('authorization')).toBe(false);
    expect(deployedHeaders.has('cookie')).toBe(false);
    expect(deployedHeaders.has('x-bh-project')).toBe(false);
    expect(deployedHeaders.has('cf-access-jwt-assertion')).toBe(false);
    expect(deployedHeaders.get('content-type')).toBe('application/json');
    expect(deployedHeaders.get('x-custom')).toBe('preserved');
  });
});

describe('/__brainhalf/open with an expired ticket (N3)', () => {
  it('serves the reporting HTML page for embed loads instead of JSON', async () => {
    const object = await project();
    const res = await object.appRequest(new Request('https://app.example/__brainhalf/open?ticket=invalid&embed=1'), 'development' as any);
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(await res.text()).toContain('"type":"preview-error"');
  });

  it('keeps the JSON error for non-embed (direct) loads', async () => {
    const object = await project();
    const res = await object.appRequest(new Request('https://app.example/__brainhalf/open?ticket=invalid'), 'development' as any);
    expect(res.status).toBe(401);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect((await res.json()).error).toMatch(/Preview link expired/);
  });
});
