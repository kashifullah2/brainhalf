import { StrictMode, lazy, Suspense } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import './index.css';
import './styles/studio-fonts.css';
import App from './App';
import './styles/studio-theme.css';
import PublicPage from './components/PublicPage';
import GalleryPage from './components/GalleryPage';
// /admin is an operator tool: never prerendered, never indexed. Splitting it
// keeps its code out of every public page's initial bundle.
const AdminPage = lazy(() => import('./components/AdminPage'));
import { ACCOUNT_PAGES, findPublicPage } from './seo/content';
import AccountPage from './components/AccountPage';
import { pageMetadata, isPrivateSearch } from './seo/metadata';
import { getToken } from './lib/auth-client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeAnalytics } from './lib/analytics';
import type { GalleryApp } from './lib/gallery-types';

// The prerendered /gallery page embeds its app snapshot in <head> so hydration
// renders the same cards the crawler saw; the live list refreshes after mount.
function prerenderedGalleryApps(): GalleryApp[] | null {
  try {
    const text = document.getElementById('gallery-apps-data')?.textContent;
    if (!text) return null;
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed as GalleryApp[] : null;
  } catch {
    return null;
  }
}

// Reload when Vite can't load a dynamic import chunk (stale tab after deploy).
// The sessionStorage guard (timestamp-based, expires after 60 s) prevents
// infinite reload loops when a chunk is genuinely absent from the new build.
// During an active generation the reload is deferred: App.tsx listens for the
// 'bh-needs-chunk-reload' event, shows a banner, and reloads when safe.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const EXPIRY_MS = 60_000;
  const stored = sessionStorage.getItem('bh_chunk_reload');
  if (stored && Date.now() - Number(stored) < EXPIRY_MS) return;
  sessionStorage.setItem('bh_chunk_reload', String(Date.now()));
  if ((window as any).__bh_generating) {
    window.dispatchEvent(new CustomEvent('bh-needs-chunk-reload'));
    return;
  }
  window.location.reload();
});

const root = document.getElementById('root');
if (root && window.self === window.top && !/^\/(preview|p)(\/|$)/.test(window.location.pathname)) {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const home = path === '/' || path === '/index.html';
  const appRoute = home || path === '/dashboard';
  const content = appRoute ? <App /> : path === '/gallery' ? <GalleryPage initialApps={prerenderedGalleryApps()} /> : path === '/admin' ? <Suspense fallback={null}><AdminPage /></Suspense> : ACCOUNT_PAGES[path] ? <AccountPage path={path} /> : <PublicPage page={findPublicPage(path)} />;
  const tree = <StrictMode><ErrorBoundary>{content}</ErrorBoundary></StrictMode>;
  // /admin is an operator tool: never indexed, never canonicalized.
  const meta = path === '/admin' ? null : pageMetadata(home ? '/' : path);
  document.title = path === '/admin' ? 'Admin | BrainHalf' : meta!.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', meta?.description || 'BrainHalf operator console.');
  document.querySelector('meta[name="robots"]')?.setAttribute('content', path === '/admin' || isPrivateSearch(window.location.search) ? 'noindex, nofollow' : meta!.robots);
  const canonical = document.querySelector('link[rel="canonical"]');
  if (meta?.canonical) canonical?.setAttribute('href', meta.canonical);
  else canonical?.remove();
  initializeAnalytics();
  // Anonymous visitors hydrate the exact public markup generated at build time.
  // Sessions and private URLs start fresh so no account state is prerendered.
  // The path guard is the safety net: if a route is ever served the wrong
  // prerendered HTML (as /admin was, via the landing page), hydrateRoot would
  // throw React #418 — fall back to a fresh client render instead.
  const prerenderedPath = root.dataset.prerenderPath;
  const matchesServedPage = root.dataset.prerendered === 'true' && prerenderedPath === (home ? '/' : path);
  if (matchesServedPage && (!appRoute || (home && !getToken() && !isPrivateSearch(window.location.search)))) {
    hydrateRoot(root, tree);
  } else {
    createRoot(root).render(tree);
  }
} else if (root) {
  root.textContent = 'This route requires the isolated preview service.';
}
