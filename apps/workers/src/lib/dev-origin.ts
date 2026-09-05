/** True when the request originates from a local dev server (studio/web). */
export function isLocalDevOrigin(originOrReferer: string | undefined): boolean {
  if (!originOrReferer) return false;
  try {
    const url = new URL(originOrReferer);
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return true;
  } catch {
    // Referer may be a partial path — fall through to string checks.
    if (/localhost|127\.0\.0\.1/.test(originOrReferer)) return true;
  }
  return false;
}
