/**
 * The origins this deployment is served from. Shared by the Worker's CORS gate
 * and by the browser-side postMessage checks in the preview frame.
 *
 * Keeping it in its own module means the client bundle can check an origin
 * without pulling the server-side auth code in with it.
 */

export const ALLOWED_ORIGINS: readonly string[] = [
  'https://brainhalf.com',
  'https://www.brainhalf.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
];

const ALLOWED_ORIGIN_SET: ReadonlySet<string> = new Set(ALLOWED_ORIGINS);

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_SET.has(origin);
}
