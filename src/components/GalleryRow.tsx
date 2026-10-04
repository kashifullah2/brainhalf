import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { apiOrigin } from '../lib/api-origin';
import { safeCatch } from '../lib/safe-catch';
import type { GalleryApp } from '../lib/gallery-types';
import './GalleryRow.css';

/** Deterministic, honest thumbnail: a gradient picked from the app id plus its initial. No stock imagery. */
function thumbHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

function GalleryCard({ app }: { app: GalleryApp }) {
  const hue = thumbHue(app.id);
  const initial = (app.name.trim().charAt(0) || 'A').toUpperCase();
  return (
    <a
      className="gallery-row-card"
      href={`/p/${encodeURIComponent(app.id)}/`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${app.name} in a new tab`}
    >
      <span
        className="gallery-row-thumb"
        aria-hidden="true"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 45% 52%), hsl(${(hue + 40) % 360} 55% 38%))` }}
      >
        <span className="gallery-row-thumb-initial">{initial}</span>
        <span className="gallery-row-thumb-dots"><i /><i /><i /></span>
      </span>
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

export const GalleryRow: React.FC = () => {
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

  return (
    <section className="gallery-row-section" aria-labelledby="gallery-row-heading">
      <div className="landing-section-intro gallery-row-intro">
        <div>
          <p className="landing-kicker">From the gallery</p>
          <h2 id="gallery-row-heading">Built by people like you.</h2>
          <p className="landing-section-lede">Real apps, published by their owners. Open one — every button does something.</p>
        </div>
        <div className="gallery-row-controls">
          <button type="button" onClick={() => scrollBy(-1)} aria-label="Scroll gallery backwards"><ArrowLeft size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => scrollBy(1)} aria-label="Scroll gallery forwards"><ArrowRight size={16} aria-hidden="true" /></button>
        </div>
      </div>

      {error && <p className="gallery-row-error" role="alert">{error}</p>}

      {!error && apps === null && (
        <div className="gallery-row-scroller" aria-hidden="true">
          {[0, 1, 2].map(index => <span key={index} className="gallery-row-skeleton" />)}
        </div>
      )}

      {!error && apps !== null && apps.length === 0 && (
        <p className="gallery-row-empty">
          Nothing listed yet. <a href="/gallery">Be the first to publish an app to the gallery.</a>
        </p>
      )}

      {!error && apps !== null && apps.length > 0 && (
        <div className="gallery-row-scroller" ref={scrollerRef} role="region" aria-label="Public gallery apps" tabIndex={0}>
          {apps.slice(0, 12).map(app => <GalleryCard key={app.id} app={app} />)}
        </div>
      )}
    </section>
  );
};

export default GalleryRow;
