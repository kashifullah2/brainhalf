import { describe, expect, it, vi } from 'vitest';
import { InMemoryDataStore } from '../lib/backend-runner';

vi.mock('cloudflare:workers', () => ({ tracing: {} }));
vi.mock('agents', () => ({ Agent: class {} }));
import { ChatAgent, selectForwardableHeaders } from '../agent';

describe('Generated application session boundary', () => {
  function makeAgent(simulated = true) {
    const agent: any = Object.create(ChatAgent.prototype);
    agent.previewStore = new InMemoryDataStore();
    agent.ensureSchema = () => {};
    agent.seedStarterIfEmpty = () => {};
    agent.sql = () => [{ content: JSON.stringify({ brainhalf: { previewApi: simulated ? 'simulated' : 'disabled' } }) }];
    agent.readServerFilesForBackend = () => ({ '/server/index.js': 'export default { fetch() { return new Response("ok"); } };' });
    return agent;
  }

  async function request(agent: any, path: string, body?: object, token?: string) {
    return agent.onRequest(new Request(`https://brainhalf.com/preview/app/api${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-auth-user-id': 'owner', 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }));
  }

  it('refuses to simulate a backend', async () => {
    const response = await request(makeAgent(false), '/items', { title: 'Must not be saved' });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ code: 'BACKEND_NOT_RUNNING' });
  });

  it('legacy opt-in cannot create fake accounts or sessions', async () => {
    const agent = makeAgent();
    for (const path of ['/auth/signup', '/auth/login', '/auth/logout']) {
      const response = await request(agent, path, { email: 'app@example.test', password: 'test-password-123' });
      expect(response.status).toBe(501); expect(await response.json()).toMatchObject({ code: 'BACKEND_NOT_RUNNING' });
    }
    expect(agent.previewStore.findAll('users')).toEqual([]);
    expect(agent.previewStore.findAll('sessions')).toEqual([]);
    expect((await request(makeAgent(), '/auth/me', undefined, 'bh_token_foreign')).status).toBe(501);
  });

  it('never forwards platform credentials, even if someone stores one as an app session', () => {
    const store = new InMemoryDataStore();
    store.create('sessions', { token: 'bh_payload.signature', active: true });
    store.create('sessions', { token: 'bh_token_payload.signature', active: true });
    for (const token of ['bh_payload.signature', 'bh_token_payload.signature', 'bh_token_unknown']) {
      const forwarded = selectForwardableHeaders(new Headers({ authorization: `Bearer ${token}`, cookie: 'bh_session=platform-secret' }), store);
      expect(forwarded).not.toHaveProperty('authorization');
      expect(forwarded).not.toHaveProperty('cookie');
    }
  });
});
