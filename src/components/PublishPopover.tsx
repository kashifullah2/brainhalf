import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, Globe2, Loader2, Lock, X } from 'lucide-react';
import { runtimeRequest, useProjectRuntime } from '../lib/project-runtime-client';
import { authFetch, projectPublication } from '../lib/auth-client';
import { getProjects } from '../lib/project-store';
import { usePlatformStatus } from '../lib/status-store';
import { publishProject, checkSlugAvailability, setAppSlug, toAppSlug, APP_SLUG_RE } from '../lib/publish-project';
import { isHostedLimitError } from '../lib/hosted-limit';
import { stages, stageKeys, publishStageIndex, publishProgressView, PublicationFailure, HostedFullNotice } from './PublicationControls';
import { sourceSnapshot } from '../runtime/source';
import type { RuntimeJob, SourceFiles } from '../runtime/types';
import './PublishPopover.css';

type Visibility = 'private' | 'public';

const apiOrigin = () => ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';

/**
 * The small panel that opens under the header's "Go live" button. It keeps the
 * whole publish flow — name the app, choose who can see it, publish to the
 * live (production) address, take it offline — in one place, without leaving
 * the workspace. The console's Go live section stays as the detailed view.
 */
export default function PublishPopover({ projectId, files, onClose, onCustomDomain, onOpenHostedSlots }: {
  projectId: string;
  files: SourceFiles;
  onClose: () => void;
  onCustomDomain: () => void;
  onOpenHostedSlots: () => void;
}) {
  const runtime = useProjectRuntime(projectId, 'production');
  const generating = usePlatformStatus(projectId).isBuilding;
  const [revision, setRevision] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmOffline, setConfirmOffline] = useState(false);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [slugStep, setSlugStep] = useState<'idle' | 'picking' | 'saving'>('idle');
  const [slugInput, setSlugInput] = useState('');
  const [slugError, setSlugError] = useState('');
  const [slugChecking, setSlugChecking] = useState(false);
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const filesRef = useRef(files); filesRef.current = files;
  const panelRef = useRef<HTMLDivElement>(null);

  const status = runtime.status;
  const release = status?.activeRelease;
  const latest = status?.jobs.find(item => item.kind === 'publish');
  const [accepted, setAccepted] = useState<RuntimeJob | null>(null);
  const job: RuntimeJob | null | undefined = accepted ? status?.jobs.find(item => item.id === accepted.id) || accepted : latest;
  const active = status?.jobs.find(item => ['queued', 'running', 'stopping'].includes(item.status));
  const publishing = !!job && ['queued', 'running', 'stopping'].includes(job.status);
  const progress = job && publishing ? publishProgressView(job) : null;
  const stage = publishStageIndex(job?.status, job?.publishStage);
  const ready = !!status?.enabled && status.availability?.state === 'ready';
  const busy = submitting || publishing || actionBusy;
  const currentIsLive = !!revision && release?.revision === revision;
  const liveUrl = status?.productionUrl || '';
  const runtimeDomain = liveUrl.replace(/https?:\/\/[^.]+\./, '') || 'apps.brainhalf.com';

  useEffect(() => {
    let cancelled = false; setRevision(''); setSourceError('');
    void sourceSnapshot(files).then(snapshot => { if (!cancelled) setRevision(snapshot.revision); })
      .catch(cause => { if (!cancelled) setSourceError(cause instanceof Error ? cause.message : 'Check the project source before publishing.'); });
    return () => { cancelled = true; };
  }, [files]);

  // Pre-fill the app name from the project name and the current visibility
  // from the gallery listing, so returning users see their real state.
  useEffect(() => {
    const projectName = getProjects().find(p => p.id === projectId)?.name || '';
    setSlugInput(current => current || toAppSlug(projectName) || '');
    const controller = new AbortController();
    void authFetch(`${apiOrigin()}/api/projects/${encodeURIComponent(projectId)}/showcase`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const data = await response.json() as { showcase?: boolean };
        if (!controller.signal.aborted && data.showcase) setVisibility('public');
      })
      .catch(() => {});
    return () => controller.abort();
  }, [projectId]);

  // Close on outside click / Escape.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointerDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const handleSlugChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-');
    setSlugInput(cleaned); setSlugError('');
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    if (APP_SLUG_RE.test(cleaned)) {
      setSlugChecking(true);
      slugCheckTimer.current = setTimeout(async () => {
        const result = await checkSlugAvailability(projectId, cleaned);
        setSlugChecking(false);
        if (!result.available) setSlugError(result.reason || 'That name is already taken.');
      }, 500);
    } else {
      setSlugChecking(false);
    }
  };

  const publish = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setSubmitting(true); setError(''); setCopied(false);
    try {
      setAccepted(await publishProject(projectId, filesRef.current));
      runtime.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Publishing could not start. Try again.');
    } finally { inFlight.current = false; setSubmitting(false); }
  };

  const startPublish = () => {
    if (!release) {
      setSlugError('');
      setSlugStep('picking');
    } else {
      void publish();
    }
  };

  const confirmSlug = async () => {
    const slug = slugInput.trim();
    if (!APP_SLUG_RE.test(slug)) { setSlugError('Use 4–40 lowercase letters, numbers, or hyphens. Must start with a letter.'); return; }
    setSlugStep('saving'); setSlugError('');
    try {
      await setAppSlug(projectId, slug);
      setSlugStep('idle');
      void publish();
    } catch (cause) {
      setSlugError(cause instanceof Error ? cause.message : 'Could not save the app name. Try again.');
      setSlugStep('picking');
    }
  };

  // "Public" lists the app in the gallery; "Private" keeps it link-only.
  // The gallery requires the published flag, which is set first.
  const applyVisibility = async () => {
    await projectPublication(projectId, AbortSignal.timeout(15_000), true).catch(() => {});
    await authFetch(`${apiOrigin()}/api/projects/${encodeURIComponent(projectId)}/showcase`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showcase: visibility === 'public' }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {});
  };
  const appliedVisibilityJob = useRef<string | null>(null);
  useEffect(() => {
    if (!job || job.kind !== 'publish' || job.status !== 'passed' || appliedVisibilityJob.current === job.id) return;
    appliedVisibilityJob.current = job.id;
    void applyVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status, job?.kind]);

  const unpublish = async () => {
    setActionBusy(true); setError('');
    try {
      await runtimeRequest(projectId, '/unpublish', 'production', { method: 'POST', body: '{}' });
      setAccepted(null); setConfirmOffline(false); runtime.refresh();
      await projectPublication(projectId, AbortSignal.timeout(15_000), false).catch(() => {});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The app could not be taken offline.'); }
    finally { setActionBusy(false); }
  };

  const stopJob = async (target: RuntimeJob) => {
    setActionBusy(true); setError('');
    try { await runtimeRequest(projectId, '/stop', target.environment, { method: 'POST', body: JSON.stringify({ expectedJobId: target.id }) }); runtime.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The job could not be stopped.'); }
    finally { setActionBusy(false); }
  };

  const copyUrl = async () => {
    if (!liveUrl) return;
    try { await navigator.clipboard.writeText(liveUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Copy the public link shown above — clipboard access is unavailable.'); }
  };

  if (slugStep === 'picking' || slugStep === 'saving') {
    const slugValid = APP_SLUG_RE.test(slugInput.trim()) && !slugError && !slugChecking;
    return createPortal(<div className="publish-popover" role="region" aria-label="Choose app name" ref={panelRef}>
      <div className="publish-popover-head">
        <strong>Choose your app's URL</strong>
        <button type="button" className="publish-popover-close" aria-label="Close" onClick={onClose}><X size={15} /></button>
      </div>
      <p className="publish-popover-hint">Pick a name for your app. This becomes its public address — you can change it later from project settings.</p>
      <div className="publish-popover-field">
        <label htmlFor="publish-slug">App name</label>
        <div className="publish-popover-slugrow">
          <input
            id="publish-slug"
            type="text"
            value={slugInput}
            onChange={event => handleSlugChange(event.target.value)}
            placeholder="my-app"
            maxLength={40}
            autoFocus
            spellCheck={false}
            aria-invalid={!!slugError}
            disabled={slugStep === 'saving'}
          />
          {slugChecking && <Loader2 size={14} className="lucide-spin" aria-label="Checking name" />}
          {slugValid && <Check size={14} className="publish-popover-ok" aria-label="Name available" />}
        </div>
        <p className="publish-popover-hint">{slugInput.trim() ? `${slugInput.trim()}.${runtimeDomain}` : `your-name.${runtimeDomain}`}</p>
        {slugError && <p className="publish-popover-error" role="alert">{slugError}</p>}
        <p className="publish-popover-hint">4–40 characters · lowercase letters, numbers, and hyphens · must start with a letter</p>
      </div>
      <div className="publish-popover-actions">
        <button type="button" className="publish-popover-submit" disabled={!slugValid || slugStep === 'saving'} onClick={() => void confirmSlug()}>
          {slugStep === 'saving' ? <><Loader2 size={14} className="lucide-spin" />Saving…</> : 'Continue to publish'}
        </button>
        <button type="button" className="publish-popover-link" disabled={slugStep === 'saving'} onClick={() => { setSlugStep('idle'); void publish(); }}>
          Skip — use default URL
        </button>
      </div>
    </div>, document.body);
  }

  const publishDisabled = busy || generating || !ready || !revision || currentIsLive;
  const publishBlocker = currentIsLive ? ''
    : generating ? 'Wait for the builder to finish, then publish.'
    : !ready ? 'The publishing service is getting ready. Try again in a moment.'
    : !revision ? 'Build your app first — there is nothing to publish yet.'
    : '';

  return createPortal(<div className="publish-popover" role="dialog" aria-label="Project publication" ref={panelRef}>
    <div className="publish-popover-head">
      <strong>{publishing ? 'Publishing your app' : 'Publish your app'}</strong>
      <button type="button" className="publish-popover-close" aria-label="Close" onClick={onClose}><X size={15} /></button>
    </div>

    {job && (publishing || (job.status === 'passed' && release && job.releaseId === release.id)) && <div className="publish-popover-progress" aria-live="polite">
      <p className="publish-popover-progress-heading">{publishing && <Loader2 size={15} className="lucide-spin" />}{job.status === 'passed' && <Check size={15} />} {progress ? progress.heading : job.message}</p>
      <ol className="publish-popover-stages">{stages.map((label, index) => <li key={label} aria-current={index === stage ? 'step' : undefined} className={index < stage || job.status === 'passed' ? 'is-complete' : ''}><span aria-hidden="true">{index < stage || job.status === 'passed' ? '✓' : index + 1}</span>{label}</li>)}</ol>
      {publishing && <p className="publish-popover-hint">You can close this — publishing keeps running in the background.</p>}
      {publishing && <button type="button" className="publish-popover-link" disabled={submitting || actionBusy} onClick={() => void stopJob(job)}>Cancel publishing</button>}
    </div>}

    {isHostedLimitError(job?.message || error) && <HostedFullNotice onOpenHostedSlots={onOpenHostedSlots} />}
    {job?.status === 'stopped' && <p role="status" className="publish-popover-note">{job.message}</p>}
    {sourceError && <p role="alert" className="publish-popover-error">{sourceError}</p>}
    {error && !isHostedLimitError(error) && <p role="alert" className="publish-popover-error">{error}</p>}
    {runtime.error && <p role="status" className="publish-popover-note">{runtime.error} <button type="button" className="publish-popover-link" onClick={runtime.refresh}>Retry</button></p>}

    {job?.status === 'failed' && !isHostedLimitError(job.message) && <>
      <p role="alert" className="publish-popover-error">Publishing stopped: {job.message} {release ? 'Your live app is unchanged.' : 'Nothing was published.'}</p>
      <PublicationFailure key={job.id} projectId={projectId} job={job} canRepair={!busy && !generating && !active} />
    </>}

    {!publishing && job?.status !== 'failed' && <>
      {release && liveUrl && <div className="publish-popover-live">
        <a href={liveUrl} target="_blank" rel="noopener noreferrer" className="publish-popover-url">{liveUrl.replace(/^https?:\/\//, '')}</a>
        <button type="button" className="publish-popover-icon" aria-label="Copy app address" title="Copy app address" onClick={() => void copyUrl()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
        <button type="button" className="publish-popover-icon" aria-label="Open live app" title="Open live app" onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}><ExternalLink size={14} /></button>
      </div>}
      {release && !currentIsLive && <p className="publish-popover-hint">Publish again to put your latest changes online.</p>}

      <div className="publish-popover-visibility" role="radiogroup" aria-label="Who can open your app">
        <button type="button" role="radio" aria-checked={visibility === 'private'} className={visibility === 'private' ? 'active' : ''} disabled={busy} onClick={() => setVisibility('private')}>
          <Lock size={14} />
          <span><strong>Private</strong><small>Only people with the link can open it.</small></span>
        </button>
        <button type="button" role="radio" aria-checked={visibility === 'public'} className={visibility === 'public' ? 'active' : ''} disabled={busy} onClick={() => setVisibility('public')}>
          <Globe2 size={14} />
          <span><strong>Public</strong><small>Also listed in the BrainHalf gallery.</small></span>
        </button>
      </div>

      <div className="publish-popover-actions">
        <button type="button" className="publish-popover-submit" disabled={publishDisabled} onClick={startPublish}>
          {submitting && <Loader2 size={14} className="lucide-spin" />}
          {submitting ? 'Starting…' : currentIsLive ? 'Up to date' : release ? 'Publish changes' : 'Publish app'}
        </button>
        {release && !confirmOffline && <button type="button" className="publish-popover-link" disabled={busy} onClick={() => setConfirmOffline(true)}>Take app offline</button>}
        {release && confirmOffline && <>
          <button type="button" className="publish-popover-link publish-popover-danger" disabled={actionBusy} onClick={() => void unpublish()}>Confirm take offline</button>
          <button type="button" className="publish-popover-link" disabled={actionBusy} onClick={() => setConfirmOffline(false)}>Keep online</button>
        </>}
      </div>
      {publishBlocker && <p className="publish-popover-hint" role="status">{publishBlocker}</p>}

      <button type="button" className="publish-popover-link publish-popover-domain" onClick={onCustomDomain}>
        Use your own domain (custom domain settings)
      </button>
    </>}
  </div>, document.body);
}
