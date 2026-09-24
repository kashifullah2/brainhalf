import { describe, expect, it, vi } from 'vitest';
import { createPreviewFetch } from '../lib/preview-fetch';
import { InMemoryDataStore } from '../lib/backend-runner';
import { setSimulatedApi } from '../lib/preview-mode';

describe('Preview fetch compatibility', () => {
  it('never silently substitutes a demo API for a generated server', async () => {
    const native = vi.fn();
    const store = new InMemoryDataStore();
    const preview = createPreviewFetch(native, { '/server/index.ts': 'custom server' }, store, 'https://preview.test', vi.fn());
    const response = await preview('/api/items', { method: 'POST', body: JSON.stringify({ title: 'Not actually saved' }) });
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ code: 'BACKEND_NOT_RUNNING' });
    expect(store.findAll('items')).toEqual([]);
    expect(native).not.toHaveBeenCalled();
  });
  it('rejects legacy demo flags for Request and URL inputs without mutating data', async () => {
    const store = new InMemoryDataStore(); const native = vi.fn();
    const preview = createPreviewFetch(native, setSimulatedApi({}, true), store, 'https://preview.test', vi.fn());
    for (const input of [new Request('https://preview.test/api/tasks', { method: 'POST', body: '{"title":"Must not save"}' }), new URL('https://preview.test/api/tasks')]) {
      const result = await preview(input); expect(result.status).toBe(501);
      expect(await result.json()).toMatchObject({ code: 'BACKEND_NOT_RUNNING' });
    }
    expect(store.findAll('tasks')).toEqual([]); expect(native).not.toHaveBeenCalled();
  });

  it('forwards remote API requests and preserves cancellation', async () => {
    const native = vi.fn<typeof fetch>().mockResolvedValue(new Response('Remote response'));
    const report = vi.fn();
    const fetchPreview = createPreviewFetch(native, {}, new InMemoryDataStore(), 'https://preview.test', report);
    const options = { headers: { authorization: 'test-credential' } };
    expect(await (await fetchPreview('https://external.test/api/data', options)).text()).toBe('Remote response');
    expect(native).toHaveBeenCalledWith('https://external.test/api/data', options);
    await expect(fetchPreview('/api/tasks', { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(report).not.toHaveBeenCalled();
  });

  it('does not fabricate successful form submissions', async () => {
    const store = new InMemoryDataStore();
    const preview = createPreviewFetch(vi.fn(), setSimulatedApi({}, true), store, 'https://preview.test', vi.fn());
    expect((await preview('/api/tasks', { method: 'POST', body: new URLSearchParams({ title: 'Form' }) })).status).toBe(501);
    expect(store.findAll('tasks')).toEqual([]);
  });
});
