import { useCallback, useEffect, useRef, useState } from 'react';
import { isFullStackProject } from './backend-runner';
import { runtimeRequest, type useProjectRuntime } from './project-runtime-client';
import { sourceSnapshot } from '../runtime/source';
import type { RuntimeStatus } from '../runtime/types';

/**
 * Convert a backend start failure into plain language for non-technical users.
 * Technical error messages (network errors, stack traces, errno codes) are
 * replaced with a generic message. Only messages that are already plain
 * language are passed through.
 */
export function toPlainBackendError(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : '';
  if (!raw) return 'The backend could not start.';
  // Technical patterns that a farmer won't understand — replace with plain language.
  if (/ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|fetch failed|NetworkError|stack|at\s+\w+\s*\(|Error:/i.test(raw)) {
    return 'The backend could not start. Check your connection and try again.';
  }
  // If it's already a plain-language message from our own code, pass it through.
  if (raw.length < 200 && !/[{}[\];]/.test(raw)) return raw;
  return 'The backend could not start.';
}

const TICKET_TTL_MS = 45_000; // Refresh well before the 60 s server TTL; background tabs throttle timers
const TICKET_RETRY_MS = 10_000; // Retry a failed ticket refresh quickly instead of blanking the preview

type Runtime = ReturnType<typeof useProjectRuntime>;
/** A generation can queue one latest development snapshot. Never starts a production job. */
export function useAutomaticBackend(projectId: string, runtime: Runtime) {
  const [notice, setNotice] = useState('');
  const [fault, setFault] = useState(false);
  const [openError, setOpenError] = useState('');
  const [busy, setBusy] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const pending = useRef<Record<string, string> | null>(null);
  const running = useRef(false);
  const attempted = useRef('');
  const epoch = useRef(0);
  const liveUrlTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fetchTicketRef = useRef<(() => void) | null>(null);
  const ticketFault = useRef(false);
  const refresh = runtime.refresh;
  useEffect(() => {
    epoch.current++;
    pending.current = null;
    attempted.current = '';
    running.current = false;
    setBusy(false);
    setNotice('');
    setFault(false);
    setOpenError('');
    setLiveUrl(null);
    clearTimeout(liveUrlTimer.current);
    ticketFault.current = false;
    fetchTicketRef.current = null;
    return () => {
      epoch.current++;
      clearTimeout(liveUrlTimer.current);
    };
  }, [projectId]);
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
      if (current === epoch.current) { setFault(true); setNotice(toPlainBackendError(cause)); }
    } finally { if (current === epoch.current) { running.current = false; setBusy(false); } }
  }, [projectId, refresh]);
  useEffect(() => { if (pending.current) void flush(); }, [runtime.status, flush]);
  const start = useCallback((files: Record<string, string>, retry = false) => {
    setOpenError('');
    if (retry) attempted.current = '';
    // A non-full-stack snapshot supersedes any pending full-stack one. Without
    // this, start() returns early but the older snapshot stays pending, and the
    // next status change builds it — the preview would show stale files after
    // a frontend-only update.
    if (!isFullStackProject(files)) { pending.current = null; return; }
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
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // Maintain an embedded-preview ticket URL that refreshes before expiry.
  // When ready → false (backend stopped), clear immediately so the iframe reverts.
  // A failed refresh no longer blanks the preview: the current ticket may still
  // be valid, so we keep showing it, say so honestly, and retry shortly.
  useEffect(() => {
    clearTimeout(liveUrlTimer.current);
    if (!ready) { setLiveUrl(null); fetchTicketRef.current = null; return; }

    let cancelled = false;
    const fetchTicket = async () => {
      clearTimeout(liveUrlTimer.current);
      try {
        const result = await runtimeRequest<{ url: string }>(projectId, '/preview-ticket', 'development', { method: 'POST', body: JSON.stringify({ embed: true }) });
        if (cancelled) return;
        setLiveUrl(result.url);
        if (ticketFault.current) { ticketFault.current = false; setFault(false); setNotice(''); }
        liveUrlTimer.current = setTimeout(fetchTicket, TICKET_TTL_MS);
      } catch {
        if (cancelled) return;
        liveUrlTimer.current = setTimeout(fetchTicket, TICKET_RETRY_MS);
        if (!ticketFault.current) {
          ticketFault.current = true;
          setFault(true);
          setNotice('Your preview link could not be refreshed. Trying again — your app is still running.');
        }
      }
    };
    fetchTicketRef.current = fetchTicket;
    void fetchTicket();
    return () => { cancelled = true; clearTimeout(liveUrlTimer.current); };
  }, [projectId, ready]);

  // Background tabs throttle timers, which can let the 60 s ticket expire
  // before the scheduled refresh runs. Refresh promptly when visible again.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible' && readyRef.current) fetchTicketRef.current?.(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const showJobMessage = latestJob && (['queued', 'running', 'failed'].includes(latestJob.status) || (!ready && latestJob.status === 'stopped'));
  const failed = Boolean(latestJob && latestJob.status === 'failed');
  const message = openError || (fault ? notice : showJobMessage ? latestJob.message : ready ? 'App preview is running. Update it to use your latest changes.' : notice);
  const available = runtime.status?.enabled && runtime.status.availability?.state === 'ready';
  return { start, open, message, ready, fault, failed, liveUrl,
    canStart: Boolean(available && !busy && !activeJob && !ready),
    canUpdate: Boolean(available && !busy && ready && (!activeJob || (latestJob?.kind === 'preview' && latestJob.previewReady && latestJob.status === 'running'))),
  };
}
