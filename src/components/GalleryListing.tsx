import { useEffect, useState } from 'react';
import { Globe2 } from 'lucide-react';
import { authFetch, projectPublication } from '../lib/auth-client';
import { apiOrigin } from '../lib/api-origin';
import { safeCatch } from '../lib/safe-catch';

interface ShowcaseState { showcase: boolean; description: string; remixCount: number }

/** Lets the owner list a published app in the public gallery, or remove it. */
export default function GalleryListing({ projectId, productionUrl }: { projectId: string; productionUrl?: string }) {
  const [state, setState] = useState<ShowcaseState | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  // null = unknown (fail open; the backend 409 still guards the submit).
  const [published, setPublished] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void authFetch(`${apiOrigin()}/api/projects/${encodeURIComponent(projectId)}/showcase`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(data?.error || 'Gallery listing state could not be loaded.');
        }
        const data = await response.json() as ShowcaseState;
        setState(data);
        setDescription(data.description);
      })
      .catch(safeCatch(controller.signal, setNotice, 'Gallery listing state could not be loaded.'));
    return () => controller.abort();
  }, [projectId]);
  // The gallery links to the live app, so listing is only offered once the
  // app is published. The backend 409 on PUT is the backstop; this disables
  // the button up front with a one-line reason instead of an after-the-fact error.
  useEffect(() => {
    const controller = new AbortController();
    projectPublication(projectId, controller.signal)
      .then(setPublished)
      .catch(() => { if (!controller.signal.aborted) setPublished(null); });
    return () => controller.abort();
  }, [projectId]);
  const save = async (showcase: boolean) => {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      const response = await authFetch(`${apiOrigin()}/api/projects/${encodeURIComponent(projectId)}/showcase`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showcase, description, ...(showcase && productionUrl ? { productionUrl } : {}) }),
      });
      const data = await response.json() as ShowcaseState & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Gallery listing could not be saved.');
      setState(data); setDescription(data.description);
      setNotice(showcase ? 'Your app is listed in the gallery. Anyone can open it and remix a copy.' : 'Removed from the gallery. Existing remixes stay with their owners.');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Gallery listing could not be saved.'); }
    finally { setBusy(false); }
  };
  return <section className="settings-card" aria-labelledby="gallery-listing-title">
    <h3 id="gallery-listing-title"><Globe2 size={18} />Gallery</h3>
    {state === null
      ? <p className="settings-muted">{notice || 'Loading gallery listing…'}</p>
      : <>
        <p>{state.showcase
          ? <>Your app is in the <a href="/gallery" target="_blank" rel="noopener noreferrer">public gallery</a> — visitors can open it and remix a copy into their own account. {state.remixCount === 1 ? '1 remix so far.' : `${state.remixCount} remixes so far.`}</>
          : 'List your live app in the public gallery so others can open it and remix a copy. Secrets and environment files are never shared.'}</p>
        <form className="settings-integration" onSubmit={event => { event.preventDefault(); void save(true); }}>
          <fieldset disabled={busy}>
            <label>Gallery description<textarea rows={2} maxLength={280} placeholder="What does your app do?" value={description} onChange={event => setDescription(event.target.value)} /></label>
            <div className="settings-actions">
              <button type="submit" disabled={published === false && !state.showcase}>{state.showcase ? 'Save description' : 'List in gallery'}</button>
              {state.showcase && <button type="button" onClick={() => void save(false)}>Remove from gallery</button>}
            </div>
            {published === false && !state.showcase && (
              <p className="settings-muted">Publish your app first — the gallery links to the live app.</p>
            )}
          </fieldset>
        </form>
        {notice && <p role="status">{notice}</p>}
      </>}
  </section>;
}
