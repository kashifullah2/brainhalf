// Retired: legacy manifests cannot reactivate the temporary API emulator.
export function usesSimulatedApi(_files: Record<string, string>): boolean {
  return false;
}

export function setSimulatedApi(files: Record<string, string>, enabled: boolean): Record<string, string> {
  const path = 'package.json' in files ? 'package.json' : '/package.json';
  const manifest = JSON.parse(files[path] ?? '{"private":true}');
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('package.json must contain an object. Fix it before changing preview mode.');
  const previous = manifest.brainhalf;
  if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) throw new Error('The brainhalf package setting must be an object. Existing settings were preserved.');
  return { ...files, [path]: JSON.stringify({ ...manifest, brainhalf: { ...previous, previewApi: enabled ? 'simulated' : 'disabled' } }, null, 2) + '\n' };
}

export const BACKEND_NOT_RUNNING = 'The backend is not running in design preview mode. Start the app preview to connect.';
