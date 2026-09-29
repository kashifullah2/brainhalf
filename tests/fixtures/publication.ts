import type { Page } from '@playwright/test';
import { sourceSnapshot } from '../../src/runtime/source';
import type { ProjectRelease, RuntimeJob, SourceFiles } from '../../src/runtime/types';

export async function setupPublication(page: Page, reject = false) {
  const submitted: Array<{ kind: string; files: SourceFiles; environment: string }> = [];
  let job: RuntimeJob | null = null;
  let release: ProjectRelease | null = null;
  await page.route('**/api/projects/*/runtime/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    const environment = url.searchParams.get('environment') || 'development';
    if (url.pathname.endsWith('/database')) {
      if (url.searchParams.get('table')) {
        return route.fulfill({ json: { columns: ['id', 'title'], rows: [{ __bh_rowid: 1, id: 1, title: 'First item' }, { __bh_rowid: 2, id: 2, title: 'Second item' }], hasMore: false, offset: 0, rowIds: true } });
      }
      return route.fulfill({ json: { tables: [{ name: 'items', rowCount: 2, indexes: [], columns: [{ name: 'id', type: 'INTEGER', notNull: false, primaryKey: true, defaultValue: null }, { name: 'title', type: 'TEXT', notNull: true, primaryKey: false, defaultValue: null }] }] } });
    }
    if (url.pathname.endsWith('/database/recovery')) {
      return route.fulfill({ json: { points: [] } });
    }
    if (url.pathname.endsWith('/jobs')) {
      const body = request.postDataJSON();
      if (reject) { submitted.push({ ...body, environment }); return route.fulfill({ status: 403, json: { error: 'Not the project owner' } }); }
      // Assign `job` before `submitted.push`: the snapshot await suspends, and
      // tests poll `submitted.length` before calling fail()/complete() — a push
      // first would let the test observe a submission with job still null.
      job = { id: 'publication-job', kind: body.kind, environment: 'production', revision: (await sourceSnapshot(body.files)).revision, status: 'queued', createdAt: Date.now(), updatedAt: Date.now(), leaseUntil: Date.now() + 600_000, processIds: [], publishStage: 'build', message: 'Building your app' };
      submitted.push({ ...body, environment });
      return route.fulfill({ status: 202, json: { job } });
    }
    if (url.pathname.endsWith('/stop')) {
      if (job) { job.status = 'stopped'; job.message = 'Publishing cancelled'; }
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname.endsWith('/unpublish')) {
      release = null;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { projectId: url.pathname.split('/')[3], enabled: true, availability: { state: 'ready', message: 'Hosting ready' }, environment, capabilities: {}, jobs: job ? [job] : [], releases: release ? [release] : [], activeRelease: environment === 'production' ? release : null, migrations: [], database: null, integrations: [], verification: null, productionUrl: 'https://published.apps.example.test', previewUrl: '' } });
  });
  return { submitted, fail: (message = 'Building application failed (exit 1).') => {
    if (!job) throw new Error('Publish was not requested');
    job.status = 'failed'; job.message = message;
  }, complete: () => {
    if (!job) throw new Error('Publish was not requested');
    job.status = 'passed'; job.publishStage = 'live'; job.message = 'Your app is live'; job.releaseId = job.id;
    release = { id: job.id, revision: job.revision, environment: 'production', scriptName: 'test-release', createdAt: Date.now(), databaseId: 'production-db', artifactKey: 'artifact', migrations: [] };
  } };
}
