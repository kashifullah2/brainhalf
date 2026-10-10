import { useCallback, useEffect, useRef, useState } from 'react';
import { isFullStackProject } from './backend-runner';
import { runtimeRequest, type useProjectRuntime } from './project-runtime-client';
import { sourceSnapshot } from '../runtime/source';
import type { RuntimeStatus } from '../runtime/types';
import { resolveBackendFailure } from './backend-failure';

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
  /**
   * B2/B3: Remember the last failed job message. The jobs list can prune
   * finished jobs, which would otherwise make a backend failure silently
   * vanish. Declared up here so start() can clear it on retry.
   */
  const lastFailureRef = useRef<{ jobId: string; message: string } | null>(null);
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
      if (snapshot.revision === status.activeRelease?.revision || (active?.environment === 'development' && (active.kind === 'preview' || active.kind === 'dev') && active.revision === snapshot.revision)) { if (pending.current === files) pending.current = null; return; }
      if (active) {
        if (active.environment === 'development' && active.kind === 'dev' && active.previewReady) {
          // Dev job is running with HMR — individual files are pushed via pushFile; no stop/restart needed.
          if (pending.current === files) pending.current = null;
          return;
        }
        if (active.environment === 'development' && (active.kind === 'preview' || active.kind === 'dev') && active.previewReady) {
          setNotice('Updating the running development app…');
          await runtimeRequest(projectId, '/stop', 'development', { method: 'POST', body: JSON.stringify({ expectedJobId: active.id }) });
          if (current === epoch.current) refresh();
        } else setNotice('Waiting for the current build before updating the backend…');
        return;
      }
      if (pending.current === files) pending.current = null;
      if (snapshot.revision === attempted.current && !status.jobs.some(job => job.revision === snapshot.revision && ['failed', 'stopped'].includes(job.status))) return;
      setFault(false); setNotice('Starting dev server…');
      await runtimeRequest(projectId, '/jobs', 'development', { method: 'POST', body: JSON.stringify({ kind: 'dev', files }) });
      if (current === epoch.current) { attempted.current = snapshot.revision; refresh(); }
    } catch (cause) {
      if (current === epoch.current) { setFault(true); setNotice(toPlainBackendError(cause)); }
    } finally { if (current === epoch.current) { running.current = false; setBusy(false); } }
  }, [projectId, refresh]);
  useEffect(() => { if (pending.current) void flush(); }, [runtime.status, flush]);
  const start = useCallback((files: Record<string, string>, retry = false) => {
    setOpenError('');
    if (retry) { attempted.current = ''; lastFailureRef.current = null; }
    // A non-full-stack snapshot supersedes any pending full-stack one. Without
    // this, start() returns early but the older snapshot stays pending, and the
    // next status change builds it — the preview would show stale files after
    // a frontend-only update.
    if (!isFullStackProject(files)) {
      pending.current = null;
      // B2/B3: never fail silently — tell the user plainly why there's no
      // backend to start instead of leaving a dead button.
      setFault(false);
      setNotice('This app has no backend to start — it runs entirely in your browser. Its data is saved on this device only.');
      return;
    }
    pending.current = { ...files }; void flush();
  }, [flush]);
  const open = useCallback(async () => {
    const current = epoch.current;
    setOpenError('');
    const tab = window.open('about:blank', '_blank');
    if (!tab) { setOpenError('Allow popups to open your app preview.'); return; }
    tab.opener = null;
    try {
      // autoSignIn: true tells the runtime to create/get the owner's app
      // account and issue an app session on the same redirect, so the owner
      // lands already signed in — no "Sign in to your account" screen.
      const result = await runtimeRequest<{ url: string }>(projectId, '/preview-ticket', 'development', { method: 'POST', body: JSON.stringify({ autoSignIn: true }) });
      if (current !== epoch.current) { tab.close(); return; }
      tab.location.href = result.url;
    } catch (cause) { tab.close(); if (current === epoch.current) setOpenError(cause instanceof Error ? cause.message : 'Could not open the app preview.'); }
  }, [projectId]);
  const latestJob = runtime.status?.jobs.find(job => job.environment === 'development');
  const activeJob = runtime.status?.jobs.some(job => ['queued', 'running', 'stopping'].includes(job.status));
  const ready = Boolean(runtime.status?.activeRelease || (latestJob?.previewReady && latestJob.status === 'running'));
  const readyRef = useRef(ready);
  readyRef.current = ready;
  // B2/B3: persist backend failures across job-list pruning so a failed
  // "Start app preview" never silently reverts to "not running".
  const failureResolution = resolveBackendFailure({
    latestJob: latestJob ? { id: latestJob.id, status: latestJob.status, message: latestJob.message } : undefined,
    ready,
    activeJob: Boolean(activeJob),
    lastFailure: lastFailureRef.current,
  });
  lastFailureRef.current = failureResolution.nextLastFailure;
  const rememberedFailure = failureResolution.failureMessage;

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
  const failed = Boolean((latestJob && latestJob.status === 'failed') || rememberedFailure);
  // B2/B3: a remembered failure survives job-list pruning so the error stays visible.
  const failureMessage = (latestJob?.status === 'failed' && latestJob.message) ? latestJob.message : rememberedFailure;
  // When the preview is running, a failed verify/publish job message must not
  // bleed into the "Live app preview" strip — those failures belong in the
  // publish panel. Only preview/build failures affect the preview strip.
  const previewRelevantMessage = showJobMessage && (!ready || latestJob.kind === 'preview' || latestJob.kind === 'dev' || latestJob.kind === 'build');
  const message = openError || (fault ? notice : previewRelevantMessage ? latestJob.message : ready ? 'Dev server running. Files are pushed as they are written.' : (failureMessage || notice));
  const available = runtime.status?.enabled && runtime.status.availability?.state === 'ready';
  // True while the backend is being built/deployed but not yet live — drives
  // the non-blocking building pill that replaces the old "Start app preview" prompt.
  // Excludes failed state so the pill and the error strip never both render.
  const isBuilding = (busy || Boolean(activeJob)) && !ready && !failed;
  const canPush = Boolean(latestJob?.kind === 'dev' && latestJob.previewReady && latestJob.status === 'running');
  const pushFile = useCallback(async (path: string, content: string) => {
    await runtimeRequest(projectId, '/live-files', 'development', { method: 'POST', body: JSON.stringify({ path, content }) });
  }, [projectId]);
  return { start, open, message, ready, fault, failed, liveUrl, isBuilding, pushFile, canPush,
    canStart: Boolean(available && !busy && !activeJob && !ready),
    canUpdate: Boolean(available && !busy && ready && (!activeJob || ((latestJob?.kind === 'preview' || latestJob?.kind === 'dev') && latestJob.previewReady && latestJob.status === 'running'))),
    latestJobId: latestJob?.id,
    // Build start time — used by BackendBuildProgress to show elapsed time.
    buildStartedAt: latestJob?.startedAt ?? latestJob?.createdAt,
  };
}
