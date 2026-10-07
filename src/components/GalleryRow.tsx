import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, CalendarCheck, Check, ClipboardList, Package, Users } from 'lucide-react';

// Deterministic hue from id for gradient fallback
function thumbHueRow(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

// Lazy iframe preview: loads only when the card scrolls into view.
// Falls back to gradient if the app fails or takes too long.
function RowPreview({ appId, appName }: { appId: string; appName: string }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const hue = thumbHueRow(appId);
  const initial = (appName.trim().charAt(0) || 'A').toUpperCase();

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setPhase('loading'); io.disconnect(); } },
      { rootMargin: '200px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 12 s timeout: if the tenant worker is offline, fall back to gradient
  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setTimeout(() => setPhase('failed'), 12_000);
    return () => clearTimeout(t);
  }, [phase]);

  const gradient = `linear-gradient(135deg, hsl(${hue} 45% 52%), hsl(${(hue + 40) % 360} 55% 38%))`;

  return (
    <span ref={wrapRef} className="gallery-row-thumb gallery-row-preview" aria-hidden="true">
      {/* Gradient fallback — visible while loading and on failure */}
      <span className="gallery-row-preview-bg" style={{ background: gradient }}>
        <span className="gallery-row-thumb-initial">{initial}</span>
        <span className="gallery-row-thumb-dots"><i /><i /><i /></span>
      </span>
      {/* Live iframe — fades in when loaded */}
      {(phase === 'loading' || phase === 'ready') && (
        <iframe
          src={`https://${encodeURIComponent(appId)}.apps.brainhalf.com`}
          className={`gallery-row-preview-frame${phase === 'ready' ? ' is-ready' : ''}`}
          sandbox="allow-scripts allow-same-origin allow-forms"
          onLoad={() => setPhase('ready')}
          onError={() => setPhase('failed')}
          tabIndex={-1}
          title=""
        />
      )}
    </span>
  );
}
import { apiOrigin } from '../lib/api-origin';
import { safeCatch } from '../lib/safe-catch';
import type { GalleryApp } from '../lib/gallery-types';
import { BUSINESS_APPS } from '../lib/business-apps';
import './GalleryRow.css';

/**
 * When nobody has listed an app yet, the section still has a job: show honest
 * starting points (labelled as example ideas, never as real customer apps)
 * whose one click drops a complete, realistic prompt into the hero composer.
 */
const EXAMPLE_IDS = ['inventory', 'booking', 'crm', 'tasks'] as const;
const EXAMPLE_IDEAS = EXAMPLE_IDS.map(id => BUSINESS_APPS.find(app => app.id === id)!).filter(Boolean);
const EXAMPLE_ICONS = { inventory: Package, booking: CalendarCheck, crm: Users, tasks: ClipboardList } as const;

function ExamplePreview({ id }: { id: (typeof EXAMPLE_IDS)[number] }) {
  if (id === 'inventory') {
    return (
      <span className="idea-preview" aria-hidden="true">
        <span className="idea-row"><i className="idea-cell idea-cell-name" /><i className="idea-pill" /></span>
        <span className="idea-row"><i className="idea-cell idea-cell-name short" /><i className="idea-pill idea-pill-warn" /></span>
        <span className="idea-row"><i className="idea-cell idea-cell-name" /><i className="idea-pill" /></span>
      </span>
    );
  }
  if (id === 'booking') {
    return (
      <span className="idea-preview idea-preview-slots" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map(slot => <i key={slot} className={`idea-slot${slot === 1 || slot === 3 ? ' is-taken' : ''}`} />)}
      </span>
    );
  }
  if (id === 'crm') {
    return (
      <span className="idea-preview" aria-hidden="true">
        <span className="idea-row"><i className="idea-avatar" /><i className="idea-cell idea-cell-name" /><i className="idea-dot" /></span>
        <span className="idea-row"><i className="idea-avatar" /><i className="idea-cell idea-cell-name short" /><i className="idea-dot idea-dot-won" /></span>
        <span className="idea-row"><i className="idea-avatar" /><i className="idea-cell idea-cell-name" /><i className="idea-dot" /></span>
      </span>
    );
  }
  return (
    <span className="idea-preview" aria-hidden="true">
      <span className="idea-row"><i className="idea-check is-done"><Check size={10} strokeWidth={3.5} /></i><i className="idea-cell idea-cell-name is-done" /></span>
      <span className="idea-row"><i className="idea-check" /><i className="idea-cell idea-cell-name short" /></span>
      <span className="idea-row"><i className="idea-check" /><i className="idea-cell idea-cell-name" /></span>
    </span>
  );
}

function GalleryCard({ app }: { app: GalleryApp }) {
  return (
    <a
      className="gallery-row-card"
      href={`https://${encodeURIComponent(app.id)}.apps.brainhalf.com`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${app.name} in a new tab`}
    >
      <RowPreview appId={app.id} appName={app.name} />
      <span className="gallery-row-card-body">
        <strong>{app.name || 'Untitled app'}</strong>
        {app.description ? <small>{app.description}</small> : null}
        <span className="gallery-row-meta">
          {app.remixCount > 0 ? `${app.remixCount} ${app.remixCount === 1 ? 'remix' : 'remixes'}` : 'New in the gallery'}
          <ArrowUpRight size={13} aria-hidden="true" />
        </span>
      </span>
    </a>
  );
}

export const GalleryRow: React.FC<{ onUseIdea?: (prompt: string) => void }> = ({ onUseIdea }) => {
  const [apps, setApps] = useState<GalleryApp[] | null>(null);
  const [error, setError] = useState('');
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiOrigin()}/api/gallery`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('The gallery could not be loaded.');
        const data = (await response.json()) as { apps?: unknown };
        if (!Array.isArray(data.apps)) throw new Error('The gallery could not be loaded.');
        setApps(data.apps as GalleryApp[]);
      })
      .catch(safeCatch(controller.signal, setError, 'The gallery could not be loaded.'));
    return () => controller.abort();
  }, []);

  const scrollBy = (direction: 1 | -1) => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollerRef.current?.scrollBy({ left: direction * 320, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const hasRealApps = !error && apps !== null && apps.length > 0;
  const showExamples = !error && apps !== null && apps.length === 0;

  return (
    <section className="gallery-row-section" aria-labelledby="gallery-row-heading">
      <div className="landing-section-intro gallery-row-intro">
        <div>
          <p className="landing-kicker">{showExamples ? 'Start from an idea' : 'From the gallery'}</p>
          <h2 id="gallery-row-heading">{showExamples ? 'Describe it. BrainHalf builds it.' : 'Built by people like you.'}</h2>
          <p className="landing-section-lede">
            {showExamples
              ? 'Pick a starting point — the words land in the box above, ready to make yours.'
              : 'Real apps, published by their owners. Open one — every button does something.'}
          </p>
        </div>
        {hasRealApps && (
          <div className="gallery-row-controls">
            <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll gallery backwards"><ArrowLeft size={16} aria-hidden="true" /></button>
            <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll gallery forwards"><ArrowRight size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>

      {error && <p className="gallery-row-error" role="alert">{error}</p>}

      {!error && apps === null && (
        <div className="gallery-row-scroller" aria-hidden="true">
          {[0, 1, 2].map(index => <span key={index} className="gallery-row-skeleton" />)}
        </div>
      )}

      {showExamples && (
        <div className="idea-grid">
          {EXAMPLE_IDEAS.map(idea => {
            const Icon = EXAMPLE_ICONS[idea.id as (typeof EXAMPLE_IDS)[number]] ?? Package;
            return (
              <button
                key={idea.id}
                type="button"
                className="idea-card"
                onClick={() => onUseIdea?.(idea.prompt)}
                aria-label={`Use this idea: ${idea.label}. Fills the app description box.`}
              >
                <span className="idea-badge"><Icon size={12} aria-hidden="true" /> Example idea</span>
                <ExamplePreview id={idea.id as (typeof EXAMPLE_IDS)[number]} />
                <span className="idea-body">
                  <strong>{idea.label}</strong>
                  <small>{idea.detail}</small>
                  <span className="idea-cta">Use this idea <ArrowRight size={13} aria-hidden="true" /></span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {hasRealApps && (
        <div className="gallery-row-scroller" ref={scrollerRef} role="region" aria-label="Public gallery apps" tabIndex={0}>
          {apps.slice(0, 12).map(app => <GalleryCard key={app.id} app={app} />)}
        </div>
      )}
    </section>
  );
};

export default GalleryRow;
