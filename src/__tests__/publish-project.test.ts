import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeJob } from '../runtime/types';

const state = vi.hoisted(() => ({ scope: {}, generating: false, request: vi.fn() }));
vi.mock('../lib/project-runtime-client', () => ({ runtimeRequest: state.request }));
vi.mock('../lib/project-store', () => ({ getProjectStorageScope: () => state.scope }));
vi.mock('../lib/status-store', () => ({ resolvePlatformStatusForProject: () => state.generating ? 'Building' : 'Ready' }));
import { publishProject } from '../lib/publish-project';
import { sourceSnapshot } from '../runtime/source';

const files = () => ({ '/package.json': '{"scripts":{"build":"vite build"}}', '/src/App.tsx': 'saved frontend' });
const job = { id: 'release-job', kind: 'publish', status: 'queued', environment: 'production' } as RuntimeJob;
const ready = (jobs: RuntimeJob[] = []) => ({ enabled: true, availability: { state: 'ready' }, activeRelease: null, jobs });
beforeEach(() => { state.request.mockReset(); state.generating = false; state.scope = {}; });

describe('one-click publication', () => {
  it('submits the complete saved source as one production job', async () => {
    state.request.mockResolvedValueOnce(ready()).mockResolvedValueOnce({ job });
    expect(await publishProject('project', files())).toEqual(job);
    expect(state.request).toHaveBeenCalledTimes(2);
    const [id, path, environment, request] = state.request.mock.calls[1];
    expect([id, path, environment]).toEqual(['project', '/jobs', 'production']);
    expect(JSON.parse(request.body)).toMatchObject({ kind: 'publish', files: { 'src/App.tsx': 'saved frontend' } });
  });
  it('stops its own development preview and preserves the source from the click', async () => {
    const source = files();
    state.request.mockResolvedValueOnce(ready([{ id: 'preview', kind: 'preview', status: 'running', environment: 'development' } as RuntimeJob]))
      .mockImplementationOnce(async () => { source['/src/App.tsx'] = 'later edit'; return { ok: true }; }).mockResolvedValueOnce({ job });
    await publishProject('project', source);
    expect(state.request.mock.calls[1].slice(0, 3)).toEqual(['project', '/stop', 'development']);
    expect(JSON.parse(state.request.mock.calls[1][3].body)).toEqual({ expectedJobId: 'preview' });
    expect(JSON.parse(state.request.mock.calls[2][3].body).files['src/App.tsx']).toBe('saved frontend');
  });
  it('reopens an existing publication without stopping it or submitting another', async () => {
    state.request.mockResolvedValueOnce(ready([job]));
    expect(await publishProject('project', files())).toEqual(job);
    expect(state.request).toHaveBeenCalledOnce();
  });
  it('shows an already live version even when its job has aged out of recent history', async () => {
    const source = files();
    state.request.mockResolvedValueOnce({ ...ready(), activeRelease: { id: 'older-release', revision: (await sourceSnapshot(source)).revision } });
    expect(await publishProject('project', source)).toBeNull();
    expect(state.request).toHaveBeenCalledOnce();
  });
  it('does not publish if stopping the preview fails', async () => {
    state.request.mockResolvedValueOnce(ready([{ id: 'preview', kind: 'preview', status: 'running', environment: 'development' } as RuntimeJob])).mockRejectedValueOnce(new Error('Cleanup pending'));
    await expect(publishProject('project', files())).rejects.toThrow('Cleanup pending');
    expect(state.request.mock.calls.map(call => call[1])).toEqual(['/status', '/stop']);
  });
  it.each(['account', 'generation'])('does not publish after %s changes during preflight', async change => {
    state.request.mockImplementationOnce(async () => { if (change === 'account') state.scope = {}; else state.generating = true; return ready(); });
    await expect(publishProject('project', files())).rejects.toThrow();
    expect(state.request).toHaveBeenCalledOnce();
  });
  it('keeps a build check running and refuses an unavailable host', async () => {
    state.request.mockResolvedValueOnce(ready([{ id: 'verify', kind: 'verify', status: 'running', environment: 'development' } as RuntimeJob]));
    await expect(publishProject('project', files())).rejects.toThrow('Another app check');
    state.request.mockResolvedValueOnce({ ...ready(), enabled: false, availability: { state: 'disabled', message: 'Hosting disabled' } });
    await expect(publishProject('project', files())).rejects.toThrow('Hosting disabled');
    expect(state.request.mock.calls.every(call => call[1] === '/status')).toBe(true);
  });
});
