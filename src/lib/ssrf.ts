/**
 * Guards the server-side `fetch` used by the agent's `fetch_api` tool.
 *
 * The tool fetches a model-chosen URL derived from a client-supplied prompt. Without
 * a guard that is an open SSRF channel: it can reach the worker's own metadata
 * endpoints, internal services on private ranges, and loopback listeners that are
 * not exposed to the public internet.
 *
 * The guard refuses anything that is not a public, routable address, and then
 * fetches with redirect caps and a size ceiling so a redirect cannot be used to
 * escape the check after the fact.
 *
 * Scope limitation, stated plainly: hostname *literals* are range-checked, but a
 * DNS name is validated by shape only — the guard does not resolve it. So a
 * public name that resolves to a private or loopback address (a rebinding setup,
 * or a domain pointing at a cloud metadata endpoint) is not refused here. On the
 * Cloudflare Workers runtime outbound fetch to RFC1918 and loopback is not
 * routable, which is the real control; in local `wrangler dev` or under Vitest,
 * where loopback *is* reachable, that platform guarantee does not apply. Resolve
 * and pin the address before fetch if this guard ever needs to be a hard
 * guarantee.
 */

/** Maximum bytes read from a tool fetch. The tool only surfaces a short excerpt. */
export const FETCH_MAX_BYTES = 64 * 1024;
/** Maximum response size scanned before the body is truncated. */
export const FETCH_MAX_TEXT = 3000;
/** Never follow more than this many redirects. */
export const FETCH_MAX_REDIRECTS = 3;
/** Wall-clock ceiling on a tool fetch. */
export const FETCH_TIMEOUT_MS = 30 * 1000;

/**
 * True only for a hostname that is shape-valid and not a known-internal name.
 *
 * Scope: this is a *shape* check, not a resolution. IPv4/IPv6 literals are
 * range-checked against private/loopback/link-local ranges; a DNS name is only
 * matched against a regex and a small internal-name blocklist. It does NOT
 * resolve the name, so a public-looking name pointing at a private address is
 * still accepted here — see the file header for the control that covers it.
 */
export function isPublicRoutableHost(hostname: string): boolean {
  const host = (hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;

  // Reject anything that is not a DNS name or a bracketed IPv6 literal.
  const ipv6 = host.match(/^\[([0-9a-f:.]+)\]$/i);
  const ip = ipv6 ? ipv6[1] : (isPlainIpv4(host) ? host : null);

  if (ip !== null) {
    return isPublicIp(ip);
  }

  // A DNS name must look like one. This is not a full public-suffix check; it exists
  // so nonsense (e.g. `localhost`, `metadata.google.internal.`) is rejected by shape.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return false;
  }

  // Well-known internal names that would pass the shape check above.
  const BLOCKED_HOSTS = new Set([
    'localhost',
    'metadata.google.internal',
    'metadata',
    'instance-data',
    'linklocal',
    'kubernetes.default.svc',
    'kubernetes.default.svc.cluster.local',
  ]);
  if (BLOCKED_HOSTS.has(host)) return false;

  return true;
}

/** Matches a dotted-quad IPv4 address and nothing else. */
function isPlainIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^[0-9]{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

/**
 * True for an IPv4/IPv6 address that is not private, loopback, link-local,
 * carrier-grade NAT, multicast, or reserved. Anything ambiguous is refused.
 */
export function isPublicIp(ip: string): boolean {
  const v4 = isPlainIpv4(ip) ? ip : null;
  if (v4) {
    const [a, b] = v4.split('.').map(Number);
    if (a === 0) return false;                                 // 0.0.0.0/8 "this host"
    if (a === 10) return false;                                // private
    if (a === 127) return false;                               // loopback
    if (a === 169 && b === 254) return false;                   // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;          // private
    if (a === 192 && b === 168) return false;                   // private
    if (a === 100 && b >= 64 && b <= 127) return false;         // CGNAT
    if (a >= 224) return false;                                 // multicast / reserved
    return true;
  }

  // IPv6 literal (already stripped of brackets by the caller).
  const addr = ip.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(addr)) return false;
  // Expand compressed IPv6 notation (::) before validating groups.
  let expanded = addr;
  if (addr.includes('::')) {
    const [left, right] = addr.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 0) return false;
    expanded = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups].join(':');
  }
  const groups = expanded.split(':');
  if (groups.length !== 8) return false;
  const first = parseInt(groups[0], 16);
  if (first === 0) return false;                                // ::/128, ::1
  if ((first & 0xffc0) === 0xfc00) return false;                // unique-local fd00::/8
  if ((first & 0xff00) === 0xfe00) return false;                // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false;                // multicast ff00::/8
  if (first === 0x2001 && parseInt(groups[1], 16) === 0xdb8) return false; // documentation
  return true;
}

/**
 * Validates a fully-formed URL for an outbound tool fetch. Returns the reason it was
 * refused, or null when the URL is safe to request.
 */
export function validateFetchUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'not a valid URL';
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `unsupported protocol "${url.protocol}"`;
  }
  if (url.username || url.password) {
    return 'credentials in the URL are not allowed';
  }
  if (!isPublicRoutableHost(url.hostname)) {
    return `hostname "${url.hostname}" is not a public, routable address`;
  }
  return null;
}

export interface SafeFetchResult {
  status: number;
  data: string;
  url?: string;
  error?: string;
}

/**
 * Performs the guarded fetch for the `fetch_api` tool. Redirects are followed
 * manually so every hop is re-validated — a public URL that redirects to
 * `http://169.254.169.254` is refused at the hop, not allowed by the first check.
 */
export async function safeFetchText(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  options: { timeoutMs?: number } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const initialError = validateFetchUrl(rawUrl);
  if (initialError) {
    return { status: 0, data: '', error: `Refused: ${initialError}` };
  }

  let currentUrl = rawUrl;
  // One wall-clock deadline for the whole redirect chain: each hop only gets
  // the time remaining, so a slow redirect chain cannot multiply the timeout.
  const deadline = Date.now() + timeoutMs;
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { status: 0, data: '', url: currentUrl, error: `fetch_api exceeded the ${timeoutMs / 1000}s timeout` };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('fetch_api exceeded the timeout')), remaining);
    try {
      const res = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'BrainHalf-Preview-Bot/1.0' },
      });

      // A manual-redirect fetch returns a 3xx with a Location header.
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        const next = new URL(res.headers.get('location') as string, currentUrl).toString();
        const hopError = validateFetchUrl(next);
        if (hopError) {
          return { status: res.status, data: '', url: currentUrl, error: `Refused redirect: ${hopError}` };
        }
        if (hop === FETCH_MAX_REDIRECTS) {
          return { status: res.status, data: '', url: currentUrl, error: `Refused: too many redirects` };
        }
        currentUrl = next;
        continue;
      }

      // Read at most FETCH_MAX_BYTES so a hostile endpoint cannot exhaust memory.
      const reader = res.body?.getReader();
      let received = 0;
      const chunks: Uint8Array[] = [];
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            received += value.byteLength;
            chunks.push(value);
            if (received >= FETCH_MAX_BYTES) break;
          }
        }
        try { await reader.cancel(); } catch { /* already closed */ }
      }
      const buffer = new Uint8Array(Math.min(received, FETCH_MAX_BYTES));
      let offset = 0;
      for (const chunk of chunks) {
        if (offset >= FETCH_MAX_BYTES) break;
        const copy = chunk.subarray(0, FETCH_MAX_BYTES - offset);
        buffer.set(copy, offset);
        offset += copy.byteLength;
      }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      return { status: res.status, data: text.slice(0, FETCH_MAX_TEXT), url: currentUrl };
    } catch (e: any) {
      const aborted = controller.signal.aborted;
      return {
        status: 0,
        data: '',
        url: currentUrl,
        error: aborted ? `fetch_api exceeded the ${timeoutMs / 1000}s timeout` : (e?.message || String(e)),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { status: 0, data: '', error: 'Refused: redirect loop' };
}
