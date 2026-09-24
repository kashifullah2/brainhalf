import { budgetRegistry } from './helpers/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleModelTest } from '../lib/model-tester';
import { authorizeProject } from '../lib/auth';

vi.mock('../lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('../lib/auth')>(),
  authorizeProject: vi.fn(),
}));

describe('Model test evidence', () => {
  const model = '@cf/openai/gpt-oss-120b';
  const source = '<file path="/src/App.jsx">export default function App() { return <button>Working</button>; }</file>';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authorizeProject).mockResolvedValue({ ok: true, status: 200 });
  });

  function makeEnvironment(output = source, syncStatus = 200) {
    const sync = vi.fn(async () => new Response('{}', { status: syncStatus }));
    return {
      REGISTRY: budgetRegistry(), REQUIRED_MODEL_PROVIDERS: 'cloudflare',
      AI: { run: vi.fn(async () => ({ response: output })) },
      ChatAgent: { idFromName: vi.fn(name => name), get: vi.fn(() => ({ fetch: sync })) },
      sync,
    };
  }

  function run(env: ReturnType<typeof makeEnvironment>) {
    return handleModelTest(new Request(`https://brainhalf.com/api/test/simple?model=${model}`), env, 'simple', { userId: 'owner' });
  }

  it('authorizes the preview project before saving and advertising its URL', async () => {
    const env = makeEnvironment();
    const response = await run(env);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.previewUrl).toMatch(/^\/preview\/test-owner-/);
    expect(authorizeProject).toHaveBeenCalledWith(env, expect.stringContaining('test-owner-'), 'owner', expect.any(String));
    expect(vi.mocked(authorizeProject).mock.invocationCallOrder[0]).toBeLessThan(env.sync.mock.invocationCallOrder[0]);
  });

  it('does not report success or a working URL when preview persistence fails', async () => {
    const env = makeEnvironment(source, 503);
    const response = await run(env);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, syntaxValid: true, error: 'Preview files could not be saved (503)' });
  });

  it('never writes to a preview project it cannot authorize', async () => {
    vi.mocked(authorizeProject).mockResolvedValue({ ok: false, status: 403 });
    const env = makeEnvironment();
    const response = await run(env);
    expect(response.status).toBe(502);
    expect((await response.json()).previewUrl).toBeUndefined();
    expect(env.sync).not.toHaveBeenCalled();
  });

  it('fails syntax validation before saving broken generated source', async () => {
    const env = makeEnvironment('<file path="/src/App.jsx">export default function App() { const value = ; return <div />; }</file>');
    const response = await run(env);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ success: false, syntaxValid: false });
    expect(env.sync).not.toHaveBeenCalled();
    expect(authorizeProject).not.toHaveBeenCalled();
  });
});
