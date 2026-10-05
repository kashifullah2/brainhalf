import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, ServerOff } from 'lucide-react';

/**
 * Recycled live preview iframe — keeps the iframe DOM node alive across
 * reloads to preserve WebSocket connections, service workers, and in-memory
 * state when possible. On retry or URL change the iframe reloads in-place
 * via location.replace() instead of being destroyed and recreated.
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
  const mountedUrlRef = useRef<string | null>(null);

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
    setSlow(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSlow(true), 25000);
    // Recycle: if the iframe is already mounted, reload in-place
    if (mountedUrlRef.current && frameRef.current) {
      try { frameRef.current.contentWindow?.location.replace(liveUrl); }
      catch { frameRef.current.src = liveUrl; }
    }
    mountedUrlRef.current = liveUrl;
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

  // Reset on project change
  useEffect(() => { mountedUrlRef.current = null; }, [projectId]);

  const retry = useCallback(() => { setProbeState('checking'); setAttempt(v => v + 1); }, []);

  const showIframe = probeState === 'reachable' || mountedUrlRef.current;

  return (
    <div className="live-preview-frame">
      {showIframe && (
        <iframe
          ref={frameRef}
          src={liveUrl}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
          onLoad={() => { clearTimeout(timer.current); if (!failedRef.current) setLoaded(true); }}
          onError={() => { clearTimeout(timer.current); setFailed(true); }}
          style={probeState !== 'reachable' ? { visibility: 'hidden', position: 'absolute' } : undefined}
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
