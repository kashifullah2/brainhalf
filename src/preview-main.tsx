import { createRoot } from 'react-dom/client';
import { PreviewRunner } from './components/PreviewRunner';
import { createPreviewStorage } from './lib/preview-storage';

type PreviewPayload = { projectId: string; files: Record<string, string> };

function showFatal(root: HTMLElement, message: string): void {
  root.textContent = message;
}

/** Parses the embedded payload without letting bad JSON blank the whole preview. */
function readPayload(data: HTMLElement): PreviewPayload | null {
  try {
    const parsed = JSON.parse(data.textContent || '{}') as Partial<PreviewPayload> | null;
    if (!parsed || typeof parsed.projectId !== 'string' || !parsed.projectId) return null;
    const files = parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files) ? parsed.files : {};
    return { projectId: parsed.projectId, files };
  } catch {
    return null;
  }
}

/**
 * Replaces a storage object. Defining the property can fail in some sandboxes;
 * that must be reported, not leave the app talking to the browser's real storage.
 */
function installStorage(name: 'localStorage' | 'sessionStorage'): boolean {
  try {
    Object.defineProperty(window, name, { value: createPreviewStorage(), configurable: true });
    return true;
  } catch {
    return false;
  }
}

const root = document.getElementById('root');
const data = document.getElementById('preview-data');
if (root && data) {
  let isolated = false;
  try { isolated = window.origin === 'null'; } catch { /* cross-origin access throws: treat as not isolated */ }
  if (!isolated) {
    showFatal(root, 'Preview refused: an isolated execution origin is required.');
  } else if (!installStorage('localStorage') || !installStorage('sessionStorage')) {
    showFatal(root, 'Preview refused: could not isolate browser storage.');
  } else {
    const payload = readPayload(data);
    if (!payload) {
      showFatal(root, 'Preview data is missing or corrupted. Reload the preview.');
    } else {
      try {
        createRoot(root).render(<PreviewRunner projectId={payload.projectId} initialFiles={payload.files} />);
      } catch (error) {
        showFatal(root, `Preview failed to start: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
