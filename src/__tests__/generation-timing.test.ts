import { afterEach, expect, it, vi } from 'vitest';
const scope = vi.hoisted(() => ({ value: 'one' }));
vi.mock('../lib/project-store', () => ({ projectStorageKey: (key: string) => `${scope.value}:${key}` }));
import { GenerationClock, getGenerationTimings } from '../lib/generation-timing';
afterEach(() => { vi.unstubAllGlobals(); scope.value = 'one'; });
it('records monotonic milestones once, preserves completion, and refuses cross-account writes', () => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key), setItem: (key: string, value: string) => data.set(key, value) });
  let time = 100;
  const clock = new GenerationClock('project', 'request', () => time);
  clock.mark('preview');
  time = 150; clock.mark('sent');
  time = 250; clock.mark('activity');
  time = 350; clock.mark('activity'); clock.finish('completed');
  time = 400; clock.mark('preview'); clock.finish('failed');
  expect(getGenerationTimings('project')[0]).toMatchObject({ elapsed: { sent: 50, activity: 150, preview: 300 }, outcome: 'completed', durationMs: 250 });
  scope.value = 'two'; clock.mark('model');
  expect(getGenerationTimings('project')).toEqual([]);
  expect(data.has('two:generation-timing:project')).toBe(false);
});
it('cannot mistake an old preview or a failed request for a working generated app', () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const clock = new GenerationClock('project', 'request');
  clock.mark('preview'); clock.mark('activity'); clock.finish('failed'); clock.mark('preview');
  expect(clock.record.elapsed.preview).toBeUndefined();
});
