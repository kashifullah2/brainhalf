import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

/**
 * The live (backend-served) app preview iframe.
 *
 * Previously the iframe rendered the moment a ticket URL existed, so while the
 * dev server was still spinning up — or serving a stale empty build — the user
 * stared at a blank white frame under a banner claiming "your running app is
 * shown below". This wrapper keeps an honest "Preparing your preview…"
 * overlay up until the frame actually fires onLoad for the current URL, and
 * says so plainly if it takes a while. If the frame itself fails to load
 * (e.g. a connection drop), it shows a failed state with a retry instead of
 * spinning forever.
 */
export default function LivePreviewFrame({ projectId, liveUrl }: { projectId: string; liveUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    setSlow(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSlow(true), 25000);
    return () => clearTimeout(timer.current);
  }, [liveUrl, attempt]);

  return (
    <div className="live-preview-frame">
      <iframe
        key={`live-preview-${projectId}-${liveUrl}-${attempt}`}
        src={liveUrl}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
        onLoad={() => { clearTimeout(timer.current); setLoaded(true); }}
        onError={() => { clearTimeout(timer.current); setFailed(true); }}
        title="Live App Preview"
      />
      {!loaded && !failed && (
        <div className="live-preview-preparing" role="status" aria-live="polite">
          <Loader2 className="lucide-spin" size={22} aria-hidden="true" />
          <strong>Preparing your preview…</strong>
          <span>{slow ? 'Still working on it — you can keep chatting while it loads.' : 'Getting your app ready and loading the latest version.'}</span>
        </div>
      )}
      {failed && (
        <div className="live-preview-failed" role="alert">
          <strong>The preview couldn&apos;t load.</strong>
          <span>This is usually a connection hiccup — your work is safe.</span>
          <button type="button" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={15} aria-hidden="true" />Try again</button>
        </div>
      )}
    </div>
  );
}
