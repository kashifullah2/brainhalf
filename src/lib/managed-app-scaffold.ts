import { needsBackend } from './generation-target';
import { addWorkersBackend } from './workers-starter';
import { createTypeScriptStarter } from './project-starters';
import { publicationTarget } from '../runtime/publication';

/** Prepare a real buildable backend before the generator customizes the requested app. */
export function managedAppScaffold(prompt: string, files: Record<string, string>, target: 'managed' | 'export'): Record<string, string> {
  if (target !== 'managed' || !needsBackend(prompt, files)) return files;
  const baseline = Object.keys(files).length ? files : createTypeScriptStarter();
  // Existing server architectures must be adapted deliberately, never overwritten.
  try {
    if (publicationTarget(baseline) !== 'static') return files;
    return addWorkersBackend(baseline);
  } catch { return files; }
}
