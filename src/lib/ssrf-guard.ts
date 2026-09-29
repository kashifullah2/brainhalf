/**
 * SSRF guard for model-controlled outbound fetches (the `fetch_api` tool).
 *
 * The model supplies an arbitrary URL; this module validates it before any
 * request is made:
 * - only http/https schemes (no file:, ftp:, data:, etc.)
 * - no embedded credentials (user:pass@host)
 * - blocks loopback / private / link-local / CGNAT literal IPs (v4 and v6,
 *   including IPv4-mapped v6 forms — the WHATWG URL parser normalizes hex,
 *   octal and single-integer obfuscations to dotted decimal for us)
 * - blocks well-known cloud metadata hostnames
 * - follows redirects manually (max 3), validating every hop
 * - caps response size and enforces a request timeout
 *
 * Residual limitation: a hostname that *resolves* to a private IP (plain
 * DNS rebinding or an attacker-controlled domain) cannot be checked here —
 * Workers have no DNS lookup API. Literal IPs and the metadata endpoints,
 * which cover the practical SSRF surface, are blocked.
 */

export interface SafeFetchResult {
  status: number;
  finalUrl: string;
  text: string;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
  'instance-data-compute',
  '169.254.169.254', // also caught by the link-local check; listed for clarity
]);

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB — tool responses are sliced smaller anyway

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const octets = [a, b, Number(m[3]), Number(m[4])];
  if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  return (
    a === 10 || // 10.0.0.0/8
    a === 127 || // 127.0.0.0/8 loopback
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local (cloud metadata)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
    a === 0 // 0.0.0.0/8
  );
}

function isBlockedIPv6(host: string): boolean {
  const h = host.toLowerCase();
  // IPv4-mapped / translated forms embed a dotted quad at the tail.
  const v4Tail = h.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4Tail && isPrivateIPv4(v4Tail[1])) return true;
  // IPv4-mapped addresses (::ffff:0:0/96). URL parsers may normalize the
  // embedded quad to hex (::ffff:127.0.0.1 -> ::ffff:7f00:1), so decode the
  // last 32 bits and check them as IPv4.
  const mapped = h.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    let v4: string | null = null;
    const dotted = tail.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (dotted) {
      v4 = dotted[1];
    } else {
      const parts = tail.split(':').filter((p) => p.length > 0);
      if (parts.length >= 2) {
        const hi = parseInt(parts[parts.length - 2], 16);
        const lo = parseInt(parts[parts.length - 1], 16);
        if ([hi, lo].every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff)) {
          v4 = `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
        }
      }
    }
    if (v4) return isPrivateIPv4(v4); // public mapped == public IPv4: allowed
  }
  return (
    h === '::1' || // loopback
    h === '::' || // unspecified
    h.startsWith('fe80:') || // link-local
    h.startsWith('fc00:') || // unique-local
    h.startsWith('fd00:') // unique-local
  );
}

/**
 * Validates a model-supplied URL. Returns the parsed URL on success, throws
 * an Error describing why it was rejected otherwise.
 */
export function assertSafeFetchUrl(rawUrl: string): URL {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('fetch_api: URL must be a non-empty string.');
  }
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`fetch_api: invalid URL ${JSON.stringify(rawUrl.slice(0, 120))}.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`fetch_api: only http(s) URLs are allowed (got ${url.protocol}).`);
  }
  if (url.username || url.password) {
    throw new Error('fetch_api: URLs with embedded credentials are not allowed.');
  }
  // Node/Workers URL keeps IPv6 literals bracketed in .hostname — strip them
  // so literal checks below see the raw address.
  let host = url.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) throw new Error('fetch_api: URL must have a hostname.');
  if (BLOCKED_HOSTNAMES.has(host) || host === '[::1]') {
    throw new Error(`fetch_api: host "${host}" is blocked.`);
  }
  if (host.endsWith('.localhost')) {
    throw new Error(`fetch_api: host "${host}" is blocked.`);
  }
  if (host.includes(':') ? isBlockedIPv6(host) : isPrivateIPv4(host)) {
    throw new Error(`fetch_api: private/link-local IP addresses are not allowed (got "${host}").`);
  }
  return url;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetches a model-supplied URL with full SSRF validation on the initial URL
 * and on every redirect hop. Never follows redirects automatically.
 */
export async function safeFetchText(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let current = assertSafeFetchUrl(rawUrl).toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(current, { redirect: 'manual', signal: controller.signal });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') throw new Error(`fetch_api: request timed out after ${timeoutMs}ms.`);
      throw new Error(`fetch_api: request failed: ${e?.message || String(e)}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      try {
        await res.arrayBuffer();
      } catch {
        // best-effort drain; ignore
      }
      if (!location) throw new Error(`fetch_api: redirect (${res.status}) without a Location header.`);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new Error('fetch_api: redirect Location is not a valid URL.');
      }
      current = assertSafeFetchUrl(next.toString()).toString();
      continue;
    }

    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error(`fetch_api: response too large (${contentLength} bytes, limit ${maxBytes}).`);
    }
    const text = await res.text();
    if (text.length > maxBytes) {
      throw new Error(`fetch_api: response too large (limit ${maxBytes} bytes).`);
    }
    return { status: res.status, finalUrl: current, text };
  }

  throw new Error(`fetch_api: too many redirects (max ${MAX_REDIRECTS}).`);
}
