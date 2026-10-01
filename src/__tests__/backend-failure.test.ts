import { describe, expect, it } from 'vitest';
import { resolveBackendFailure } from '../lib/backend-failure';

/**
 * B2/B3 regression tests: a failed "Start app preview" backend job must stay
 * visible. The QA symptom was "Building your app and starting its backend…"
 * silently reverting to "The backend is not running" with no error shown.
 */
describe('resolveBackendFailure (B2/B3)', () => {
  it('marks failed when the latest job failed', () => {
    const result = resolveBackendFailure({
      latestJob: { id: 'job-1', status: 'failed', message: 'Build crashed: out of memory' },
      ready: false,
      activeJob: false,
      lastFailure: null,
    });
    expect(result.failed).toBe(true);
    expect(result.failureMessage).toBe('Build crashed: out of memory');
    expect(result.nextLastFailure).toEqual({ jobId: 'job-1', message: 'Build crashed: out of memory' });
  });

  it('remembers the failure after the job is pruned from the list', () => {
    // First the job fails and is remembered…
    const first = resolveBackendFailure({
      latestJob: { id: 'job-1', status: 'failed', message: 'Port in use' },
      ready: false,
      activeJob: false,
      lastFailure: null,
    });
    // …then the jobs list no longer contains it (pruned).
    const second = resolveBackendFailure({
      latestJob: undefined,
      ready: false,
      activeJob: false,
      lastFailure: first.nextLastFailure,
    });
    expect(second.failed).toBe(true);
    expect(second.failureMessage).toBe('Port in use');
  });

  it('clears the remembered failure once the backend is ready', () => {
    const result = resolveBackendFailure({
      latestJob: undefined,
      ready: true,
      activeJob: false,
      lastFailure: { jobId: 'job-1', message: 'Port in use' },
    });
    expect(result.failed).toBe(false);
    expect(result.failureMessage).toBeNull();
    expect(result.nextLastFailure).toBeNull();
  });

  it('does not show a stale failure while a new job is running', () => {
    const result = resolveBackendFailure({
      latestJob: { id: 'job-2', status: 'running' },
      ready: false,
      activeJob: true,
      lastFailure: { jobId: 'job-1', message: 'Port in use' },
    });
    expect(result.failed).toBe(false);
    expect(result.failureMessage).toBeNull();
    // …but the memory is kept so it can reappear if the new job also vanishes.
    expect(result.nextLastFailure).toEqual({ jobId: 'job-1', message: 'Port in use' });
  });

  it('is not failed when everything is healthy', () => {
    const result = resolveBackendFailure({
      latestJob: { id: 'job-1', status: 'running' },
      ready: true,
      activeJob: false,
      lastFailure: null,
    });
    expect(result.failed).toBe(false);
  });
});
