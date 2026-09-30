import { useEffect, useState } from 'react';
import { ArrowUpRight, Copy, Loader2 } from 'lucide-react';
import { authFetch, getToken } from '../lib/auth-client';
import { findPublicPage, formatContentDate } from '../seo/content';
import BrainHalfLogo from './BrainHalfLogo';
import SiteHeaderActions from './SiteHeaderActions';
import MobileNav from './MobileNav';
import './GalleryPage.css';

interface GalleryApp { id: string; name: string; description: string; remixCount: number; showcasedAt: number | null }

const NAV_LINKS = [
  { href: '/', label: 'AI app builder' },
  { href: '/gallery', label: 'Gallery', current: true },
  { href: '/guides/build-an-app-with-ai', label: 'Build guide' },
  { href: '/about', label: 'About' },
];

const page = findPublicPage('/gallery');

export default function GalleryPage() {
  const [apps, setApps] = useState<GalleryApp[] | null>(null);
  const [error, setError] = useState('');
  const [remixing, setRemixing] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<Record<string, string>>({});
  // Auth controls appear only after hydration so prerendered markup matches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const controller = new AbortController();
    const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';
    fetch(`${origin}/api/gallery`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('The gallery could not be loaded.');
        const data = await response.json() as { apps?: unknown };
        if (!Array.isArray(data.apps)) throw new Error('The gallery could not be loaded.');
        setApps(data.apps as GalleryApp[]);
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The gallery could not be loaded.'); });
    return () => controller.abort();
  }, []);
  const remix = async (id: string) => {
    if (remixing) return;
    setRemixing(id);
    setRemixError(current => ({ ...current, [id]: '' }));
    try {
      const origin = ['localhost', '127.0.0.1'].includes(location.hostname) ? import.meta.env.VITE_BACKEND_HOST || '' : '';
      const response = await authFetch(`${origin}/api/projects/${encodeURIComponent(id)}/remix`, { method: 'POST' });
      const data = await response.json() as { projectId?: string; error?: string };
      if (!response.ok || !data.projectId) throw new Error(data.error || 'Remix could not be completed.');
      window.location.assign(`/?project=${encodeURIComponent(data.projectId)}`);
    } catch (cause) {
      setRemixError(current => ({ ...current, [id]: cause instanceof Error ? cause.message : 'Remix could not be completed.' }));
      setRemixing(null);
    }
  };
  return <div className="landing-container gallery-page">
    <a href="#main-content" className="studio-skip-link">Skip to content</a>
    <header className="landing-header">
      <a className="landing-brand-group" href="/" aria-label="BrainHalf home"><span className="landing-brand-logo"><BrainHalfLogo size={27} color="currentColor" /></span><span className="landing-brand-text">BrainHalf</span></a>
      <nav className="studio-navigation" aria-label="Main navigation"><a href="/">AI app builder</a><a href="/gallery" aria-current="page">Gallery</a><a href="/guides/build-an-app-with-ai">Build guide</a><a href="/about">About</a></nav>
      <div className="landing-header-right"><MobileNav links={NAV_LINKS} /><SiteHeaderActions /></div>
    </header>
    <main className="landing-main-content" id="main-content">
      <div className="public-intro gallery-intro">
        <p className="studio-section-label">{page?.category || 'Gallery'}</p>
        <h1>{page?.heading || 'Apps built with BrainHalf'}</h1>
        <p className="public-summary">{page?.summary || 'Explore published apps. Open any of them live, or remix one into your own workspace and change it with a prompt.'}</p>
        {page && <div className="public-content-meta"><span>Updated <time dateTime={page.dateModified}>{formatContentDate(page.dateModified)}</time></span></div>}
      </div>
      <section className="gallery-grid-section" aria-label="Showcased apps">
        {error && <p role="alert" className="gallery-empty">{error}</p>}
        {!error && apps === null && <p className="gallery-empty">Loading apps…</p>}
        {!error && apps !== null && apps.length === 0 && <div className="gallery-empty"><p>No apps in the gallery yet.</p><p>Publish your app and turn on “List in gallery” in the project console to feature it here.</p></div>}
        <div className="gallery-grid">
          {(apps || []).map(app => <article key={app.id} className="gallery-card">
            <h2>{app.name}</h2>
            <p className="gallery-card-description">{app.description || 'An app built with BrainHalf.'}</p>
            <p className="gallery-card-meta">{app.remixCount === 1 ? '1 remix' : `${app.remixCount} remixes`}</p>
            {remixError[app.id] && <p role="alert" className="gallery-card-error">{remixError[app.id]}</p>}
            <div className="gallery-card-actions">
              <a className="gallery-open" href={`/p/${encodeURIComponent(app.id)}/`} target="_blank" rel="noopener noreferrer">Open app <ArrowUpRight size={14} /></a>
              {mounted && getToken()
                ? <button className="gallery-remix" disabled={remixing !== null} onClick={() => void remix(app.id)}>{remixing === app.id ? <Loader2 size={14} className="gallery-spin" /> : <Copy size={14} />} Remix</button>
                : <a className="gallery-remix" href="/#start-building">Sign in to remix</a>}
            </div>
          </article>)}
        </div>
      </section>
    </main>
  </div>;
}
