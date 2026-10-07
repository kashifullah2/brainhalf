import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Copy, Loader2 } from 'lucide-react';
import { authFetch, getToken } from '../lib/auth-client';
import { apiOrigin } from '../lib/api-origin';
import { safeCatch } from '../lib/safe-catch';
import type { GalleryApp } from '../lib/gallery-types';
import { findPublicPage, formatContentDate } from '../seo/content';
import BrainHalfLogo from './BrainHalfLogo';
import SiteHeaderActions from './SiteHeaderActions';
import MobileNav from './MobileNav';
import LandingFooter from './landing/LandingFooter';
import './GalleryPage.css';
import './PublicPage.css';

// Native iframe dimensions — the app is rendered at this size then CSS-scaled down.
const IFRAME_W = 960;
const IFRAME_H = 600;

function previewGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `linear-gradient(135deg, hsl(${h} 45% 52%), hsl(${(h + 40) % 360} 55% 38%))`;
}

// Full-width live preview: IntersectionObserver triggers the iframe load;
// ResizeObserver keeps the scale correct as the grid column resizes.
function CardPreview({ appId, appName }: { appId: string; appName: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3125);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const computeScale = () => setScale(el.offsetWidth / IFRAME_W);
    computeScale();
    const ro = new ResizeObserver(computeScale);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || phase !== 'idle') return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setPhase('loading'); io.disconnect(); } },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setTimeout(() => setPhase('failed'), 12_000);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <div
      ref={wrapRef}
      className="gallery-card-preview"
      style={{ height: Math.round(IFRAME_H * scale) }}
      aria-hidden="true"
    >
      <div className="gallery-card-preview-bg" style={{ background: previewGradient(appId) }}>
        <span className="gallery-card-preview-initial">{appName.trim().charAt(0).toUpperCase()}</span>
      </div>
      {(phase === 'loading' || phase === 'ready') && (
        <iframe
          src={`/p/${encodeURIComponent(appId)}/`}
          className={`gallery-card-preview-frame${phase === 'ready' ? ' is-ready' : ''}`}
          style={{ width: IFRAME_W, height: IFRAME_H, transform: `scale(${scale})` }}
          sandbox="allow-scripts allow-same-origin allow-forms"
          onLoad={() => setPhase('ready')}
          onError={() => setPhase('failed')}
          tabIndex={-1}
          title=""
        />
      )}
    </div>
  );
}

const NAV_LINKS = [
  { href: '/', label: 'AI app builder' },
  { href: '/gallery', label: 'Gallery', current: true },
  { href: '/guides/build-an-app-with-ai', label: 'Build guide' },
  { href: '/about', label: 'About' },
];

const page = findPublicPage('/gallery');

export default function GalleryPage({ initialApps = null }: { initialApps?: GalleryApp[] | null }) {
  // Builds can embed a snapshot of the published gallery so crawlers and
  // no-JS visitors see real app cards instead of a loading placeholder.
  // The effect below still refreshes the list after hydration.
  const [apps, setApps] = useState<GalleryApp[] | null>(initialApps);
  const [error, setError] = useState('');
  const [remixing, setRemixing] = useState<string | null>(null);
  const [remixError, setRemixError] = useState<Record<string, string>>({});
  // Auth controls appear only after hydration so prerendered markup matches.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiOrigin()}/api/gallery`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('The gallery could not be loaded.');
        const data = await response.json() as { apps?: unknown };
        if (!Array.isArray(data.apps)) throw new Error('The gallery could not be loaded.');
        setApps(data.apps as GalleryApp[]);
      })
      .catch(safeCatch(controller.signal, setError, 'The gallery could not be loaded.'));
    return () => controller.abort();
  }, []);
  const remix = async (id: string) => {
    if (remixing) return;
    setRemixing(id);
    setRemixError(current => ({ ...current, [id]: '' }));
    try {
      const response = await authFetch(`${apiOrigin()}/api/projects/${encodeURIComponent(id)}/remix`, { method: 'POST' });
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
        {error && apps === null && <p role="alert" className="gallery-empty">{error}</p>}
        {!error && apps === null && <p className="gallery-empty">Loading apps…</p>}
        {!error && apps !== null && apps.length === 0 && <div className="gallery-empty"><p>No apps in the gallery yet.</p><p>Publish your app and turn on “List in gallery” in the project console to feature it here.</p></div>}
        <div className="gallery-grid">
          {(apps || []).map(app => <article key={app.id} className="gallery-card">
            <CardPreview appId={app.id} appName={app.name} />
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
      {page && page.sections.length > 0 && <div className="public-body gallery-body">
        <article className="public-article" aria-label="About the gallery">
          {page.sections.map(section => <section key={section.id} id={section.id}>
            <h2>{section.title}</h2>
            {section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          </section>)}
        </article>
      </div>}
      {page && page.related.length > 0 && <section className="public-related" aria-labelledby="related-heading"><p className="studio-section-label">KEEP EXPLORING</p><h2 id="related-heading">A useful next step</h2><div>{page.related.map(relatedPath => {
        const related = findPublicPage(relatedPath);
        return related && <a href={related.path} key={relatedPath}><span>{related.category}</span><strong>{related.heading}</strong><ArrowUpRight size={18} /></a>;
      })}</div></section>}
    </main>
    <LandingFooter />
  </div>;
}
