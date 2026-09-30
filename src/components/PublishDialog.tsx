import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Globe, Loader2, Rocket, X } from 'lucide-react';
import { describeVerificationFailure, isVerificationFailure } from '../lib/verification-copy';
import { useModalFocus } from '../lib/use-modal-focus';
import { useProjectRuntime, runtimeRequest } from '../lib/project-runtime-client';
import { usePlatformStatus } from '../lib/status-store';
import { getProjects } from '../lib/project-store';
import { publishProject, checkSlugAvailability, setAppSlug, toAppSlug, APP_SLUG_RE } from '../lib/publish-project';
import { sourceSnapshot } from '../runtime/source';
import { publicationTarget } from '../runtime/publication';
import { appEvents } from '../lib/events';
import CustomDomainSettings from './CustomDomainSettings';
import type { RuntimeJob, SourceFiles } from '../runtime/types';
import './PublishDialog.css';

export const stageLabels = ['Build app', 'Test the app', 'Connect services', 'Put app online', 'Final checks', 'Live'];
export const stageKeys = ['build', 'verify', 'services', 'deploy', 'check', 'live'];

export interface PublishProgressView {
  /** Heading shown above the stage list. */
  heading: string;
  /** Index into stageLabels of the stage actually in progress, or null when nothing has started yet. */
  currentStage: number | null;
  /** True while the job is waiting for a build slot — no stage may show as active. */
  waitingInQueue: boolean;
}

/**
 * Derives the honest progress view for a publish job.
 *
 * The old UI marked "Build app" as in-progress while the job was still queued,
 * so the dialog claimed "Queued" and "building" at the same time. A queued job
 * has started nothing: currentStage is null and the heading says so plainly.
 */
export function publishProgressView(job: Pick<RuntimeJob, 'status' | 'message' | 'publishStage'>): PublishProgressView {
  if (job.status === 'queued') {
    return { heading: 'Queued — waiting for a build slot…', currentStage: null, waitingInQueue: true };
  }
  return {
    heading: job.message || (job.status === 'stopping' ? 'Stopping…' : 'Publishing your app…'),
    currentStage: stageKeys.indexOf(job.publishStage || 'build'),
    waitingInQueue: false,
  };
}

export default function PublishDialog({ projectId, files, publishOnOpen, onClose, onManage }: {
  projectId: string; files: SourceFiles; publishOnOpen?: SourceFiles; onClose: () => void; onManage: () => void;
}) {
  const ref = useModalFocus(true, onClose);
  const runtime = useProjectRuntime(projectId, 'production');
  const generating = usePlatformStatus(projectId).isBuilding;
  const status = runtime.status;
  const release = status?.activeRelease;
  const ready = status?.enabled && status.availability?.state === 'ready';

  const [revision, setRevision] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [slugInput, setSlugInput] = useState(() => {
    const name = getProjects().find(p => p.id === projectId)?.name || '';
    return toAppSlug(name) || '';
  });
  const [slugError, setSlugError] = useState('');
  const [slugChecking, setSlugChecking] = useState(false);
  const slugCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState<RuntimeJob | null>(null);
  const [copied, setCopied] = useState(false);
  const [showDomain, setShowDomain] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmOffline, setConfirmOffline] = useState(false);
  const inFlight = useRef(false);
  const startedOnOpen = useRef(false);
  const filesRef = useRef(files); filesRef.current = files;
  const nameInputRef = useRef<HTMLInputElement>(null);

  const runtimeDomain = (status as (typeof status & { productionUrl?: string }))?.productionUrl?.replace(/https?:\/\/[^.]+\./, '') || 'apps.brainhalf.com';

  useEffect(() => {
    let cancelled = false; setRevision(''); setSourceError('');
    void sourceSnapshot(files).then(snapshot => {
      publicationTarget(snapshot.files);
      if (!cancelled) setRevision(snapshot.revision);
    }).catch(cause => { if (!cancelled) setSourceError(cause instanceof Error ? cause.message : 'Check the project source.'); });
    return () => { cancelled = true; };
  }, [files]);

  const latest = status?.jobs.find(job => job.kind === 'publish');
  const job = accepted ? status?.jobs.find(item => item.id === accepted.id) || accepted : latest;
  const publishing = !!job && ['queued', 'running', 'stopping'].includes(job.status);
  const busy = submitting || publishing || actionBusy;
  const currentIsLive = !!revision && release?.revision === revision;
  const progress = job && publishing ? publishProgressView(job) : null;
  const stage = job?.status === 'passed' ? 5 : progress?.currentStage ?? stageKeys.indexOf(job?.publishStage || 'build');

  const needsName = !release && !publishing && !job;

  const publish = async (source = filesRef.current) => {
    if (inFlight.current) return;
    inFlight.current = true; setSubmitting(true); setError(''); setCopied(false);
    try {
      setAccepted(await publishProject(projectId, source)); runtime.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Publishing could not start. Try again.'); }
    finally { inFlight.current = false; setSubmitting(false); }
  };

  useEffect(() => {
    if (!publishOnOpen || startedOnOpen.current || needsName) return;
    startedOnOpen.current = true;
    void publish(publishOnOpen);
  }, [publishOnOpen, needsName]);

  const handleSlugChange = (value: string) => {
    const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-');
    setSlugInput(cleaned);
    setSlugError('');
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    if (APP_SLUG_RE.test(cleaned)) {
      setSlugChecking(true);
      slugCheckTimer.current = setTimeout(async () => {
        const result = await checkSlugAvailability(projectId, cleaned);
        setSlugChecking(false);
        if (!result.available) setSlugError(result.reason || 'That name is already taken.');
      }, 500);
    } else { setSlugChecking(false); }
  };

  const confirmSlugAndPublish = async () => {
    const slug = slugInput.trim();
    if (!APP_SLUG_RE.test(slug)) { setSlugError('Use 4–40 lowercase letters, numbers, or hyphens.'); return; }
    setSubmitting(true); setSlugError('');
    try {
      await setAppSlug(projectId, slug);
      void publish(publishOnOpen || filesRef.current);
    } catch (cause) {
      setSlugError(cause instanceof Error ? cause.message : 'Could not save the name. Try again.');
      setSubmitting(false);
    }
  };

  const skipSlugAndPublish = () => void publish(publishOnOpen || filesRef.current);

  const stopJob = async (target: RuntimeJob) => {
    setActionBusy(true); setError('');
    try { await runtimeRequest(projectId, '/stop', target.environment, { method: 'POST', body: JSON.stringify({ expectedJobId: target.id }) }); runtime.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The job could not be stopped.'); }
    finally { setActionBusy(false); }
  };

  const unpublish = async () => {
    setActionBusy(true); setError('');
    try { await runtimeRequest(projectId, '/unpublish', 'production', { method: 'POST', body: '{}' }); setAccepted(null); setConfirmOffline(false); runtime.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The app could not be taken offline.'); }
    finally { setActionBusy(false); }
  };

  const slugValid = APP_SLUG_RE.test(slugInput.trim()) && !slugError;

  const showNameStep = needsName && !error && !submitting;
  const showPublishing = publishing || submitting;
  const showSuccess = !showNameStep && !showPublishing && release && (job?.status === 'passed' || (!job || job.status !== 'failed'));
  const showFailed = !showNameStep && !showPublishing && job?.status === 'failed';
  const showStopped = !showNameStep && !showPublishing && !showFailed && !showSuccess && (job?.status === 'stopped' || job?.status === 'stopping');

  useEffect(() => { if (showNameStep) nameInputRef.current?.focus(); }, [showNameStep]);

  return createPortal(
    <div className="pub-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="pub-dialog" role="dialog" aria-modal="true" aria-labelledby="pub-title" tabIndex={-1}>
        <button type="button" className="pub-close" aria-label="Close publishing" onClick={onClose}><X size={18} /></button>
        <h2 id="pub-title" className="pub-title">Publish your app</h2>

        <section className="pub-content" aria-label="Project publication">

          {/* ─── Name step ─── */}
          {showNameStep && (
            <div className="pub-step pub-step-name">
              <div className="pub-icon-wrap"><Rocket size={28} /></div>
              <p className="pub-heading">Name your app</p>
              <p className="pub-subtitle">Choose a name — this becomes your app's public web address.</p>

              <div className="pub-name-field">
                <div className="pub-name-input-row">
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={slugInput}
                    onChange={e => handleSlugChange(e.target.value)}
                    placeholder="my-cool-app"
                    maxLength={40}
                    spellCheck={false}
                    disabled={submitting}
                    onKeyDown={e => { if (e.key === 'Enter' && slugValid && !slugChecking && !submitting) void confirmSlugAndPublish(); }}
                  />
                  {slugChecking && <Loader2 size={16} className="pub-spinner" />}
                  {slugValid && !slugChecking && <Check size={16} className="pub-check" />}
                </div>
                <p className="pub-url-preview">
                  {slugInput.trim()
                    ? <span className="pub-url-highlight">{slugInput.trim()}.{runtimeDomain}</span>
                    : <span className="pub-url-placeholder">your-app.{runtimeDomain}</span>}
                </p>
                {slugError && <p className="pub-field-error" role="alert">{slugError}</p>}
              </div>

              {!ready && <p className="pub-notice">{runtime.error || status?.availability?.message || 'Checking hosting availability…'}</p>}
              {generating && <p className="pub-notice">Wait for the app to finish generating.</p>}
              {sourceError && <p className="pub-field-error" role="alert">{sourceError}</p>}

              <div className="pub-name-actions">
                <button
                  type="button"
                  className="button-primary"
                  disabled={!slugValid || slugChecking || submitting || !ready || generating}
                  onClick={() => void confirmSlugAndPublish()}
                >
                  {submitting ? <><Loader2 size={16} className="pub-spinner" /> Publishing…</> : 'Publish'}
                </button>
                <button type="button" className="button-ghost" disabled={submitting || !ready || generating} onClick={skipSlugAndPublish}>
                  Skip — use default URL
                </button>
              </div>
            </div>
          )}

          {/* ─── Publishing progress ─── */}
          {showPublishing && (
            <div className="pub-step pub-step-progress">
              <p className="pub-heading">{submitting ? 'Starting…' : progress?.heading || 'Publishing your app…'}</p>
              {progress?.waitingInQueue && (
                <p className="pub-notice">Your publish is in line and will start on its own — nothing is building yet.</p>
              )}

              <div className="pub-stages">
                {stageLabels.map((label, i) => {
                  const done = i < stage || job?.status === 'passed';
                  const current = progress?.currentStage === i && publishing;
                  return (
                    <div key={label} className={`pub-stage ${done ? 'done' : ''} ${current ? 'current' : ''}`}>
                      <span className="pub-stage-icon">
                        {done ? <Check size={14} /> : current ? <Loader2 size={14} className="pub-spinner" /> : <span>{i + 1}</span>}
                      </span>
                      <span className="pub-stage-label">{label}</span>
                    </div>
                  );
                })}
              </div>

              <p className="pub-footnote">You can close this — publishing keeps running in the background.</p>

              {error && <p className="pub-field-error" role="alert">{error}</p>}

              {publishing && job && (
                <button type="button" className="button-ghost" disabled={submitting || actionBusy} onClick={() => void stopJob(job)}>Cancel publishing</button>
              )}
            </div>
          )}

          {/* ─── Success ─── */}
          {showSuccess && (
            <div className="pub-step pub-step-success">
              <div className="pub-success-badge"><Check size={32} /></div>
              <p className="pub-heading">{currentIsLive ? 'This version is live' : 'Your published version'}</p>

              {status?.productionUrl && (
                <a className="pub-live-url" href={status.productionUrl} target="_blank" rel="noopener noreferrer">
                  {status.productionUrl.replace(/^https?:\/\//, '')}
                  <ExternalLink size={14} />
                </a>
              )}

              <div className="pub-success-actions">
                <button type="button" className="button-secondary" onClick={() => {
                  if (status?.productionUrl) navigator.clipboard.writeText(status.productionUrl).then(() => setCopied(true)).catch(() => setError('Copy the URL shown above.'));
                }}>
                  {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy link</>}
                </button>
              </div>

              {!currentIsLive && <p className="pub-hint">Publish again to put your latest changes online.</p>}

              <div className="pub-publish-row">
                <button
                  type="button"
                  className="button-primary"
                  disabled={!ready || !revision || busy || generating || currentIsLive}
                  onClick={() => void publish()}
                >{currentIsLive ? 'Up to date' : 'Publish changes'}</button>
              </div>

              {error && <p className="pub-field-error" role="alert">{error}</p>}

              {/* Custom domain */}
              <div className="pub-domain-section">
                <button type="button" className="pub-domain-toggle" onClick={() => setShowDomain(!showDomain)}>
                  <Globe size={16} />
                  <span>Use your own domain</span>
                  <span className="pub-chevron" data-open={showDomain}>›</span>
                </button>
                {showDomain && (
                  <div className="pub-domain-content">
                    <CustomDomainSettings projectId={projectId} productionUrl={status?.productionUrl} />
                  </div>
                )}
              </div>

              {/* Take offline */}
              {!confirmOffline
                ? <button type="button" className="button-ghost pub-offline-btn" disabled={busy} onClick={() => setConfirmOffline(true)}>Take app offline</button>
                : <div className="pub-offline-confirm">
                    <p>Your app will stop working for visitors. Your saved information and versions stay safe — you can publish again any time.</p>
                    <div className="pub-offline-actions">
                      <button type="button" className="button-ghost" disabled={busy} onClick={() => setConfirmOffline(false)}>Keep live</button>
                      <button type="button" className="button-danger" disabled={busy} onClick={() => void unpublish()}>Confirm take offline</button>
                    </div>
                  </div>}
            </div>
          )}

          {/* ─── Failed ─── */}
          {showFailed && job && (
            <div className="pub-step pub-step-failed">
              <p className="pub-heading">Publishing failed</p>
              {isVerificationFailure(job.message)
                ? <p className="pub-subtitle" role="alert">The app didn't pass its final automatic checks, so this version stayed unpublished. Your live app, if any, is untouched.</p>
                : <p role="alert" className="pub-field-error">{job.message}</p>}
              <PublishFailureDetails projectId={projectId} job={job} onRepair={(buildLog) => {
                let accepted = false;
                appEvents.emit('repair-project-request', {
                  projectId,
                  message: `Fix the app's publishing failure. Preserve the existing features. Use the current source. Do not publish automatically.\n\n${job.message}${buildLog ? '\n\n' + buildLog : ''}`,
                  onAccepted: () => { accepted = true; },
                });
                return accepted;
              }} />
              <div className="pub-error-actions">
                <button type="button" className="button-primary" onClick={() => { setError(''); setAccepted(null); void publish(); }}>Try again</button>
                <button type="button" className="button-ghost" onClick={onManage}>View full console</button>
              </div>
            </div>
          )}

          {/* ─── Stopped / cancelled ─── */}
          {showStopped && (
            <div className="pub-step pub-step-stopped">
              <p className="pub-heading">Publishing cancelled</p>
              <p className="pub-subtitle">{job?.message || 'Publishing was stopped before completion.'}</p>
              <button type="button" className="button-primary" onClick={() => { setAccepted(null); void publish(); }}>Publish again</button>
            </div>
          )}

          {/* Idle: no name needed, no job, no release — waiting for runtime */}
          {!showNameStep && !showPublishing && !showSuccess && !showFailed && !showStopped && (
            <div className="pub-step">
              {!ready && <p className="pub-notice">{runtime.error || status?.availability?.message || 'Checking hosting availability…'}</p>}
              {error && <p className="pub-field-error" role="alert">{error}</p>}
              {ready && <button type="button" className="button-primary" disabled={!revision || busy || generating} onClick={() => void publish()}>
                {submitting ? 'Publishing…' : 'Publish app'}
              </button>}
            </div>
          )}

        </section>
      </div>
    </div>,
    document.body
  );
}

function PublishFailureDetails({ projectId, job, onRepair }: { projectId: string; job: RuntimeJob; onRepair: (buildLog: string) => boolean }) {
  const [details, setDetails] = useState<{ logs: Array<{ job: string; text: string }>; verification?: { jobId: string; checks: Array<{ name: string; passed: boolean; detail: string }> } | null } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [repairNotice, setRepairNotice] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setDetails(null); setLoadError('');
    void runtimeRequest<NonNullable<typeof details>>(projectId, `/logs?job=${encodeURIComponent(job.id)}`, job.environment, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setDetails(value); })
      .catch(cause => { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : 'Build log unavailable.'); });
    return () => controller.abort();
  }, [projectId, job.id, job.environment]);
  const logs = details?.logs?.filter(entry => entry.job === job.id).map(entry => entry.text).join('\n\n');
  const checks = details?.verification?.jobId === job.id ? details.verification.checks.filter(check => !check.passed) : [];
  const copy = checks.length ? describeVerificationFailure(checks) : null;
  const technical = !!checks.length || !!logs;
  return <div className="pub-failure-details">
    {!details && !loadError && <p>Loading details…</p>}
    {loadError && <p>{loadError}</p>}
    {copy && <div className="pub-failure-plain">
      <p className="pub-failure-headline">{copy.headline}</p>
      <ul>{copy.plainChecks.map((line, index) => <li key={index}>{line}</li>)}</ul>
      <p className="pub-failure-reassurance">{copy.reassurance}</p>
    </div>}
    {details && <button type="button" className="button-secondary" onClick={() => {
      const ok = onRepair(logs || '');
      setRepairNotice(ok ? 'The builder is fixing the problem.' : 'Finish the current request first.');
    }}>Fix publishing problem</button>}
    {repairNotice && <p>{repairNotice}</p>}
    {technical && <details><summary>Technical details</summary>
      {!!checks.length && <ul className="pub-failure-checks">{checks.map(check => <li key={check.name}><strong>{check.name}</strong>: {check.detail}</li>)}</ul>}
      {logs && <pre tabIndex={0} aria-label="Failed publishing build log">{logs}</pre>}
    </details>}
  </div>;
}
