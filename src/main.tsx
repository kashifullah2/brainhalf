import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { PreviewRunner } from './components/PreviewRunner'
import { ErrorBoundary } from './components/ErrorBoundary'

// Anti-Recursion & Preview Frame Detector:
// If running inside an iframe (window.self !== window.top) or at a /preview route,
// NEVER render the BrainHalf IDE! Render the isolated application preview runner instead.
const isPreviewFrame = typeof window !== 'undefined' && (
  window.self !== window.top ||
  window.location.pathname.startsWith('/preview') ||
  window.location.pathname === '/hero-preview.html'
);

if (isPreviewFrame) {
  const pathMatch = window.location.pathname.match(/\/preview\/([^/]+)/);
  // A bare /preview with no id is a malformed URL. Do NOT fall back to a
  // hard-coded 'default' id here: that id is shared by every visitor, so this
  // frame would render a stranger's project (or claim it). An empty id makes
  // PreviewRunner ask the parent for files it will not get, which is the
  // honest outcome for a URL that was never valid.
  const projectId = pathMatch ? pathMatch[1] : (new URLSearchParams(window.location.search).get('project') || '');

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PreviewRunner projectId={projectId} />
    </StrictMode>
  );
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
