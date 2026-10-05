import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, ServerOff } from 'lucide-react';

/**
 * The live (backend-served) app preview iframe.
 *
 * Full-stack app backends can refuse connections if the deploy pipeline failed
 * or the Worker crashed. The browser's "refused to connect" error page fires
 * onLoad just like a real app, so we cannot rely on onLoad alone to know if
 * the preview is working. We probe reachability with fetch (no-cors) before
 * showing the iframe — a refused connection throws TypeError even with no-cors,
 * while any running server returns an opaque response.
 */
export default function LivePreviewFrame({ projectId, liveUrl }: { projectId: string; liveUrl: string }) {
  const [probeState, setProbeState] = useState<'checking' | 'reachable' | 'unreachable'>('checking');
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [failureMessage, setFailureMessage] = useState('');
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const failedRef = useRef(false);

  // Probe before loading the iframe — connection refused throws even with no-cors
  useEffect(() => {
    let cancelled = false;
    setProbeState('checking');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    fetch(liveUrl, { method: 'HEAD', mode: 'no-cors', signal: controller.signal })
      .then(() => { if (!cancelled) setProbeState('reachable'); })
      .catch(() => { if (!cancelled) setProbeState('unreachable'); })
      .finally(() => clearTimeout(timeout));
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [liveUrl, attempt]);

  useEffect(() => {
    if (probeState !== 'reachable') return;
    setLoaded(false);
    setFailed(false);
    setFailureMessage('');
    failedRef.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSlow(true), 25000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (!event.data || event.data.type !== 'preview-error') return;
      clearTimeout(timer.current);
      failedRef.current = true;
      setFailureMessage(typeof event.data.error === 'string' ? event.data.error : '');
      setFailed(true);
    };
    window.addEventListener('message', onMessage);
    return () => { clearTimeout(timer.current); window.removeEventListener('message', onMessage); };
  }, [liveUrl, attempt, probeState]);

  const retry = () => { setProbeState('checking'); setAttempt(v => v + 1); };

  return (
    <div className="live-preview-frame">
      {probeState === 'reachable' && (
        <iframe
          key={`live-preview-${projectId}-${liveUrl}-${attempt}`}
          ref={frameRef}
          src={liveUrl}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
          onLoad={() => { clearTimeout(timer.current); if (!failedRef.current) setLoaded(true); }}
          onError={() => { clearTimeout(timer.current); setFailed(true); }}
          title="Live App Preview"
        />
      )}
      {(probeState === 'checking' || (probeState === 'reachable' && !loaded && !failed)) && (
        <div className="live-preview-preparing" role="status" aria-live="polite">
          <Loader2 className="lucide-spin" size={22} aria-hidden="true" />
          <strong>{probeState === 'checking' ? 'Connecting to your app…' : 'Preparing your preview…'}</strong>
          <span>{slow ? 'Still working on it — you can keep chatting while it loads.' : 'Getting your app ready and loading the latest version.'}</span>
        </div>
      )}
      {probeState === 'unreachable' && (
        <div className="live-preview-failed" role="alert">
          <ServerOff size={28} strokeWidth={1.5} style={{ color: 'var(--text-muted)', marginBottom: '4px' }} aria-hidden="true" />
          <strong>Backend not responding</strong>
          <span>Your app's server isn't running. This usually means the build didn't finish — ask the builder to fix it or try again.</span>
          <button type="button" onClick={retry}><RefreshCw size={15} aria-hidden="true" />Try again</button>
        </div>
      )}
      {failed && (
        <div className="live-preview-failed" role="alert">
          <strong>The preview couldn&apos;t load.</strong>
          <span>{failureMessage || 'This is usually a connection hiccup — your work is safe.'}</span>
          <button type="button" onClick={retry}><RefreshCw size={15} aria-hidden="true" />Try again</button>
        </div>
      )}
    </div>
  );
}
