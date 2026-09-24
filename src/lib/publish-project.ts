import { runtimeRequest } from './project-runtime-client';
import { getProjectStorageScope } from './project-store';
import { resolvePlatformStatusForProject } from './status-store';
import { sourceSnapshot } from '../runtime/source';
import { publicationTarget } from '../runtime/publication';
import type { RuntimeJob, RuntimeStatus, SourceFiles } from '../runtime/types';

/** One explicit user action, one pinned version, and at most one production job. */
export async function publishProject(projectId: string, files: SourceFiles): Promise<RuntimeJob | null> {
  const scope = getProjectStorageScope();
  const assertCurrent = () => {
    if (scope !== getProjectStorageScope()) throw new Error('Your account changed. Open the project again before publishing.');
    if (resolvePlatformStatusForProject(projectId) === 'Building') throw new Error('Wait for the app to finish generating before publishing.');
  };
  assertCurrent();
  const snapshot = await sourceSnapshot(files);
  publicationTarget(snapshot.files);
  const status = await runtimeRequest<RuntimeStatus>(projectId, '/status', 'production', { signal: AbortSignal.timeout(15_000) });
  assertCurrent();
  if (!status.enabled || status.availability?.state !== 'ready') throw new Error(status.availability?.message || 'Managed hosting is currently unavailable.');
  const active = status.jobs.find(job => ['queued', 'running', 'stopping'].includes(job.status));
  if (active?.kind === 'publish') return active;
  if (status.activeRelease?.revision === snapshot.revision) {
    const published = status.jobs.find(job => job.kind === 'publish' && job.releaseId === status.activeRelease?.id);
    return published || null;
  }
  if (active) {
    if (active.kind !== 'preview' || active.environment !== 'development') throw new Error('Another app check is running. Wait for it to finish before publishing.');
    await runtimeRequest(projectId, '/stop', 'development', { method: 'POST', body: JSON.stringify({ expectedJobId: active.id }), signal: AbortSignal.timeout(30_000) });
    assertCurrent();
  }
  const result = await runtimeRequest<{ job: RuntimeJob }>(projectId, '/jobs', 'production', {
    method: 'POST', body: JSON.stringify({ kind: 'publish', files: snapshot.files }), signal: AbortSignal.timeout(30_000),
  });
  return result.job;
}
