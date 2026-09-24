import { createRoot } from 'react-dom/client';
import { PreviewRunner } from './components/PreviewRunner';
import { createPreviewStorage } from './lib/preview-storage';

const root = document.getElementById('root');
const data = document.getElementById('preview-data');
if (root && data) {
  let isolated = false;
  try { isolated = window.origin === 'null'; } catch {}
  if (!isolated) {
    root.textContent = 'Preview refused: an isolated execution origin is required.';
  } else {
    Object.defineProperty(window, 'localStorage', { value: createPreviewStorage() });
    Object.defineProperty(window, 'sessionStorage', { value: createPreviewStorage() });
    const { projectId, files } = JSON.parse(data.textContent || '{}');
    createRoot(root).render(<PreviewRunner projectId={projectId} initialFiles={files} />);
  }
}
