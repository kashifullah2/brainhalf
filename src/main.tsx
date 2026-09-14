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
  const projectId = pathMatch ? pathMatch[1] : (new URLSearchParams(window.location.search).get('project') || 'default');

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
