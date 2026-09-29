import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import './index.css';
import './styles/studio-fonts.css';
import App from './App';
import './styles/studio-theme.css';
import PublicPage from './components/PublicPage';
import GalleryPage from './components/GalleryPage';
import AdminPage from './components/AdminPage';
import { ACCOUNT_PAGES, findPublicPage } from './seo/content';
import AccountPage from './components/AccountPage';
import { pageMetadata, isPrivateSearch } from './seo/metadata';
import { getToken } from './lib/auth-client';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeAnalytics } from './lib/analytics';

const root = document.getElementById('root');
if (root && window.self === window.top && !/^\/(preview|p)(\/|$)/.test(window.location.pathname)) {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const home = path === '/' || path === '/index.html';
  const appRoute = home || path === '/dashboard';
  const content = appRoute ? <App /> : path === '/gallery' ? <GalleryPage /> : path === '/admin' ? <AdminPage /> : ACCOUNT_PAGES[path] ? <AccountPage path={path} /> : <PublicPage page={findPublicPage(path)} />;
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
  if (root.dataset.prerendered === 'true' && (!appRoute || (home && !getToken() && !isPrivateSearch(window.location.search)))) {
    hydrateRoot(root, tree);
  } else {
    createRoot(root).render(tree);
  }
} else if (root) {
  root.textContent = 'This route requires the isolated preview service.';
}
