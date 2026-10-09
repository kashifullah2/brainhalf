/**
 * The origins this deployment is served from. Shared by the Worker's CORS gate
 * and by the browser-side postMessage checks in the preview frame.
 *
 * Keeping it in its own module means the client bundle can check an origin
 * without pulling the server-side auth code in with it.
 *
 * Localhost entries are only included when IS_DEV is truthy (set by wrangler dev
 * via the [vars] block or .dev.vars). Production deployments never reflect
 * localhost origins, which would otherwise allow any server running on the
 * victim's machine to make credentialed cross-origin requests to brainhalf.com.
 */

const PRODUCTION_ORIGINS: readonly string[] = [
  'https://brainhalf.com',
  'https://www.brainhalf.com',
];

const DEV_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
];

/**
 * Returns the effective allowed-origins list for the current environment.
 * Pass `isDev = true` in wrangler dev / test environments.
 */
export function allowedOrigins(isDev?: boolean): readonly string[] {
  return isDev ? [...PRODUCTION_ORIGINS, ...DEV_ORIGINS] : PRODUCTION_ORIGINS;
}

/**
 * Backwards-compatible flat export — includes localhost so existing Worker
 * code that passes this list directly continues to work. The Worker's
 * `isAllowedOrigin()` call below is the correct gate in all cases.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  ...PRODUCTION_ORIGINS,
  ...DEV_ORIGINS,
];

/**
 * Gate function used by the Worker. Checks the request-time origin against
 * the environment-appropriate allowlist so localhost origins are never
 * reflected in production responses even though they appear in ALLOWED_ORIGINS.
 *
 * `env` should be the Worker's environment object; pass `undefined` to use
 * the full list (e.g. in tests or the Vite dev server).
 */
export function isAllowedOrigin(origin: string | null | undefined, env?: { IS_DEV?: unknown }): boolean {
  if (!origin) return false;
  const dev = env?.IS_DEV === true || env?.IS_DEV === 'true';
  return allowedOrigins(dev).includes(origin);
}
