/**
 * Same-origin API path helper.
 *
 * Resolved against the deployment base so the app keeps working when hosted
 * under a sub-path (BASE_PATH=/foo/).
 */
const BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL.slice(0, -1)
  : import.meta.env.BASE_URL;

export function apiUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}/api${suffix}`;
}
