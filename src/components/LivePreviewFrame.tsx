import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * The live (backend-served) app preview iframe.
 *
 * Previously the iframe rendered the moment a ticket URL existed, so while the
 * dev server was still spinning up — or serving a stale empty build — the user
 * stared at a blank white frame under a banner claiming "your running app is
 * shown below". This wrapper keeps an honest "Preparing your preview…"
 * overlay up until the frame actually fires onLoad for the current URL, and
 * says so plainly if it takes a while.
 */
export default function LivePreviewFrame({ projectId, liveUrl }: { projectId: string; liveUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSlow(true), 25000);
    return () => clearTimeout(timer.current);
  }, [liveUrl]);

  return (
    <div className="live-preview-frame">
      <iframe
        key={`live-preview-${projectId}-${liveUrl}`}
        src={liveUrl}
        sandbox="allow-scripts allow-forms allow-popups allow-same-origin allow-modals allow-downloads"
        onLoad={() => { clearTimeout(timer.current); setLoaded(true); }}
        title="Live App Preview"
      />
      {!loaded && (
        <div className="live-preview-preparing" role="status" aria-live="polite">
          <Loader2 className="lucide-spin" size={22} aria-hidden="true" />
          <strong>Preparing your preview…</strong>
          <span>{slow ? 'Still working on it — you can keep chatting while it loads.' : 'Starting the app server and loading your latest version.'}</span>
        </div>
      )}
    </div>
  );
}
