import { useCallback, useEffect, useRef, useState } from 'react';
import { isFullStackProject } from './backend-runner';
import { runtimeRequest, type useProjectRuntime } from './project-runtime-client';
import { sourceSnapshot } from '../runtime/source';
import type { RuntimeStatus } from '../runtime/types';

type Runtime = ReturnType<typeof useProjectRuntime>;
/** A generation can queue one latest development snapshot. Never starts a production job. */
export function useAutomaticBackend(projectId: string, runtime: Runtime) {
  const [notice, setNotice] = useState('');
  const [fault, setFault] = useState(false);
  const [openError, setOpenError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<Record<string, string> | null>(null);
  const running = useRef(false);
  const attempted = useRef('');
  const epoch = useRef(0);
  const refresh = runtime.refresh;
  useEffect(() => { epoch.current++; pending.current = null; attempted.current = ''; running.current = false; setBusy(false); setNotice(''); setFault(false); setOpenError(''); return () => { epoch.current++; }; }, [projectId]);
  const flush = useCallback(async () => {
    if (running.current || !pending.current) return;
    const current = epoch.current; running.current = true; setBusy(true);
    try {
      const status = await runtimeRequest<RuntimeStatus>(projectId, '/status', 'development');
      if (current !== epoch.current) return;
      if (!status.enabled || status.availability?.state !== 'ready') {
        pending.current = null;
        setFault(true);
        setNotice(status.availability?.message || 'Backend source is ready. Managed hosting is currently unavailable; check the project console for details.');
        refresh();
        return;
      }
      const files = pending.current;
      if (!files) return;
      const snapshot = await sourceSnapshot(files);
      if (current !== epoch.current) return;
      const active = status.jobs.find(job => ['queued', 'running', 'stopping'].includes(job.status));
      if (snapshot.revision === status.activeRelease?.revision || (active?.environment === 'development' && active.kind === 'preview' && active.revision === snapshot.revision)) { if (pending.current === files) pending.current = null; return; }
      if (active) {
        if (active.environment === 'development' && active.kind === 'preview' && active.previewReady) {
          setNotice('Updating the running development app…');
          await runtimeRequest(projectId, '/stop', 'development', { method: 'POST', body: JSON.stringify({ expectedJobId: active.id }) });
          if (current === epoch.current) refresh();
        } else setNotice('Waiting for the current build before updating the backend…');
        return;
      }
      if (pending.current === files) pending.current = null;
      if (snapshot.revision === attempted.current && !status.jobs.some(job => job.revision === snapshot.revision && ['failed', 'stopped'].includes(job.status))) return;
      setFault(false); setNotice('Building your app and starting its backend…');
      await runtimeRequest(projectId, '/jobs', 'development', { method: 'POST', body: JSON.stringify({ kind: 'preview', files }) });
      if (current === epoch.current) { attempted.current = snapshot.revision; refresh(); }
    } catch (cause) {
      if (current === epoch.current) { setFault(true); setNotice(cause instanceof Error ? cause.message : 'The backend could not start.'); }
    } finally { if (current === epoch.current) { running.current = false; setBusy(false); } }
  }, [projectId, refresh]);
  useEffect(() => { if (pending.current) void flush(); }, [runtime.status, flush]);
  const start = useCallback((files: Record<string, string>, retry = false) => {
    setOpenError('');
    if (retry) attempted.current = '';
    if (!isFullStackProject(files)) return;
    pending.current = { ...files }; void flush();
  }, [flush]);
  const open = useCallback(async () => {
    const current = epoch.current;
    setOpenError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setOpenError('Allow popups to open your app preview.'); return; }
    tab.opener = null;
    try {
      const result = await runtimeRequest<{ url: string }>(projectId, '/preview-ticket', 'development', { method: 'POST', body: '{}' });
      if (current !== epoch.current) { tab.close(); return; }
      tab.location.href = result.url;
    } catch (cause) { tab.close(); if (current === epoch.current) setOpenError(cause instanceof Error ? cause.message : 'Could not open the app preview.'); }
  }, [projectId]);
  const latestJob = runtime.status?.jobs.find(job => job.environment === 'development');
  const activeJob = runtime.status?.jobs.some(job => ['queued', 'running', 'stopping'].includes(job.status));
  const ready = Boolean(runtime.status?.activeRelease || (latestJob?.previewReady && latestJob.status === 'running'));
  const showJobMessage = latestJob && (['queued', 'running', 'failed'].includes(latestJob.status) || (!ready && latestJob.status === 'stopped'));
  const message = openError || (fault ? notice : showJobMessage ? latestJob.message : ready ? 'App preview is running. Update it to use your latest changes.' : notice);
  const available = runtime.status?.enabled && runtime.status.availability?.state === 'ready';
  return { start, open, message, ready, fault,
    canStart: Boolean(available && !busy && !activeJob && !ready),
    canUpdate: Boolean(available && !busy && ready && (!activeJob || (latestJob?.kind === 'preview' && latestJob.previewReady && latestJob.status === 'running'))),
  };
}
